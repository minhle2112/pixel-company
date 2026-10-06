import { create } from 'zustand'
import type { DeskArt, DeskAt, DeskKind, DeskThing, DeskThingView, DeskTop, Item, ItemsFile, Src, View } from '../data/catalog'

/** Đang sửa gì: hình một hướng của một món, một kiểu ghế làm việc, mặt bàn làm việc, hay một món trên bàn ở một kiểu bàn */
export type ChairKey = keyof DeskArt['chair']
export type Target =
  | { kind: 'item'; id: string; rot: number }
  | { kind: 'chair'; key: ChairKey }
  | { kind: 'desk'; key: 'top' | 'side' }
  | { kind: 'thing'; id: string; desk: DeskKind }

interface Msg { text: string; bad?: boolean }

interface S {
  file: ItemsFile | null
  /** JSON lúc lưu gần nhất: khác bản đang sửa = chưa lưu */
  saved: string
  past: string[]
  future: string[]
  target: Target | null
  /** Mảnh đang chọn trong hình đang sửa */
  part: number | null
  /** Ảnh LimeZu đang mở + vùng đang cắt + số khung (hình động) */
  sheet: string | null
  cut: Src | null
  frames: number
  /** Khung đồ trên bàn: kiểu bàn đang xem, các đồ để bàn giả lập là agent đã mua */
  deskKind: DeskKind
  deskOwn: string[]
  msg: Msg | null
  load: () => Promise<void>
  /** Sửa trên bản sao rồi thay (giữ lịch sử để hoàn tác) */
  edit: (fn: (f: ItemsFile) => void) => void
  undo: () => void
  redo: () => void
  save: () => Promise<void>
  toast: (text: string, bad?: boolean) => void
}

let toastTimer = 0

/** Lưu xong Vite khởi động lại server và tải lại trang: nhớ đang mở ảnh nào, sửa món nào (theo tab trình duyệt) */
const KEEP = 'coopverse-cutter'
type Kept = Pick<S, 'sheet' | 'cut' | 'frames' | 'target' | 'deskKind' | 'deskOwn'>
const kept: Partial<Kept> = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(KEEP) ?? '{}') as Partial<Kept>
  } catch {
    return {}
  }
})()

export const useC = create<S>((set, get) => ({
  file: null,
  saved: '',
  past: [],
  future: [],
  target: kept.target ?? null,
  part: null,
  sheet: kept.sheet ?? null,
  cut: kept.cut ?? null,
  frames: kept.frames ?? 1,
  deskKind: kept.deskKind ?? 'back',
  deskOwn: kept.deskOwn ?? ['plant', 'frame', 'monitor', 'lamp', 'chair', 'trophy'],
  msg: null,
  load: async () => {
    const r = await fetch('/__cutter/items', { cache: 'no-store' })
    const file = (await r.json()) as ItemsFile
    set({ file, saved: JSON.stringify(file), past: [], future: [] })
  },
  edit: (fn) => {
    const cur = get().file
    if (!cur) return
    const before = JSON.stringify(cur)
    const next = JSON.parse(before) as ItemsFile
    fn(next)
    if (JSON.stringify(next) === before) return
    set((s) => ({ file: next, past: [...s.past.slice(-199), before], future: [] }))
  },
  undo: () => {
    const { past, file } = get()
    if (!past.length || !file) return
    set((s) => ({ file: JSON.parse(past[past.length - 1]), past: past.slice(0, -1), future: [JSON.stringify(file), ...s.future], part: null }))
  },
  redo: () => {
    const { future, file } = get()
    if (!future.length || !file) return
    set((s) => ({ file: JSON.parse(future[0]), future: future.slice(1), past: [...s.past, JSON.stringify(file)], part: null }))
  },
  save: async () => {
    const { file, toast } = get()
    if (!file) return
    const bad = problems(file)
    if (bad.length) return toast(`Chưa lưu được: ${bad[0]}`, true)
    const r = await fetch('/__cutter/items', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coopverse': '1' }, body: JSON.stringify(file) })
    if (!r.ok) return toast(`Lỗi khi lưu: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`, true)
    set({ saved: JSON.stringify(file) })
    toast('Đã lưu vào game. Trang game tự tải lại.')
  },
  toast: (text, bad) => {
    clearTimeout(toastTimer)
    set({ msg: { text, bad } })
    toastTimer = window.setTimeout(() => set({ msg: null }), bad ? 6000 : 3000)
  },
}))

useC.subscribe((s) => {
  try {
    sessionStorage.setItem(KEEP, JSON.stringify({ sheet: s.sheet, cut: s.cut, frames: s.frames, target: s.target, deskKind: s.deskKind, deskOwn: s.deskOwn } satisfies Kept))
  } catch {
    // Trình duyệt chặn bộ nhớ: thôi, chỉ là tiện lợi
  }
})

export const isDirty = (s: S) => !!s.file && JSON.stringify(s.file) !== s.saved

// ───────────────────────── Đọc / ghi hình đang sửa ─────────────────────────

export const itemOf = (f: ItemsFile, id: string) => f.items.find((i) => i.id === id)
export const thingOf = (f: ItemsFile, id: string) => f.desk.things.find((t) => t.id === id)

/** Chỗ đặt mặc định của món mới trên bàn: giữa mặt bàn (pixel so với góc trên trái hình mặt bàn) */
export const DESK_MID: Record<DeskKind, DeskAt> = { front: { x: 22, y: 16 }, back: { x: 22, y: 16 }, side: { x: 12, y: 26 } }

/** Hình hướng đang sửa (null = hướng này dùng chung hình hướng 0 / món chưa có hình ở kiểu bàn này) */
export function viewAt(f: ItemsFile, t: Target): View | null {
  if (t.kind === 'item') return itemOf(f, t.id)?.art.views?.[t.rot] ?? null
  if (t.kind === 'chair') return f.desk.chair[t.key] ?? null
  if (t.kind === 'thing') return thingOf(f, t.id)?.views[t.desk] ?? null
  return null
}

export function setViewAt(f: ItemsFile, t: Target, v: View | null) {
  if (t.kind === 'item') {
    const i = itemOf(f, t.id)
    if (!i) return
    const vs = (i.art.views ??= [])
    while (vs.length <= t.rot) vs.push(null)
    vs[t.rot] = v
    while (vs.length > 1 && !vs[vs.length - 1]) vs.pop()
  } else if (t.kind === 'chair') {
    if (v) f.desk.chair[t.key] = v
    else if (t.key.endsWith('Leather')) delete f.desk.chair[t.key]
  } else if (t.kind === 'thing') {
    const th = thingOf(f, t.id)
    if (!th) return
    if (!v) return void delete th.views[t.desk]
    // Hình mới (chưa có chỗ đặt): giữ chỗ đặt + màn hình của hình cũ, không có thì đặt giữa bàn
    const old = th.views[t.desk]
    th.views[t.desk] = 'at' in v ? (v as DeskThingView) : { ...v, at: old?.at ?? [{ ...DESK_MID[t.desk] }], ...(old?.screen ? { screen: old.screen } : {}) }
  }
}

export function deskTopAt(f: ItemsFile, key: 'top' | 'side'): DeskTop | undefined {
  return key === 'top' ? f.desk.top : f.desk.side
}

// ───────────────────────── Kiểm trước khi lưu ─────────────────────────

export const ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export function itemProblems(i: Item, all: Item[]): string[] {
  const out: string[] = []
  if (!ID_RE.test(i.id)) out.push(`mã "${i.id}" chỉ gồm chữ không dấu, số, gạch dưới và bắt đầu bằng chữ`)
  if (all.filter((j) => j.id === i.id).length > 1) out.push(`mã "${i.id}" bị trùng`)
  if (!i.name.trim()) out.push(`món "${i.id}" chưa có tên`)
  if (!Number.isInteger(i.price) || i.price < 0) out.push(`giá của "${i.name}" phải là số nguyên ≥ 0`)
  if (!Number.isInteger(i.w) || i.w < 1 || i.w > 12) out.push(`"${i.name}": rộng phải từ 1 đến 12 ô`)
  if (i.mount !== 'wall' && (!Number.isInteger(i.d) || i.d < 1 || i.d > 12)) out.push(`"${i.name}": sâu phải từ 1 đến 12 ô`)
  if (!(i.h >= 0 && i.h <= 4)) out.push(`"${i.name}": cao phải từ 0 đến 4 m`)
  if (!i.art.code && !i.art.views?.[0]?.parts.length) out.push(`"${i.name}" chưa có hình hướng ↓`)
  if (i.use?.kind === 'seat' && !(i.use.n >= 1)) out.push(`"${i.name}": số chỗ ngồi phải ≥ 1`)
  return out
}

export function thingProblems(t: DeskThing, all: DeskThing[]): string[] {
  const out: string[] = []
  if (!ID_RE.test(t.id)) out.push(`mã đồ để bàn "${t.id}" chỉ gồm chữ không dấu, số, gạch dưới và bắt đầu bằng chữ`)
  if (all.filter((x) => x.id === t.id).length > 1) out.push(`mã đồ để bàn "${t.id}" bị trùng`)
  if (!t.name.trim()) out.push(`đồ để bàn "${t.id}" chưa có tên`)
  if (t.price !== undefined && (!Number.isInteger(t.price) || t.price < 0)) out.push(`giá của "${t.name}" phải là số nguyên ≥ 0`)
  if (t.price !== undefined && (!Number.isInteger(t.level ?? 1) || (t.level ?? 1) < 1 || (t.level ?? 1) > 99)) out.push(`"${t.name}": cấp mở khoá phải từ 1 đến 99`)
  for (const [k, v] of Object.entries(t.views)) if (v && !v.at.some((a) => !a.if?.length)) out.push(`"${t.name}" (${k}): thiếu chỗ đặt mặc định`)
  return out
}

export function problems(f: ItemsFile): string[] {
  const out = f.items.flatMap((i) => itemProblems(i, f.items))
  for (const [k, v] of Object.entries(f.desk.chair)) if (v && !v.parts.length) out.push(`ghế làm việc (${k}) chưa có hình`)
  out.push(...f.desk.things.flatMap((t) => thingProblems(t, f.desk.things)))
  return out
}
