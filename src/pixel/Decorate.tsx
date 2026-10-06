import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Container, Graphics, Sprite } from 'pixi.js'
import { DESK_ITEMS, footprint, itemById, lowerName, nextRot, resale, rotations, type DeskItem, type Item } from '../data/catalog'
import {
  RESERVED, apply, canDesk, canPlace, costOf, deskCells, fixedBlock, reserved, sellValue, type Action, type Cell, type Check, type PlaceOpts,
} from '../data/decor'
import {
  CELL, COLS, ROWS, cellKey, cellX, cellZ, colOf, rowOf, type OfficeState, type Placed,
} from '../data/officeState'
import { useExp } from '../data/exp'
import { act, useBalance, useOffice } from '../data/officeSync'
import { decorated, deskGift } from '../life/director'
import { fmtXu } from '../data/xu'
import { useCoop } from '../store'
import { useDeco, type Pending } from '../ui/decoStore'
import { blockedReason, buildWorld, type World } from '../world/layout'
import { BLOCKS, forward } from '../world/room'
import { cellOpen, isFixedWall, partAt } from '../world/rooms'
import { deskThumb, footRect, itemView, wallRect } from './catalogArt'
import { PPM, px, py, wx, wz } from './geom'
import type { OfficeView, Rect } from './office'
import { stage, ticks, toScreen, type Tick } from './stage'

/**
 * Chế độ trang trí trên bản đồ: lưới ô, bóng mờ của món đang cầm (khung xanh = đặt được, đỏ = không, kèm lý do),
 * bấm chọn món đã đặt / bàn làm việc, nút ✓ / ✕ và các nút của món đang chọn. Tường, vách là của toà nhà: không xây ở đây.
 * Scene chuyển sự kiện chuột vào đây khi chế độ đang mở.
 */

/** Bố cục và hình văn phòng hiện tại (Scene cập nhật) */
export const decoCtx: { world: World | null; view: OfficeView | null } = { world: null, view: null }

/** Chuột trên bản đồ (pixel gốc) */
const mouse = { x: 0, y: 0, in: false }

const OK = 0x7bd88f
const BAD = 0xef6f5e
const SEL = 0xf4d35e

const cellAt = (x: number, y: number): Cell => [colOf(wx(x)), rowOf(wz(y))]

const levelOf = (id: string) => useExp.getState().stats[id]?.level ?? 1

/** Ô bàn làm việc chiếm (trừ chỗ ngồi `except`) → kiểm đặt đồ */
function deskBlock(w: World, except?: string): PlaceOpts['blocked'] {
  if (!except) return (c, r) => w.deskCells.has(cellKey(c, r))
  const s = new Set<string>()
  for (const sl of w.slots) if (sl.id !== except) for (const [c, r] of deskCells({ x: sl.seat.x, z: sl.seat.z, yaw: sl.yaw })) s.add(cellKey(c, r))
  return (c, r) => s.has(cellKey(c, r))
}

/** Ô của các bàn đã dời (trừ `except`): bàn đưa về chỗ cũ chỉ cần né chúng, bàn ở chỗ gốc vốn xếp khít nhau */
function movedBlock(w: World, except: string): PlaceOpts['blocked'] {
  const s = new Set<string>()
  for (const sl of w.slots) if (sl.id !== except && sl.home) for (const [c, r] of deskCells({ x: sl.seat.x, z: sl.seat.z, yaw: sl.yaw })) s.add(cellKey(c, r))
  return (c, r) => s.has(cellKey(c, r))
}

/** Thử trước trạng thái mới: còn lối tới mọi bàn và bảng ticket không */
function pathsOk(next: OfficeState): Check {
  const why = blockedReason(buildWorld(useCoop.getState().agents, next))
  return why ? { ok: false, why } : { ok: true }
}

const withItem = (o: OfficeState, p: Placed): OfficeState => ({ ...o, items: [...o.items.filter((x) => x.uid !== p.uid), p] })

/** Chỗ đặt món i khi chuột ở ô (c, r): mảnh giữa của món nằm dưới chuột */
function anchor(i: Item, c: number, r: number, rot: number): { c: number; r: number; rot: number } {
  if (i.mount === 'wall') return { c: c - Math.floor(i.w / 2), r: 0, rot: 0 }
  const f = footprint(i, rot)
  return { c: c - Math.floor((f.w - 1) / 2), r: r - (f.d - 1), rot }
}

/**
 * Kiểm một chỗ đặt món (kể cả lối đi), có nhớ kết quả cho lần hỏi giống hệt.
 * Trạng thái văn phòng / bố cục đổi là ra đối tượng mới, nên so theo đối tượng (cất đồ vào kho không đổi số món mà vẫn phải kiểm lại)
 */
let memo: { o: OfficeState | null; w: World | null; key: string; res: Check } = { o: null, w: null, key: '', res: { ok: true } }
function checkItem(o: OfficeState, w: World, i: Item, c: number, r: number, rot: number, uid?: string): Check {
  const key = `${uid ?? i.id}|${c},${r},${rot}`
  if (memo.o === o && memo.w === w && memo.key === key) return memo.res
  let res = canPlace(o, i, c, r, rot, { ignore: uid, blocked: deskBlock(w) })
  if (res.ok && i.mount === 'floor' && i.h > 0) res = pathsOk(withItem(o, { uid: uid ?? '#try', item: i.id, c, r, rot, at: 0 }))
  memo = { o, w, key, res }
  return res
}

/** Kiểm chỗ dời bàn (kể cả lối đi, như lúc bấm đặt), có nhớ kết quả như checkItem */
let deskMemo: { o: OfficeState | null; w: World | null; key: string; res: Check } = { o: null, w: null, key: '', res: { ok: true } }
function checkDesk(o: OfficeState, w: World, slot: string, pos: { x: number; z: number; yaw: number }): Check {
  const key = `${slot}|${pos.x},${pos.z},${pos.yaw}`
  if (deskMemo.o === o && deskMemo.w === w && deskMemo.key === key) return deskMemo.res
  const blocked = deskBlock(w, slot)
  let res = canDesk(o, pos, { blocked })
  if (res.ok) {
    const trial = apply(o, { action: 'desk', slot, ...pos }, Infinity, 0, () => '#try', { blocked, levelOf })
    res = 'error' in trial ? { ok: false, why: trial.error } : pathsOk(trial.office)
  }
  deskMemo = { o, w, key, res }
  return res
}

const cellsRect = (cells: Cell[]): Rect => {
  const cs = cells.map((p) => p[0]), rs = cells.map((p) => p[1])
  const c0 = Math.min(...cs), r0 = Math.min(...rs)
  return { x: Math.round(px(cellX(c0))), y: Math.round(py(cellZ(r0))), w: (Math.max(...cs) - c0 + 1) * CELL * PPM, h: (Math.max(...rs) - r0 + 1) * CELL * PPM }
}

/** Món đã đặt / bàn dưới điểm (pixel gốc): món nằm trước nhất (chân thấp nhất trên màn hình) thắng */
function selectAt(x: number, y: number): string | null {
  const v = decoCtx.view, w = decoCtx.world
  if (!v || !w) return null
  let best: string | null = null, bz = -Infinity
  const o = useOffice.getState().office
  for (const [uid, h] of v.itemHits) {
    if (x < h.x || x >= h.x + h.w || y < h.y || y >= h.y + h.h) continue
    const i = itemById.get(o.items.find((p) => p.uid === uid)?.item ?? '')
    // Thảm nằm dưới cùng: chỉ chọn khi không trúng món nào khác
    const z = i?.mount === 'rug' ? -1e6 : h.y + h.h
    if (z > bz) { bz = z; best = uid }
  }
  for (const sl of w.slots) {
    const r = cellsRect(deskCells({ x: sl.seat.x, z: sl.seat.z, yaw: sl.yaw }))
    if (x >= r.x && x < r.x + r.w && y >= r.y - 12 && y < r.y + r.h && r.y + r.h > bz) { bz = r.y + r.h; best = `desk:${sl.id}` }
  }
  return best
}

// ───────────────────────── Sự kiện chuột (Scene gọi) ─────────────────────────

export function decoMove(x: number, y: number) {
  mouse.x = x
  mouse.y = y
  mouse.in = true
}
export function decoLeave() { mouse.in = false }

export function decoClick(x: number, y: number) {
  const d = useDeco.getState()
  const w = decoCtx.world
  if (d.busy || !w) return
  const o = useOffice.getState().office
  const [c, r] = cellAt(x, y)
  const dr = d.draft
  if (!dr) return d.select(selectAt(x, y))
  if (d.pending) return
  if (dr.kind === 'new') {
    const i = itemById.get(dr.item)!
    const a = anchor(i, c, r, dr.rot)
    const chk = checkItem(o, w, i, a.c, a.r, a.rot)
    if (!chk.ok) return useCoop.getState().showToast(chk.why!)
    d.setPending({ kind: 'item', item: i.id, ...a })
  } else if (dr.kind === 'move') {
    const i = itemById.get(dr.item)!
    const a = anchor(i, c, r, dr.rot)
    void run({ action: 'place', uid: dr.uid, ...a }, `Đã đặt ${lowerName(i.name)}`, () => useDeco.getState().select(dr.uid))
  } else if (dr.kind === 'desk') {
    const p = deskAt(x, y, dr.yaw)
    void run({ action: 'desk', slot: dr.slot, ...p }, 'Đã dời bàn', () => useDeco.getState().select(`desk:${dr.slot}`))
  }
}

/** Ghế đặt ở tâm ô dưới chuột, bàn nằm phía trước */
function deskAt(x: number, y: number, yaw: number) {
  const [c, r] = cellAt(x, y)
  return { x: cellX(c) + CELL / 2, z: cellZ(r) + CELL / 2, yaw }
}

/** Phím R: xoay món đang cầm / đang đặt thử / đang chọn */
export function decoRotate() {
  const d = useDeco.getState()
  const dr = d.draft
  // Món không xoay được thì R không làm gì
  const turns = (id: string) => rotations(itemById.get(id)!).length > 1
  if (d.pending?.kind === 'item') {
    if (turns(d.pending.item)) d.setPending({ ...d.pending, rot: nextRot(itemById.get(d.pending.item)!, d.pending.rot) })
  } else if (dr?.kind === 'new' || dr?.kind === 'move') {
    if (turns(dr.item)) useDeco.setState({ draft: { ...dr, rot: nextRot(itemById.get(dr.item)!, dr.rot) } })
  } else if (dr?.kind === 'desk') {
    useDeco.setState({ draft: { ...dr, yaw: nextYaw(dr.yaw) } })
  } else if (d.sel) {
    void rotateSelected()
  }
}

const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2]
const nextYaw = (y: number) => YAWS[(YAWS.findIndex((v) => Math.abs(v - y) < 1e-3) + 1) % YAWS.length]

async function rotateSelected() {
  const d = useDeco.getState()
  const o = useOffice.getState().office
  const w = decoCtx.world
  if (!d.sel || !w) return
  if (d.sel.startsWith('desk:')) {
    const slot = d.sel.slice(5)
    const sl = w.slots.find((s) => s.id === slot)
    if (sl) await run({ action: 'desk', slot, x: sl.seat.x, z: sl.seat.z, yaw: nextYaw(sl.yaw) }, 'Đã xoay bàn')
    return
  }
  const p = o.items.find((x) => x.uid === d.sel)
  const i = p && itemById.get(p.item)
  if (!p || !i || i.turn === 'none') return
  await run({ action: 'place', uid: p.uid, c: p.c, r: p.r, rot: nextRot(i, p.rot) }, `Đã xoay ${lowerName(i.name)}`)
}

/**
 * Gửi một lệnh trang trí: kiểm lối đi trước (đồ, bàn mới không được nhốt agent), rồi gửi.
 * Thành công thì báo, lỗi thì hiện lý do.
 */
async function run(a: Action, done: string, after?: () => void): Promise<boolean> {
  const d = useDeco.getState()
  const w = decoCtx.world
  if (d.busy || !w) return false
  const toast = useCoop.getState().showToast
  const o = useOffice.getState().office
  const blocked = a.action === 'deskReset' ? movedBlock(w, a.slot) : deskBlock(w, a.action === 'desk' ? a.slot : undefined)
  // Thử trước trên bản sao để kiểm lối đi (server không biết bàn nằm đâu)
  const trial = apply(o, a, Infinity, 0, () => '#try', { blocked, levelOf })
  if ('error' in trial) { toast(trial.error); return false }
  if (a.action === 'buy' || a.action === 'place' || a.action === 'desk' || a.action === 'deskReset') {
    const chk = pathsOk(trial.office)
    if (!chk.ok) { toast(chk.why!); return false }
  }
  d.setBusy(true)
  try {
    await act(a, { blocked })
    toast(done)
    after?.()
    return true
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Không làm được')
    return false
  } finally {
    useDeco.getState().setBusy(false)
  }
}

// ───────────────────────── Lớp vẽ trên bản đồ + nút ─────────────────────────

/** Vẽ khung kiến bò quanh r */
function ants(g: Graphics, r: Rect, color: number, phase: number) {
  g.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).stroke({ color: 0x2a1f14, alpha: 0.8, width: 1, alignment: 1 })
  const dash = (x0: number, y0: number, len: number, horiz: boolean) => {
    for (let k = phase; k < len; k += 4) {
      if (horiz) g.rect(x0 + k, y0, Math.min(2, len - k), 1).fill(color)
      else g.rect(x0, y0 + k, 1, Math.min(2, len - k)).fill(color)
    }
  }
  dash(r.x, r.y, r.w, true)
  dash(r.x, r.y + r.h - 1, r.w, true)
  dash(r.x, r.y, r.h, false)
  dash(r.x + r.w - 1, r.y, r.h, false)
}

/**
 * Dấu chỗ đặt: nền màu + bóng tiếp đất nằm dưới bóng mờ của món (`under`), viền 2 px + góc vuông nằm trên (`over`).
 * Không đặt được: đỏ, thêm sọc chéo.
 */
function mark(under: Graphics, over: Graphics, r: Rect, ok: boolean, floor = true) {
  const col = ok ? OK : BAD
  if (floor) under.rect(r.x + 1, r.y + r.h - 4, r.w - 2, 4).fill({ color: 0x000000, alpha: 0.2 })
  if (ok) under.rect(r.x, r.y, r.w, r.h).fill({ color: col, alpha: 0.25 })
  else {
    // Sọc chéo 45° mảnh, cách 6 px, nằm dưới bóng mờ để vẫn thấy món
    for (let k = -r.h; k < r.w; k += 6) {
      for (let j = 0; j < r.h; j++) {
        const x = k + j
        if (x >= 0 && x < r.w) under.rect(r.x + x, r.y + r.h - 1 - j, 1, 1).fill({ color: col, alpha: 0.5 })
      }
    }
  }
  over.rect(r.x, r.y, r.w, r.h).stroke({ color: 0x1e1a2b, alpha: 0.7, width: 1, alignment: 1 })
  over.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).stroke({ color: col, width: 2, alignment: 0 })
  // Góc vuông 3 px nổi ra ngoài
  for (const [cx, cy, sx, sy] of [[r.x - 2, r.y - 2, 1, 1], [r.x + r.w + 1, r.y - 2, -1, 1], [r.x - 2, r.y + r.h + 1, 1, -1], [r.x + r.w + 1, r.y + r.h + 1, -1, -1]]) {
    over.rect(sx > 0 ? cx : cx - 3, cy, 4, 1).fill(0xffffff)
    over.rect(cx, sy > 0 ? cy : cy - 3, 1, 4).fill(0xffffff)
  }
}

/** Nhuộm màu mọi hình trong một nhánh (bóng mờ món không đặt được) */
function setTint(o: Container, color: number) {
  if ('tint' in o && o instanceof Sprite) o.tint = color
  for (const ch of o.children) setTint(ch, color)
}

/** Khu luôn để trống và vùng chặn cố định của bản đồ: sọc đỏ chéo + viền nét đứt */
function drawReserved(g: Graphics) {
  const rects = [
    ...RESERVED.map((z) => [Math.round(px(cellX(z.c0))), Math.round(py(cellZ(z.r0))), (z.c1 - z.c0 + 1) * 16, (z.r1 - z.r0 + 1) * 16]),
    ...BLOCKS.map((b) => [Math.round(px(b.minX)), Math.round(py(b.minZ)), Math.round((b.maxX - b.minX) * PPM), Math.round((b.maxZ - b.minZ) * PPM)]),
  ]
  for (const [x0, y0, w, h] of rects) {
    g.rect(x0, y0, w, h).fill({ color: BAD, alpha: 0.12 })
    for (let k = -h; k < w; k += 6) for (let j = 0; j < h; j++) { const x = k + j; if (x >= 0 && x < w && (j % 2 === 0)) g.rect(x0 + x, y0 + h - 1 - j, 1, 1).fill({ color: BAD, alpha: 0.35 }) }
    for (let k = 0; k < w; k += 4) { g.rect(x0 + k, y0, 2, 1).fill({ color: BAD, alpha: 0.8 }) }
    for (let k = 0; k < h; k += 4) { g.rect(x0, y0 + k, 1, 2).fill({ color: BAD, alpha: 0.8 }); g.rect(x0 + w - 1, y0 + k, 1, 2).fill({ color: BAD, alpha: 0.8 }) }
  }
}

/** Lưới ô: chấm ở góc ô trên sàn phòng đã mở, sọc mờ ở chỗ luôn để trống (phòng khoá đã phủ tối sẵn) */
function drawGrid(g: Graphics, o: OfficeState) {
  g.clear()
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = Math.round(px(cellX(c))), y = Math.round(py(cellZ(r)))
      if (reserved(c, r) || fixedBlock(c, r) || isFixedWall(c, r) || partAt(c, r) || !cellOpen(o, c, r)) continue
      else {
        g.rect(x, y, 1, 1).fill({ color: 0xffffff, alpha: 0.45 })
        g.rect(x + 8, y + 8, 1, 1).fill({ color: 0x000000, alpha: 0.12 })
      }
    }
  }
  drawReserved(g)
}

interface Tag { x: number; y: number; text: string; ok: boolean }

export function DecoOverlay() {
  const open = useDeco((s) => s.open)
  const draft = useDeco((s) => s.draft)
  const sel = useDeco((s) => s.sel)
  const pending = useDeco((s) => s.pending)
  const busy = useDeco((s) => s.busy)
  const office = useOffice((s) => s.office)
  const balance = useBalance()
  const bar = useRef<HTMLDivElement>(null)
  const tagEl = useRef<HTMLDivElement>(null)
  const [tag, setTag] = useState<Tag | null>(null)
  const [sure, setSure] = useState(false)
  useEffect(() => setSure(false), [sel])

  // Lưới: vẽ lại khi phòng đã mở đổi
  useEffect(() => {
    if (!open || !stage.fx) return
    document.body.classList.add('deco-mode')
    const g = new Graphics()
    stage.fx.addChildAt(g, 0)
    drawGrid(g, office)
    return () => {
      document.body.classList.remove('deco-mode')
      g.removeFromParent()
      g.destroy()
    }
  }, [open, office])

  // Bóng mờ của món đang cầm / đang đặt thử, khung chọn: vẽ mỗi khung hình
  useEffect(() => {
    if (!open || !stage.fx) return
    const g = new Graphics()
    const under = new Graphics()
    const ghost = new Container()
    // Màu thật của món, chỉ trong mờ
    ghost.alpha = 0.68
    stage.fx.addChild(under, ghost, g)
    let ghostKey = ''
    let lastTag = ''
    const tick: Tick = (_dt, t) => {
      const d = useDeco.getState()
      const o = useOffice.getState().office
      const w = decoCtx.world
      g.clear()
      under.clear()
      let tg: Tag | null = null
      const phase = Math.floor(t * 8) % 4
      const setGhost = (key: string, build: () => Container | null) => {
        if (key === ghostKey) return
        ghostKey = key
        for (const ch of ghost.removeChildren()) ch.destroy({ children: true })
        const n = build()
        if (n) ghost.addChild(n)
      }
      const p = d.pending
      const dr = d.draft
      let bad = false
      if (w && p) {
        const i = itemById.get(p.item)!
        const chk = checkItem(o, w, i, p.c, p.r, p.rot)
        const rect = i.mount === 'wall' ? wallRect(i, p.c) : footRect(i, p.c, p.r, p.rot)
        setGhost(`p|${i.id}|${p.c},${p.r},${p.rot}`, () => itemView(i, p.c, p.r, p.rot).node)
        mark(under, g, rect, chk.ok, i.mount !== 'wall')
        bad = !chk.ok
        tg = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 4, text: '', ok: chk.ok }
      } else if (w && mouse.in && dr) {
        const [c, r] = cellAt(mouse.x, mouse.y)
        if (dr.kind === 'new' || dr.kind === 'move') {
          const i = itemById.get(dr.item)!
          const a = anchor(i, c, r, dr.rot)
          const chk = checkItem(o, w, i, a.c, a.r, a.rot, dr.kind === 'move' ? dr.uid : undefined)
          const rect = i.mount === 'wall' ? wallRect(i, a.c) : footRect(i, a.c, a.r, a.rot)
          setGhost(`d|${i.id}|${a.c},${a.r},${a.rot}`, () => itemView(i, a.c, a.r, a.rot).node)
          mark(under, g, rect, chk.ok, i.mount !== 'wall')
          bad = !chk.ok
          if (!chk.ok) tg = { x: rect.x + rect.w / 2, y: rect.y - 6, text: chk.why!, ok: false }
        } else {
          setGhost('', () => null)
          const pos = deskAt(mouse.x, mouse.y, dr.yaw)
          const chk = checkDesk(o, w, dr.slot, pos)
          drawDesk(g, pos, chk.ok ? OK : BAD)
          const rect = cellsRect(deskCells(pos))
          if (!chk.ok) tg = { x: rect.x + rect.w / 2, y: rect.y - 8, text: chk.why!, ok: false }
        }
      } else {
        setGhost('', () => null)
      }
      // Không đặt được: bóng mờ ửng đỏ, rõ hơn một chút
      ghost.alpha = bad ? 0.78 : 0.68
      for (const ch of ghost.children) setTint(ch, bad ? 0xff9c9c : 0xffffff)
      // Món đang chọn: khung kiến bò vàng
      if (d.sel && !dr && decoCtx.view) {
        const r = selRect(d.sel)
        if (r) ants(g, r, SEL, phase)
      }
      // Nút của chỗ đặt thử / món đang chọn bám theo vị trí trên màn hình
      const anchorPt = p ? tg : d.sel && !dr ? (() => { const r = selRect(d.sel!); return r ? { x: r.x + r.w / 2, y: r.y + r.h + (d.sel!.startsWith('desk:') ? 7 : 3) } : null })() : null
      if (bar.current) {
        const s = anchorPt ? toScreen(anchorPt.x, anchorPt.y) : { x: -9999, y: -9999 }
        bar.current.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`
      }
      const showTag = !p && tg?.text ? tg : null
      if (tagEl.current) {
        const s = showTag ? toScreen(showTag.x, showTag.y) : { x: -9999, y: -9999 }
        tagEl.current.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`
      }
      const k = showTag ? `${showTag.text}|${showTag.ok}` : ''
      if (k !== lastTag) { lastTag = k; setTag(showTag) }
    }
    ticks.add(tick)
    return () => {
      ticks.delete(tick)
      ghost.destroy({ children: true })
      g.destroy()
      under.destroy()
    }
  }, [open])

  if (!open || !stage.overlay) return null
  const o = office
  const selItem = sel && !sel.startsWith('desk:') ? o.items.find((p) => p.uid === sel) : undefined
  const selDef = selItem && itemById.get(selItem.item)
  // Bàn đang chọn đã bị dời: chỗ gốc để nút "Về chỗ cũ"
  const selHome = sel?.startsWith('desk:') && o.desks[sel.slice(5)] ? decoCtx.world?.slots.find((s) => s.id === sel.slice(5))?.home : undefined
  const cost = pending ? costOf(o, pendingAction(pending)) : 0

  return createPortal(
    <>
      <div ref={tagEl} className="px-anchor deco-tag" style={{ transform: 'translate(-9999px, -9999px)' }}>
        {tag && <span className={tag.ok ? 'ok' : 'bad'}>{tag.text}</span>}
      </div>
      {/* Bấm chuột không giữ focus ở nút: Enter sau đó vẫn là ✓ Mua, không bấm lại nút vừa bấm (Tab tới nút thì Enter vẫn bấm nút đó) */}
      <div ref={bar} className="px-anchor deco-bar" style={{ transform: 'translate(-9999px, -9999px)' }} onMouseDown={(e) => e.preventDefault()}>
        {pending && (
          <div className="deco-btns">
            <button type="button" className="desk-btn primary" disabled={busy || (cost > 0 && balance < cost)}
              onClick={() => void confirmPending(pending)}
              title={cost > balance ? `Còn thiếu ${fmtXu(cost - balance)} Xu` : 'Enter'}>
              ✓ {cost > 0 ? `Mua · ${fmtXu(cost)} Xu` : 'Xong'}
            </button>
            {itemById.get(pending.item)!.turn !== 'none' && (
              <button type="button" className="desk-btn" onClick={decoRotate} title="Xoay (phím R)">↻</button>
            )}
            <button type="button" className="desk-btn" onClick={() => useDeco.getState().setPending(null)} title="Bỏ (Esc)">✕</button>
          </div>
        )}
        {!pending && !draft && sel && (
          <div className={`deco-btns${sel.startsWith('desk:') ? ' desk' : ''}`}>
            {sel.startsWith('desk:') ? (
              <>
                <span className="deco-name">Bàn làm việc</span>
                <button type="button" className="desk-btn" disabled={busy} onClick={() => void rotateSelected()} title="Xoay (phím R)">↻ Xoay</button>
                <button type="button" className="desk-btn" disabled={busy} onClick={() => startDesk(sel.slice(5))}>✥ Dời</button>
                {selHome && (
                  <button type="button" className="desk-btn" disabled={busy} title="Đưa bàn về chỗ ban đầu trong cụm bàn / bàn Lead"
                    onClick={() => void run({ action: 'deskReset', slot: sel.slice(5), ...selHome }, 'Đã đưa bàn về chỗ cũ')}>↺ Về chỗ cũ</button>
                )}
                <DeskItems slot={sel.slice(5)} />
              </>
            ) : selItem && selDef ? (
              <>
                <span className="deco-name">{selDef.name}</span>
                {selDef.turn !== 'none' && <button type="button" className="desk-btn" disabled={busy} onClick={() => void rotateSelected()} title="Xoay (phím R)">↻</button>}
                <button type="button" className="desk-btn" disabled={busy} onClick={() => useDeco.getState().setDraft({ kind: 'move', uid: selItem.uid, item: selItem.item, rot: selItem.rot })}>✥ Dời</button>
                <button type="button" className="desk-btn" disabled={busy} onClick={() => void run({ action: 'store', uid: selItem.uid }, `Đã cất ${lowerName(selDef.name)} vào kho`, () => useDeco.getState().select(null))}>📦 Cất</button>
                {!sure
                  ? <button type="button" className="desk-btn" disabled={busy} onClick={() => setSure(true)}
                    title={selItem.kit ? 'Đồ có sẵn khi mở phòng: bán không được Xu' : undefined}>Bán · +{fmtXu(sellValue(selItem))} Xu</button>
                  : <button type="button" className="desk-btn danger" disabled={busy} onClick={() => void run({ action: 'sell', uid: selItem.uid }, `Đã bán ${lowerName(selDef.name)} · +${fmtXu(sellValue(selItem))} Xu`, () => useDeco.getState().select(null))}>Chắc chưa? Bán</button>}
              </>
            ) : null}
          </div>
        )}
      </div>
    </>,
    stage.overlay,
  )
}

/**
 * Đồ để bàn của agent ngồi bàn đang chọn: món đã có (bấm để bán lại nửa giá), món đã mở khoá (bấm để mua),
 * món còn khoá (hiện cấp cần đạt). Agent nhận đồ mới thì vui ra mặt.
 */
function DeskItems({ slot }: { slot: string }) {
  const agents = useCoop((s) => s.agents)
  const office = useOffice((s) => s.office)
  const busy = useDeco((s) => s.busy)
  const balance = useBalance()
  const w = decoCtx.world
  const who = w ? [...w.seatOf].find(([, sl]) => sl.id === slot)?.[0] : undefined
  const agent = agents.find((a) => a.id === who)
  const level = useExp((s) => (who ? s.stats[who]?.level ?? 1 : 1))
  const [selling, setSelling] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => { setSelling(null); setHover(null) }, [slot])
  if (!who || !agent) return <div className="desk-items"><span className="desk-items-head">Bàn trống: chưa có ai ngồi</span></div>
  const mine = new Set(office.deskItems[who] ?? [])
  const buy = (d: DeskItem) => void run({ action: 'deskBuy', agent: who, item: d.id }, `🎁 ${d.name} cho ${agent.name} · −${fmtXu(d.price)} Xu`, () => deskGift(who, lowerName(d.name)))
  const sell = (d: DeskItem) => void run({ action: 'deskSell', agent: who, item: d.id }, `Đã bán ${lowerName(d.name)} · +${fmtXu(resale(d.price))} Xu`, () => setSelling(null))
  // Dòng tên: món đang rê chuột (tên + giá / cấp cần), không thì tên agent và cấp
  const hd = DESK_ITEMS.find((d) => d.id === hover)
  const head = !hd ? <>Đồ để bàn của <b>{agent.name}</b> · cấp {level}</>
    : mine.has(hd.id) ? <><b>{hd.name}</b> · bấm để bán +{fmtXu(resale(hd.price))} Xu</>
      : level < hd.level ? <><b>{hd.name}</b> · mở ở cấp {hd.level}</>
        : <><b>{hd.name}</b> · {fmtXu(hd.price)} Xu{balance < hd.price ? ', chưa đủ' : ''}</>
  const icon = (d: DeskItem) => {
    const t = deskThumb(d.id)
    // Phóng 2 lần (ghế cao hơn: 1,5 lần cho vừa ô), giữ nét pixel
    const k = t && t.h > 16 ? 1.5 : 2
    return t ? <img className="desk-chip-img" src={t.url} alt="" draggable={false} style={{ width: t.w * k, height: t.h * k }} /> : <span>{d.icon}</span>
  }
  return (
    <div className="desk-items" onMouseLeave={() => setHover(null)}>
      <span className="desk-items-head">{head}</span>
      <div className="desk-items-row">
        {DESK_ITEMS.map((d) => {
          const on = { onMouseEnter: () => setHover(d.id), onFocus: () => setHover(d.id) }
          if (mine.has(d.id)) {
            return selling === d.id
              ? <button key={d.id} type="button" className="desk-btn danger" disabled={busy} onClick={() => sell(d)} {...on}>Bán · +{fmtXu(resale(d.price))}</button>
              : <button key={d.id} type="button" className="desk-chip own" disabled={busy} onClick={() => setSelling(d.id)} aria-label={`${d.name}: đã có`} {...on}>{icon(d)}<i className="desk-chip-tick">✓</i></button>
          }
          if (level < d.level) {
            return <span key={d.id} className="desk-chip locked" aria-label={`${d.name}: mở khoá ở cấp ${d.level}`} {...on}>{icon(d)}<i>🔒{d.level}</i></span>
          }
          const poor = balance < d.price
          return (
            <button key={d.id} type="button" className="desk-chip buy" disabled={busy || poor} onClick={() => buy(d)} aria-label={`Mua ${lowerName(d.name)}`} {...on}>
              {icon(d)}<i>🪙{fmtXu(d.price)}</i>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Khung (pixel gốc) của món / bàn đang chọn */
function selRect(sel: string): Rect | null {
  const w = decoCtx.world, v = decoCtx.view
  if (sel.startsWith('desk:')) {
    const sl = w?.slots.find((s) => s.id === sel.slice(5))
    if (!sl) return null
    const r = cellsRect(deskCells({ x: sl.seat.x, z: sl.seat.z, yaw: sl.yaw }))
    return { ...r, y: r.y - 10, h: r.h + 10 }
  }
  return v?.itemHits.get(sel) ?? null
}

function startDesk(slot: string) {
  const sl = decoCtx.world?.slots.find((s) => s.id === slot)
  if (sl) useDeco.getState().setDraft({ kind: 'desk', slot, yaw: sl.yaw })
}

/** Bóng mờ bàn + ghế khi dời bàn */
function drawDesk(g: Graphics, p: { x: number; z: number; yaw: number }, color: number) {
  const f = forward(p.yaw)
  const cx = p.x + f.x * 0.83, cz = p.z + f.z * 0.83
  const side = Math.abs(f.x) > 0.5
  const w = (side ? 0.75 : 1.4) * PPM, d = (side ? 1.4 : 0.75) * PPM
  const x = Math.round(px(cx) - w / 2), y = Math.round(py(cz) - d / 2)
  g.rect(x, y, w, d).fill({ color, alpha: 0.35 })
  g.rect(x, y, w, d).stroke({ color, width: 1, alignment: 1 })
  g.circle(Math.round(px(p.x)), Math.round(py(p.z)), 6).fill({ color, alpha: 0.35 })
  g.circle(Math.round(px(p.x)), Math.round(py(p.z)), 6).stroke({ color, width: 1 })
}

const pendingAction = (p: Pending): Action => ({ action: 'buy', item: p.item, c: p.c, r: p.r, rot: p.rot })

/** Bấm ✓ (hoặc Enter): mua món. Mua xong vẫn cầm món đó để đặt tiếp (Esc để thôi). */
export async function confirmPending(p: Pending | null = useDeco.getState().pending) {
  if (!p) return
  const a = pendingAction(p)
  const i = itemById.get(p.item)!
  const cost = costOf(useOffice.getState().office, a)
  if (!(await run(a, `🛍️ Đã mua ${lowerName(i.name)} · −${fmtXu(cost)} Xu`))) return
  useDeco.getState().setPending(null)
  // Agent đứng gần quay ra khen món mới
  decorated(lowerName(i.name), cellX(p.c) + CELL / 2, i.mount === 'wall' ? -7 : cellZ(p.r) + CELL / 2)
}
