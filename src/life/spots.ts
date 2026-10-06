import { footprint, itemById, type Item } from '../data/catalog'
import { CELL, cellKey, cellX, cellZ, colOf, rowOf, type OfficeState, type Placed } from '../data/officeState'
import { cellIndex, flood, snapFree, type Nav } from '../world/nav'
import { BOARD, OFFICE, PODS, SPAWN, WINDOWS, type Activity, type Vec2, type World } from '../world/layout'
import { building, openRooms, roomAt } from '../world/rooms'

/**
 * Những chỗ agent rảnh đi tới (chỉ trong phòng đã mở): cửa sổ, bảng ticket, góc tán gẫu,
 * và đồ đã mua ở cửa hàng: ngồi sofa / ghế bành, pha cà phê, mở tủ lạnh, chơi máy game, đánh bi-a, vuốt mèo...
 * Dựng lại khi bố cục hoặc phòng đã mở đổi. Bạn (người chơi) cũng dùng được các chỗ của đồ đã mua (phím E).
 */
export interface Spot extends Vec2 {
  id: string
  /** Hướng nhìn khi đứng / ngồi ở đây */
  yaw?: number
  act?: Activity
  /** Khu: agent ở cùng khu thì dễ bắt chuyện với nhau */
  area?: string
  /** Có thì agent ngồi ở đây; giá trị = độ cao mặt ghế so với ghế văn phòng (m) */
  sit?: number
  /** Chỗ ngồi trên đồ: đứng ở điểm này (phía trước đồ) rồi mới bước vào / bước ra */
  via?: Vec2
  /** Hệ số chọn (mặc định 1): đồ mới mua hấp dẫn hơn một chút */
  weight?: number
  /** Món đồ (uid) của chỗ này: bạn bấm E ở gần thì dùng được */
  item?: string
  /** Phòng chứa chỗ này (id trong house.json) */
  room?: string
}

let list: Spot[] = []
const byId = new Map<string, Spot>()

export function setSpots(next: Spot[]) {
  list = next
  byId.clear()
  for (const s of next) byId.set(s.id, s)
}
export const allSpots = () => list
export const spotById = (id: string | null | undefined) => (id ? byId.get(id) : undefined)

const N = Math.PI
const E = Math.PI / 2

/** Hướng mặt của đồ theo rot (0 xuống, 1 trái, 2 lên, 3 phải): vector và yaw (forward = (sin yaw, cos yaw)) */
const FACE: { x: number; z: number; yaw: number }[] = [
  { x: 0, z: 1, yaw: 0 }, { x: -1, z: 0, yaw: -E }, { x: 0, z: -1, yaw: N }, { x: 1, z: 0, yaw: E },
]

/** Chỗ ngồi / chỗ dùng của một món đã đặt (toạ độ mét) */
function itemSpots(n: Nav, i: Item, p: Placed): Spot[] {
  const out: Spot[] = []
  const at = (q: Vec2) => snapFree(n, q)
  const { w, d } = footprint(i, p.rot)
  const cx = cellX(p.c) + (w * CELL) / 2, cz = cellZ(p.r) + (d * CELL) / 2
  // Đồ lật / không xoay: mặt trước luôn nhìn xuống (về camera)
  const f = i.turn === 'four' || i.turn === 'two' ? FACE[p.rot] ?? FACE[0] : FACE[0]
  const lat = { x: -f.z, z: f.x }
  const depth = (f.x ? w : d) * CELL
  const id = (k: number | string) => `${p.uid}:${k}`
  const area = `item-${p.uid}`
  const use = i.use
  if (use?.kind === 'seat') {
    const seat = use
    // Ngồi ở hàng ghế phía trước của món, nhìn theo hướng món; bước vào từ phía trước
    const fwd = depth / 2 - CELL / 2 - (seat.sink ?? 0)
    const row = { x: cx + f.x * fwd, z: cz + f.z * fwd }
    for (let k = 0; k < seat.n; k++) {
      const o = (k - (seat.n - 1) / 2) * seat.gap
      const s = { x: row.x + lat.x * o, z: row.z + lat.z * o }
      const out1 = (seat.back ? -1 : 1) * (CELL / 2 + 0.4)
      const via = at({ x: s.x + f.x * out1, z: s.z + f.z * out1 })
      out.push({ id: id(k), ...s, yaw: f.yaw, act: seat.act, area, sit: 0, via, weight: 1.6, item: p.uid })
    }
    return out
  }
  if (use?.kind === 'stand') {
    // Đứng trước mặt đồ, quay mặt vào đồ
    const cnt = use.n ?? 1
    const span = (f.x ? d : w) * CELL
    const front = { x: cx + f.x * (depth / 2 + (use.dist ?? 0.4)), z: cz + f.z * (depth / 2 + (use.dist ?? 0.4)) }
    for (let k = 0; k < cnt; k++) {
      const o = cnt > 1 ? (k - (cnt - 1) / 2) * Math.min(0.8, span / cnt) : 0
      out.push({ id: id(k), ...at({ x: front.x + lat.x * o, z: front.z + lat.z * o }), yaw: f.yaw + N, act: use.act, area, weight: 1.4, item: p.uid })
    }
    return out
  }
  if (use?.kind === 'pair') {
    // Hai người hai đầu bàn (bóng bàn dọc: bắc / nam; bi-a ngang: tây / đông), cùng khu nên hay rủ nhau
    const act = use.act
    const along = d > w ? { x: 0, z: 1 } : { x: 1, z: 0 }
    const half = ((d > w ? d : w) * CELL) / 2 + 0.26
    for (const sgn of [-1, 1]) {
      const q = at({ x: cx + along.x * half * sgn, z: cz + along.z * half * sgn })
      out.push({ id: id(sgn < 0 ? 'a' : 'b'), ...q, yaw: Math.atan2(cx - q.x, cz - q.z), act, area, weight: 1.6, item: p.uid })
    }
    return out
  }
  if (use?.kind === 'pet') {
    const q = at({ x: cx + 0.15, z: cz + d * CELL / 2 + 0.35 })
    out.push({ id: id(0), ...q, yaw: Math.atan2(cx - q.x, cz - q.z), act: use.act, area, weight: 1.3, item: p.uid })
    return out
  }
  if (use?.kind === 'bed') {
    // Nằm: đầu trên gối (ô trên cùng), bước vào từ cạnh giường (bên phải, chật thì bên trái). Bạn không nằm được (không có `item`)
    const head = { x: cx, z: cz - depth / 2 + CELL / 2 }
    const side = (s: number) => at({ x: cx + s * (w * CELL / 2 + 0.35), z: cz })
    const r = side(1), l = side(-1)
    const via = Math.hypot(r.x - cx, r.z - cz) <= Math.hypot(l.x - cx, l.z - cz) ? r : l
    out.push({ id: id(0), ...head, yaw: 0, act: use.act, area, sit: 0, via, weight: 0.7 })
    return out
  }
  if (use?.kind === 'watch') {
    // Đồ treo tường bắc (TV): đứng xem cách tường một đoạn
    for (const dx of [-0.45, 0.45]) out.push({ id: id(dx < 0 ? 'L' : 'R'), ...at({ x: cx + dx, z: BOARD.z + 1.6 }), yaw: N, act: use.act, area, weight: 1.2, item: p.uid })
  }
  return out
}

export function officeSpots(world: World, office: OfficeState): Spot[] {
  const n = world.nav
  const at = (p: Vec2) => snapFree(n, p)
  const out: Spot[] = []
  const open = new Set(openRooms(office).map((r) => r.id))
  // Cửa sổ (của phòng đã mở): đứng ngay dưới, nhìn ra ngoài (về phía bắc)
  WINDOWS.forEach((x, i) => {
    const rm = roomAt(x, OFFICE.minZ + 0.25)
    if (rm && open.has(rm.id)) out.push({ id: `win${i}`, ...at({ x, z: OFFICE.minZ + 0.75 }), yaw: N, act: 'window', area: 'window' })
  })
  // Bảng ticket
  for (const dx of [-0.8, 0.8]) out.push({ id: `kanban${dx < 0 ? 'L' : 'R'}`, ...at({ x: BOARD.x + dx, z: BOARD.z + 1.25 }), yaw: N, act: 'kanban', area: 'kanban' })
  // Bảng vinh danh (nếu đã mua): đứng xem xếp hạng
  for (const p of office.items) {
    const i = itemById.get(p.item)
    if (i?.id !== 'fame' || p.stored) continue
    const cx = cellX(p.c) + (i.w * CELL) / 2
    for (const dx of [-0.8, 0.8]) out.push({ id: `fame${dx < 0 ? 'L' : 'R'}`, ...at({ x: cx + dx, z: BOARD.z + 1.25 }), yaw: N, act: 'fame', area: 'fame' })
  }
  // Góc tán gẫu: hai chỗ đứng đối mặt. Phòng có cụm bàn: khoảng trống hai bên dãy cụm bàn; phòng khác: gần mép nam.
  // Phòng ngủ thì không (người khác đang ngủ)
  const chats: Vec2[] = []
  for (const rm of openRooms(office)) {
    const m = rm.main
    if (rm.use === 'sleep') continue
    if (!rm.desks) { chats.push({ x: (m.minX + m.maxX) / 2, z: m.maxZ - 1.6 }); continue }
    const zs = PODS.filter((p) => roomAt(p.x, p.z) === rm).map((p) => p.z)
    const z0 = Math.min(...zs), z1 = Math.max(...zs)
    chats.push({ x: m.minX + 1.1, z: z0 }, { x: m.maxX - 1.1, z: z0 })
    if (z1 > z0) chats.push({ x: m.minX + 1.1, z: z1 }, { x: m.maxX - 1.1, z: z1 })
  }
  chats.forEach(({ x, z }, i) => {
    out.push({ id: `chat${i}a`, ...at({ x: x - 0.55, z }), yaw: E, act: 'chat', area: `chat${i}` })
    out.push({ id: `chat${i}b`, ...at({ x: x + 0.55, z }), yaw: -E, act: 'chat', area: `chat${i}` })
  })
  // Đồ đã mua: chỗ ngồi / chỗ dùng (bỏ chỗ không đi tới được, vd bị vách quây kín).
  // Vách bao sát món: chỗ đứng bị đẩy ra ngoài vòng vách (snapFree) nên vẫn tới được, phải kiểm thêm vách nằm giữa chỗ đứng và món
  const reach = flood(n, SPAWN)
  const ok = (p: Vec2) => reach[cellIndex(n, snapFree(n, p))] === 1
  const walls = building(office).walls
  const wallBetween = (a: Vec2, b: Vec2) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 4))
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0
      const k = cellKey(colOf(a.x + (b.x - a.x) * t), rowOf(a.z + (b.z - a.z) * t))
      if (walls.has(k)) return true
    }
    return false
  }
  for (const p of office.items) {
    const i = itemById.get(p.item)
    if (!i || p.stored) continue
    const { w, d } = footprint(i, p.rot)
    const mid = { x: cellX(p.c) + (w * CELL) / 2, z: cellZ(p.r) + (d * CELL) / 2 }
    // Đồ treo tường (TV): đứng xem từ xa, không cần sát món
    for (const sp of itemSpots(n, i, p)) if (ok(sp.via ?? sp) && (i.mount === 'wall' || !wallBetween(sp.via ?? sp, mid))) out.push(sp)
  }
  for (const s of out) s.room = roomAt(s.x, s.z)?.id
  return out
}
