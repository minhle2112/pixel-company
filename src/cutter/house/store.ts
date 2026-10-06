import { create } from 'zustand'
import { itemById } from '../../data/catalog'
import { houseProblems, type HouseFile, type HouseProblem } from '../../world/house'
import { useC } from '../store'

/**
 * Mục 🏠 Thiết kế nhà của trang cắt hình: bản nhà đang sửa (src/data/house.json), công cụ, thứ đang chọn.
 * Hoàn tác như phần đồ trang trí: mỗi lần sửa giữ bản cũ; kéo chuột thì chỉ giữ bản lúc bắt đầu kéo.
 */

export type Tool = 'select' | 'room' | 'add' | 'cut' | 'wall' | 'unwall' | 'door' | 'entrance' | 'window' | 'kanban' | 'pod' | 'lead' | 'lobby' | 'kit'
/** Loại vách công cụ Vách đang vẽ */
export type WallPen = 'tall' | 'low'

export type Sel =
  | { kind: 'room'; id: string; kit?: number }
  | { kind: 'door'; i: number }
  /** Một đoạn vách trong phòng (chỉ số trong partitions) */
  | { kind: 'part'; i: number }
  | { kind: 'pod'; i: number }
  /** Bàn riêng của Lead (chỉ số trong leads) */
  | { kind: 'lead'; i: number }
  | { kind: 'lobby'; i: number }
  | null

interface S {
  file: HouseFile | null
  saved: string
  past: string[]
  future: string[]
  tool: Tool
  sel: Sel
  /** Món đang chọn để đặt làm đồ có sẵn, hướng xoay */
  kitItem: string | null
  kitRot: number
  wallPen: WallPen
  zoom: number
  grid: boolean
  /** Ô đang nhấp nháy (bấm vào một lỗi) */
  flash: [number, number] | null
  load: () => Promise<void>
  edit: (fn: (h: HouseFile) => void) => void
  /** Kéo chuột: đổi bản đang sửa từ bản `from` (JSON lúc bắt đầu kéo), chưa ghi lịch sử */
  drag: (from: string, fn: (h: HouseFile) => void) => void
  /** Thả chuột: ghi bản lúc bắt đầu kéo vào lịch sử (nếu có đổi) */
  dragEnd: (from: string) => void
  undo: () => void
  redo: () => void
  save: () => Promise<void>
}

const KEEP = 'coopverse-house'
type Kept = Pick<S, 'tool' | 'sel' | 'zoom' | 'grid' | 'kitItem' | 'kitRot' | 'wallPen'>
const kept: Partial<Kept> = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(KEEP) ?? '{}') as Partial<Kept>
  } catch {
    return {}
  }
})()

export const useH = create<S>((set, get) => ({
  file: null,
  saved: '',
  past: [],
  future: [],
  tool: kept.tool ?? 'select',
  sel: kept.sel ?? null,
  kitItem: kept.kitItem ?? null,
  kitRot: kept.kitRot ?? 0,
  wallPen: kept.wallPen ?? 'tall',
  zoom: kept.zoom ?? 1,
  grid: kept.grid ?? true,
  flash: null,
  load: async () => {
    const r = await fetch('/__cutter/house', { cache: 'no-store' })
    const file = (await r.json()) as HouseFile
    set({ file, saved: JSON.stringify(file), past: [], future: [] })
  },
  edit: (fn) => {
    const cur = get().file
    if (!cur) return
    const before = JSON.stringify(cur)
    const next = JSON.parse(before) as HouseFile
    fn(next)
    if (JSON.stringify(next) === before) return
    set((s) => ({ file: next, past: [...s.past.slice(-199), before], future: [] }))
  },
  drag: (from, fn) => {
    const next = JSON.parse(from) as HouseFile
    fn(next)
    set({ file: next })
  },
  dragEnd: (from) => {
    const cur = get().file
    if (!cur || JSON.stringify(cur) === from) return
    set((s) => ({ past: [...s.past.slice(-199), from], future: [] }))
  },
  undo: () => {
    const { past, file } = get()
    if (!past.length || !file) return
    set((s) => ({ file: JSON.parse(past[past.length - 1]), past: past.slice(0, -1), future: [JSON.stringify(file), ...s.future] }))
  },
  redo: () => {
    const { future, file } = get()
    if (!future.length || !file) return
    set((s) => ({ file: JSON.parse(future[0]), future: future.slice(1), past: [...s.past, JSON.stringify(file)] }))
  },
  save: async () => {
    const { file } = get()
    const { toast } = useC.getState()
    if (!file) return
    const bad = houseProblemsOf(file)
    if (bad.length) return toast(`Chưa lưu được: ${bad[0].msg}`, true)
    const r = await fetch('/__cutter/house', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coopverse': '1' }, body: JSON.stringify(file) })
    if (!r.ok) return toast(`Lỗi khi lưu: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`, true)
    set({ saved: JSON.stringify(file) })
    toast('Đã lưu nhà vào game. Server khởi động lại, trang game tự tải lại.')
  },
}))

useH.subscribe((s) => {
  try {
    sessionStorage.setItem(KEEP, JSON.stringify({ tool: s.tool, sel: s.sel, zoom: s.zoom, grid: s.grid, kitItem: s.kitItem, kitRot: s.kitRot, wallPen: s.wallPen } satisfies Kept))
  } catch {
    // Trình duyệt chặn bộ nhớ: thôi
  }
})

export const isHouseDirty = (s: S) => !!s.file && JSON.stringify(s.file) !== s.saved

/** Lỗi của bản nhà (nhớ theo bản: tính lại khi bản đổi) */
let lastFile: HouseFile | null = null
let lastProblems: HouseProblem[] = []
export function houseProblemsOf(h: HouseFile): HouseProblem[] {
  if (h !== lastFile) {
    lastFile = h
    try {
      lastProblems = houseProblems(h, itemById)
    } catch (e) {
      lastProblems = [{ msg: `Lỗi khi kiểm: ${String(e)}` }]
    }
  }
  return lastProblems
}

/** Mã phòng mới chưa trùng: room1, room2... */
export function freeRoomId(h: HouseFile, base = 'room') {
  for (let n = 1; ; n++) if (!h.rooms.some((r) => r.id === `${base}${n}`)) return `${base}${n}`
}
