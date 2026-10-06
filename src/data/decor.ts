import { deskItemById, footprint, itemById, resale, type Item } from './catalog'
import {
  COLS, ROWS, CELL, cellKey, cellX, cellZ, colOf, rowOf,
  type DeskPos, type OfficeState, type Placed, type Spend,
} from './officeState'
import { BLOCKS, BOARD, DESK_D, DESK_W, DOOR_X, LOBBY, OFFICE, SPAWN, WINDOWS, deskCenter, turned } from '../world/room'
import { cellOpen, isFixedWall, kitOf, nextRoomPrice, northOpen, partAt, roomById, ROOMS, unlockBlock, type Cell } from '../world/rooms'

/**
 * Luật trang trí văn phòng, dùng chung cho server (kiểm trước khi trừ Xu) và trang (khung xanh / đỏ khi đặt thử):
 * đặt đồ ở đâu được, dời bàn, mua / cất / bán. Không phụ thuộc React hay PixiJS.
 *
 * - Đồ đặt trên sàn phòng đã mở (không lên tường giữa các phòng, vách trong phòng, ô cửa trên vách); đồ treo trên tường bắc của phòng đã mở,
 *   không đè cửa sổ, bảng ticket hay món khác.
 * - Mở phòng: phòng có cửa thông với phòng đã mở, giá theo số phòng đã mở (src/world/rooms.ts).
 * - Cửa vào và sảnh chờ ứng viên luôn để trống.
 * - Thảm nằm dưới đồ: đồ khác đặt lên thảm được, nhưng thảm không chồng thảm.
 * - Tường, vách, cửa là của toà nhà (trang thiết kế nhà), người chơi không xây / dỡ.
 * Server không biết bàn của agent nằm đâu (bàn xếp theo sơ đồ tổ chức ở trang), nên trang kiểm thêm phần đó
 * (tham số `blocked`) và kiểm lối đi tới mọi bàn không bị chặn kín (src/world/layout.ts).
 */

export type { Cell }

interface Zone { c0: number; r0: number; c1: number; r1: number }
const zone = (minX: number, maxX: number, minZ: number, maxZ: number): Zone =>
  ({ c0: colOf(minX), r0: rowOf(minZ), c1: colOf(maxX - 1e-6), r1: rowOf(maxZ - 1e-6) })

/** Chỗ luôn để trống: lối vào ở giữa tường nam, sảnh chờ ứng viên, chỗ bạn xuất hiện */
export const RESERVED: Zone[] = [
  zone(DOOR_X - 1.5, DOOR_X + 1.5, SPAWN.z - 0.7, OFFICE.maxZ),
  zone(Math.min(...LOBBY.map((p) => p.x)) - 0.5, Math.max(...LOBBY.map((p) => p.x)) + 0.5, Math.min(...LOBBY.map((p) => p.z)) - 0.5, OFFICE.maxZ),
]
export const reserved = (c: number, r: number) => RESERVED.some((z) => c >= z.c0 && c <= z.c1 && r >= z.r0 && r <= z.r1)

/** Ô chạm vùng chặn cố định của bản đồ (layer Collision trong maps/office.tmj) */
export const fixedBlock = (c: number, r: number) => {
  const x0 = cellX(c), z0 = cellZ(r), e = 1e-6
  return BLOCKS.some((b) => x0 + CELL > b.minX + e && x0 < b.maxX - e && z0 + CELL > b.minZ + e && z0 < b.maxZ - e)
}

const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS


/** Các ô một món chiếm (đồ trên sàn, thảm) */
export function cellsOf(i: Item, c: number, r: number, rot: number): Cell[] {
  const { w, d } = footprint(i, rot)
  const out: Cell[] = []
  for (let dr = 0; dr < d; dr++) for (let dc = 0; dc < w; dc++) out.push([c + dc, r + dr])
  return out
}

// ───────────────────────── Tường bắc ─────────────────────────

/** Cột tường bắc bị cửa sổ / bảng ticket chiếm (cửa sổ LimeZu rộng 25 px ≈ 0,8 m) */
export const FIXED_WALL_COLS: Set<number> = (() => {
  const s = new Set<number>()
  const add = (x0: number, x1: number) => { for (let c = colOf(x0); c <= colOf(x1 - 1e-6); c++) s.add(c) }
  for (const x of WINDOWS) add(x - 0.4, x + 0.4)
  add(BOARD.x - BOARD.w / 2, BOARD.x + BOARD.w / 2)
  return s
})()

export const wallItemCols = (i: Item, c: number) => Array.from({ length: i.w }, (_, k) => c + k)

// ───────────────────────── Ai đang chiếm ô nào ─────────────────────────

export interface Occupancy {
  /** ô → uid đồ đứng trên sàn */
  floor: Map<string, string>
  /** ô → uid thảm */
  rug: Map<string, string>
  /** cột tường bắc → uid đồ treo */
  wall: Map<number, string>
}

export function occupancy(o: OfficeState, ignore?: string): Occupancy {
  const occ: Occupancy = { floor: new Map(), rug: new Map(), wall: new Map() }
  for (const p of o.items) {
    if (p.stored || p.uid === ignore) continue
    const i = itemById.get(p.item)
    if (!i) continue
    if (i.mount === 'wall') { for (const c of wallItemCols(i, p.c)) occ.wall.set(c, p.uid); continue }
    const m = i.mount === 'rug' ? occ.rug : occ.floor
    for (const [c, r] of cellsOf(i, p.c, p.r, p.rot)) m.set(cellKey(c, r), p.uid)
  }
  return occ
}

export interface Check { ok: boolean; why?: string }
const ok: Check = { ok: true }
const no = (why: string): Check => ({ ok: false, why })

export interface PlaceOpts {
  /** Món đang dời (không tính chỗ cũ của chính nó) */
  ignore?: string
  /** Ô bị chiếm bởi thứ server không biết (bàn của agent) */
  blocked?: (c: number, r: number) => boolean
  /** Cấp hiện tại của agent (đồ để bàn mở khoá theo cấp). Không có thì không cho mua đồ để bàn */
  levelOf?: (agentId: string) => number
}

/** Ô vướng vách trong phòng / cửa trên vách: lý do, không vướng thì null */
function partOf(cells: Cell[]): string | null {
  const ks = cells.map(([c, r]) => partAt(c, r))
  return ks.includes('door') ? 'Để trống lối cửa' : ks.some(Boolean) ? 'Vướng vách' : null
}

/** Đặt món `i` ở ô (c, r), hướng `rot` được không */
export function canPlace(o: OfficeState, i: Item, c: number, r: number, rot: number, opts: PlaceOpts = {}): Check {
  const occ = occupancy(o, opts.ignore)
  if (i.mount === 'wall') {
    const cols = wallItemCols(i, c)
    if (cols[0] < 0 || cols[cols.length - 1] >= COLS) return no('Ra ngoài tường')
    if (cols.some((k) => !northOpen(o, k))) return no('Chỉ treo trên tường bắc của phòng đã mở')
    if (cols.some((k) => FIXED_WALL_COLS.has(k))) return no('Vướng cửa sổ hoặc bảng ticket')
    if (cols.some((k) => occ.wall.has(k))) return no('Vướng đồ treo khác')
    const fame = i.id === 'fame' ? o.items.filter((p) => p.item === 'fame' && p.uid !== opts.ignore) : []
    if (fame.some((p) => !p.stored)) return no('Chỉ treo một bảng vinh danh')
    // Mua mới (không phải lấy từ kho ra) khi đã có bảng trong kho: đặt lại bảng đó
    if (!opts.ignore && fame.length) return no('Đã có bảng vinh danh trong kho')
    return ok
  }
  const cells = cellsOf(i, c, r, rot)
  if (cells.some(([cc, rr]) => !inGrid(cc, rr))) return no('Ra ngoài phòng')
  if (cells.some(([cc, rr]) => reserved(cc, rr))) return no('Để trống lối vào và sảnh chờ')
  if (cells.some(([cc, rr]) => fixedBlock(cc, rr))) return no('Vướng chỗ cố định của văn phòng')
  if (cells.some(([cc, rr]) => isFixedWall(cc, rr))) return no('Vướng tường')
  if (cells.some(([cc, rr]) => !cellOpen(o, cc, rr))) return no('Phòng này chưa mở')
  const part = partOf(cells)
  if (part) return no(part)
  const mine = i.mount === 'rug' ? occ.rug : occ.floor
  if (cells.some(([cc, rr]) => mine.has(cellKey(cc, rr)))) return no(i.mount === 'rug' ? 'Thảm không chồng lên thảm' : 'Vướng đồ khác')
  if (i.mount === 'floor' && opts.blocked && cells.some(([cc, rr]) => opts.blocked!(cc, rr))) return no('Vướng bàn làm việc')
  return ok
}

/** Các ô một bàn làm việc (kể cả ghế) chiếm */
export function deskCells(p: DeskPos): Cell[] {
  const c = deskCenter({ id: '', zone: 'open', seat: { x: p.x, z: p.z }, yaw: p.yaw })
  const [w, d] = turned(p.yaw) ? [DESK_D, DESK_W] : [DESK_W, DESK_D]
  const minX = Math.min(c.x - w / 2, p.x - 0.25), maxX = Math.max(c.x + w / 2, p.x + 0.25)
  const minZ = Math.min(c.z - d / 2, p.z - 0.25), maxZ = Math.max(c.z + d / 2, p.z + 0.25)
  const out: Cell[] = []
  for (let r = rowOf(minZ + 0.02); r <= rowOf(maxZ - 0.02); r++) for (let cc = colOf(minX + 0.02); cc <= colOf(maxX - 0.02); cc++) out.push([cc, r])
  return out
}

export function canDesk(o: OfficeState, p: DeskPos, opts: PlaceOpts = {}): Check {
  const occ = occupancy(o)
  const part = partOf(deskCells(p))
  if (part) return no(part)
  for (const [c, r] of deskCells(p)) {
    const k = cellKey(c, r)
    if (!inGrid(c, r)) return no('Ra ngoài phòng')
    if (reserved(c, r)) return no('Để trống lối vào và sảnh chờ')
    if (fixedBlock(c, r)) return no('Vướng chỗ cố định của văn phòng')
    if (isFixedWall(c, r)) return no('Vướng tường')
    if (!cellOpen(o, c, r)) return no('Phòng này chưa mở')
    if (occ.floor.has(k)) return no('Vướng đồ khác')
    if (opts.blocked?.(c, r)) return no('Vướng bàn khác')
  }
  return ok
}

// ───────────────────────── Lệnh ─────────────────────────

export type Action =
  /** Mở một phòng đang khoá */
  | { action: 'room'; room: string }
  | { action: 'buy'; item: string; c: number; r: number; rot: number }
  /** Dời một món đang đặt, hoặc lấy từ kho ra đặt (miễn phí) */
  | { action: 'place'; uid: string; c: number; r: number; rot: number }
  | { action: 'store'; uid: string }
  | { action: 'sell'; uid: string }
  | { action: 'desk'; slot: string; x: number; z: number; yaw: number }
  /** Đưa bàn đã dời về chỗ gốc (x, z, yaw = chỗ gốc, để kiểm còn trống không) */
  | { action: 'deskReset'; slot: string; x: number; z: number; yaw: number }
  /** Đồ để bàn của một agent: mua (cần đủ cấp) / bán lại nửa giá */
  | { action: 'deskBuy' | 'deskSell'; agent: string; item: string }

export type Result = { office: OfficeState } | { error: string; status: number }

const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v)
const YAWS = [0, Math.PI, Math.PI / 2, -Math.PI / 2]

/** Kiểm dạng lệnh gửi lên (server nhận JSON bất kỳ) */
export function parseAction(v: unknown): Action | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  switch (a.action) {
    case 'room': return typeof a.room === 'string' && a.room.length < 40 ? { action: 'room', room: a.room } : null
    case 'buy': return typeof a.item === 'string' && int(a.c) && int(a.r) && int(a.rot) ? { action: 'buy', item: a.item, c: a.c as number, r: a.r as number, rot: a.rot as number } : null
    case 'place': return typeof a.uid === 'string' && int(a.c) && int(a.r) && int(a.rot) ? { action: 'place', uid: a.uid, c: a.c as number, r: a.r as number, rot: a.rot as number } : null
    case 'store': case 'sell': return typeof a.uid === 'string' ? { action: a.action, uid: a.uid } : null
    case 'desk': case 'deskReset':
      return typeof a.slot === 'string' && a.slot.length < 40 && typeof a.x === 'number' && typeof a.z === 'number' && typeof a.yaw === 'number'
        && Number.isFinite(a.x) && Number.isFinite(a.z) && YAWS.some((y) => Math.abs(y - (a.yaw as number)) < 1e-3)
        ? { action: a.action, slot: a.slot, x: a.x, z: a.z, yaw: a.yaw } : null
    case 'deskBuy': case 'deskSell':
      return typeof a.agent === 'string' && a.agent.length > 0 && a.agent.length < 80 && typeof a.item === 'string'
        ? { action: a.action, agent: a.agent, item: a.item } : null
    default: return null
  }
}

/** Giá của một lệnh (âm = được trả lại Xu) */
export function costOf(o: OfficeState, a: Action): number {
  switch (a.action) {
    case 'room': return unlockBlock(o, a.room) ? 0 : nextRoomPrice(o)
    case 'buy': return itemById.get(a.item)?.price ?? 0
    case 'sell': {
      const p = o.items.find((x) => x.uid === a.uid)
      return p ? -sellValue(p) : 0
    }
    case 'deskBuy': return hasDeskItem(o, a.agent, a.item) ? 0 : deskItemById.get(a.item)?.price ?? 0
    case 'deskSell': return hasDeskItem(o, a.agent, a.item) ? -resale(deskItemById.get(a.item)?.price ?? 0) : 0
    default: return 0
  }
}

/** Bán lại một món được bao nhiêu Xu: nửa giá, đồ có sẵn khi mở phòng thì 0 */
export const sellValue = (p: Placed) => (p.kit ? 0 : resale(itemById.get(p.item)?.price ?? 0))

export const hasDeskItem = (o: OfficeState, agent: string, item: string) => !!o.deskItems[agent]?.includes(item)


/**
 * Làm một lệnh. `have` = Xu còn trong quỹ (tính từ sổ EXP), `uid` tạo id mới.
 * Trả trạng thái mới, hoặc lỗi kèm mã HTTP (400 sai lệnh, 409 chưa đủ Xu / không đặt được).
 */
export function apply(o: OfficeState, a: Action, have: number, now: number, uid: () => string, opts: PlaceOpts = {}): Result {
  const err = (error: string, status = 409): Result => ({ error, status })
  const pay = (kind: Spend['kind'], ref: string, xu: number): Spend[] => [...o.spent, { id: uid(), at: now, kind, ref, xu }]
  const price = costOf(o, a)
  if (price > 0 && have < price) return err(`Chưa đủ Xu: cần ${price}, quỹ còn ${have}`)

  switch (a.action) {
    case 'room': {
      const rm = roomById.get(a.room)
      if (!rm) return err('Không có phòng này', 400)
      const why = unlockBlock(o, rm.id)
      if (why) return err(why)
      return { office: { ...o, rooms: { ...o.rooms, [rm.id]: now }, items: [...o.items, ...kitOf(rm, uid, now)], spent: pay('room', rm.id, price) } }
    }
    case 'buy': {
      const i = itemById.get(a.item)
      if (!i) return err('Không có món này', 400)
      const chk = canPlace(o, i, a.c, a.r, a.rot, opts)
      if (!chk.ok) return err(chk.why!)
      const p: Placed = { uid: uid(), item: i.id, c: a.c, r: a.r, rot: a.rot, at: now }
      return { office: { ...o, items: [...o.items, p], spent: pay('buy', i.id, i.price) } }
    }
    case 'place': {
      const p = o.items.find((x) => x.uid === a.uid)
      const i = p && itemById.get(p.item)
      if (!p || !i) return err('Không có món này', 400)
      const chk = canPlace(o, i, a.c, a.r, a.rot, { ...opts, ignore: p.uid })
      if (!chk.ok) return err(chk.why!)
      return { office: { ...o, items: o.items.map((x) => (x === p ? { ...x, c: a.c, r: a.r, rot: a.rot, stored: undefined } : x)) } }
    }
    case 'store': {
      const p = o.items.find((x) => x.uid === a.uid)
      if (!p) return err('Không có món này', 400)
      return { office: { ...o, items: o.items.map((x) => (x === p ? { ...x, stored: true } : x)) } }
    }
    case 'sell': {
      const p = o.items.find((x) => x.uid === a.uid)
      if (!p) return err('Không có món này', 400)
      return { office: { ...o, items: o.items.filter((x) => x !== p), spent: pay('sell', p.item, price) } }
    }
    case 'desk': {
      const p: DeskPos = { x: a.x, z: a.z, yaw: a.yaw }
      const chk = canDesk(o, p, opts)
      if (!chk.ok) return err(chk.why!)
      return { office: { ...o, desks: { ...o.desks, [a.slot]: p } } }
    }
    case 'deskReset': {
      if (!o.desks[a.slot]) return { office: o }
      const chk = canDesk(o, { x: a.x, z: a.z, yaw: a.yaw }, opts)
      if (!chk.ok) return err(`Chỗ cũ không còn trống: ${chk.why}`)
      const desks = { ...o.desks }
      delete desks[a.slot]
      return { office: { ...o, desks } }
    }
    case 'deskBuy': {
      const d = deskItemById.get(a.item)
      if (!d) return err('Không có món này', 400)
      if (hasDeskItem(o, a.agent, d.id)) return { office: o }
      const lv = opts.levelOf?.(a.agent) ?? 0
      if (lv < d.level) return err(`${d.name} mở khoá ở cấp ${d.level}`)
      const mine = [...(o.deskItems[a.agent] ?? []), d.id]
      return { office: { ...o, deskItems: { ...o.deskItems, [a.agent]: mine }, spent: pay('deskBuy', `${a.agent}:${d.id}`, d.price) } }
    }
    case 'deskSell': {
      if (!hasDeskItem(o, a.agent, a.item)) return err('Bàn này không có món đó', 400)
      const left = o.deskItems[a.agent].filter((x) => x !== a.item)
      const deskItems = { ...o.deskItems }
      if (left.length) deskItems[a.agent] = left
      else delete deskItems[a.agent]
      return { office: { ...o, deskItems, spent: pay('deskSell', `${a.agent}:${a.item}`, price) } }
    }
  }
}

// ───────────────────────── Sửa nhà ─────────────────────────

/**
 * Văn phòng lưu theo bố cục nhà cũ, nay nhà đã sửa (trang thiết kế nhà): phòng đã mở mà nay không còn (hoặc thành phòng
 * mở sẵn) thì trả lại Xu đã mở; đồ hết chỗ (ngoài phòng, vướng tường / vách mới, phòng chưa mở) cất vào kho; bàn đã dời
 * sai chỗ thì về chỗ cũ. Đồ có sẵn (kit) của phòng mở sẵn chưa từng đặt thì đặt vào (vướng thì cất kho), mỗi món một lần.
 * Không có gì sai thì trả lại đúng object cũ.
 */
export function fitHouse(o: OfficeState): OfficeState {
  let changed = false
  const rooms: OfficeState['rooms'] = {}
  const gone = new Set<string>()
  for (const [id, at] of Object.entries(o.rooms)) {
    const rm = roomById.get(id)
    if (rm && !rm.start) rooms[id] = at
    else { gone.add(id); changed = true }
  }
  const spent = gone.size ? o.spent.filter((s) => !(s.kind === 'room' && gone.has(s.ref))) : o.spent
  let next: OfficeState = { ...o, rooms, spent, items: o.items.filter((p) => p.stored), desks: {} }

  for (const p of o.items.filter((x) => !x.stored)) {
    const i = itemById.get(p.item)
    const fits = !!i && canPlace(next, i, p.c, p.r, p.rot).ok
    if (!fits) changed = true
    next = { ...next, items: [...next.items, fits ? p : { ...p, stored: true }] }
  }
  // Giữ thứ tự món như cũ
  const byUid = new Map(next.items.map((p) => [p.uid, p]))
  next.items = o.items.flatMap((p) => byUid.get(p.uid) ?? [])

  for (const [slot, d] of Object.entries(o.desks)) {
    if (canDesk(next, d).ok) next.desks[slot] = d
    else changed = true
  }

  const kits = new Set(o.kits ?? [])
  for (const rm of ROOMS) {
    if (!rm.start) continue
    const keys = rm.kit.map((k) => `${rm.id}:${k.item}:${k.c}:${k.r}`)
    let n = 0
    kitOf(rm, () => `kit-${keys[n++]}`, 0).forEach((p, k) => {
      if (kits.has(keys[k])) return
      kits.add(keys[k])
      const i = itemById.get(p.item)
      const fits = !!i && canPlace(next, i, p.c, p.r, p.rot).ok
      next = { ...next, items: [...next.items, fits ? p : { ...p, stored: true }] }
      changed = true
    })
  }
  if (kits.size) next.kits = [...kits]
  return changed ? next : o
}
