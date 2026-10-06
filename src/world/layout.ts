import { footprint, itemById } from '../data/catalog'
import { deskCells } from '../data/decor'
import { CELL, cellKey, cellX, cellZ, emptyOffice, type OfficeState } from '../data/officeState'
import type { Agent } from '../data/types'
import { buildNav, flood, snapFree, cellIndex, type Nav } from './nav'

/*
 * Sơ đồ văn phòng (nhìn từ trên, bắc = -z): toà nhà chia nhiều phòng (maps/office.tmj, src/world/rooms.ts).
 * Lúc đầu mở văn phòng chung (cụm bàn của agent, bảng ticket trên tường bắc) và sảnh (cửa vào, ứng viên chờ);
 * các phòng khác khoá, trả Xu để mở. Rồi mua đồ, dời bàn (src/data/decor.ts).
 * Tường giữa các phòng, vách trong phòng (trang thiết kế nhà), đồ, bàn đã dời đều thành hộp va chạm và chặn lối đi của agent.
 *
 *   ┌─ cửa sổ ─ bảng ─ cửa sổ ─┬─ cửa sổ ──┬─ cửa sổ ──┐
 *   │  Văn phòng chung          │ Phòng họp │ Phòng sếp │
 *   │   (cụm bàn) (cụm bàn)     │           │           │
 *   ├──── lối ────┬──── cửa ────┴───────────┴── cửa ────┤
 *   │ Sảnh        │ Pantry            │ Phòng nghỉ      │
 *   └─ cửa vào ───┴───────────────────┴─────────────────┘
 */

export * from './room'
import { BLOCKS, BOARD, DESK_D, DESK_W, DOOR_X, LEAD_DESKS, OFFICE, PODS, SPAWN, box, deskCenter, turned, type AABB, type DeskSlot, type Vec2 } from './room'
import { building } from './rooms'

// ───────────────────────── Đồ đạc ─────────────────────────

/** Các loại đồ cố định của phòng (src/pixel/office.ts). Phòng trống chỉ có cửa vào; đồ mua ở cửa hàng nằm ở src/data/catalog.ts. */
export type FurnitureKind =
  | 'plant' | 'plantSmall' | 'bookshelf' | 'sofa' | 'coffeeTable' | 'foosball' | 'counter'
  | 'coffeeMachine' | 'fridge' | 'highTable' | 'stool' | 'meetingTable' | 'meetingChair'
  | 'tv' | 'waterCooler' | 'beanbag' | 'rug' | 'door' | 'cabinet' | 'whiteboard'
  | 'kitchen' | 'tvStand' | 'sofaBack' | 'floorLamp' | 'chalkboard' | 'bench' | 'bookshelfWide' | 'fruitBowl' | 'arcade' | 'printer'

export interface Furniture { kind: FurnitureKind; x: number; z: number; yaw?: number; w?: number; d?: number; color?: string }

/** [rộng, sâu, cao] để va chạm; null = không chặn đường */
const SIZE: Record<FurnitureKind, [number, number, number] | null> = {
  plant: [0.55, 0.55, 1.4],
  plantSmall: [0.4, 0.4, 0.8],
  bookshelf: [1.6, 0.4, 2.0],
  sofa: [2.4, 0.9, 0.8],
  coffeeTable: [1.2, 0.6, 0.4],
  foosball: [1.05, 1.6, 0.9],
  counter: [1, 1, 0.95],
  coffeeMachine: null,
  fridge: [0.8, 0.75, 1.9],
  highTable: [0.9, 0.9, 1.05],
  stool: null,
  meetingTable: [3.2, 1.4, 0.75],
  meetingChair: null,
  tv: null,
  waterCooler: [0.4, 0.4, 1.2],
  beanbag: [0.8, 0.8, 0.5],
  rug: null,
  door: null,
  cabinet: [0.85, 0.5, 1.0],
  whiteboard: [0.95, 0.3, 1.6],
  kitchen: [3.4, 0.7, 0.95],
  tvStand: [2.0, 0.55, 1.0],
  sofaBack: [1.5, 0.8, 0.8],
  floorLamp: [0.4, 0.4, 1.6],
  chalkboard: [1.0, 0.3, 1.6],
  bench: [0.95, 0.45, 0.5],
  bookshelfWide: [1.5, 0.4, 2.0],
  fruitBowl: null,
  arcade: [0.5, 0.5, 1.6],
  printer: null,
}

/** Đồ có sẵn từ đầu: chỉ cửa vào */
export const FURNITURE: Furniture[] = [{ kind: 'door', x: DOOR_X, z: OFFICE.maxZ - 0.15 }]

// ───────────────────────── Chỗ ngồi ─────────────────────────

// Cụm bàn: mốc pod1..pod4 trong bản đồ (PODS), lấp theo thứ tự: hàng gần bảng (tường bắc) trước

const podRows = [
  { dz: -1.2, yaw: 0 },
  { dz: 1.2, yaw: Math.PI },
]

function podSlots(p: Vec2, pi: number): DeskSlot[] {
  return podRows.flatMap((r, ri) =>
    [-0.7, 0.7].map((dx, ci): DeskSlot => ({ id: `pod${pi}-${ri}${ci}`, zone: 'open', seat: { x: p.x + dx, z: p.z + r.dz }, yaw: r.yaw })),
  )
}

export interface World {
  /** Bàn được vẽ (kể cả bàn trống) */
  slots: DeskSlot[]
  /** agentId → chỗ ngồi */
  seatOf: Map<string, DeskSlot>
  colliders: AABB[]
  pods: Vec2[]
  /** Lưới tìm đường cho agent */
  nav: Nav
  /** Ô (lưới đặt đồ 0,5 m, khoá cellKey) bàn làm việc đang chiếm: không đặt đồ lên được */
  deskCells: Set<string>
}

/** Phần trạng thái văn phòng làm đổi bố cục hoặc hình (phòng đã mở, đồ đang đặt, bàn đã dời, đồ để bàn); Xu thì không */
export function layoutKey(o: OfficeState) {
  return JSON.stringify([Object.keys(o.rooms).sort(), o.items.filter((p) => !p.stored).map((p) => [p.uid, p.c, p.r, p.rot]), o.desks, o.deskItems])
}

/**
 * Xếp chỗ theo sơ đồ tổ chức (duyệt cây reportsTo): mỗi agent một bàn miễn phí trong các cụm bàn,
 * Lead ngồi trước, thành viên theo nhóm của Lead. Bàn riêng của Lead (trang thiết kế nhà) chia cho các Lead
 * (agent gốc, có thành viên trước); Lead nào không còn bàn riêng thì ngồi cụm bàn như thành viên.
 * Bàn riêng luôn được vẽ, kể cả khi chưa có Lead ngồi. Không có agent con: ai báo cáo cho một thành viên
 * (dữ liệu cũ) cũng ngồi cụm bàn như thành viên, ngay sau người đó.
 * Ứng viên chưa được duyệt không có bàn (đứng ở sảnh).
 */
export function buildWorld(all: Agent[], office?: OfficeState): World {
  const agents = all.filter((a) => !a.candidate)
  const children = new Map<string | null, Agent[]>()
  for (const a of agents) {
    const k = agents.some((b) => b.id === a.reportsTo) ? a.reportsTo : null
    children.set(k, [...(children.get(k) ?? []), a])
  }
  const roots = children.get(null) ?? []
  const ordered: Agent[] = []
  const visit = (a: Agent) => { ordered.push(a); (children.get(a.id) ?? []).forEach(visit) }
  roots.forEach(visit)

  const seatOf = new Map<string, DeskSlot>()
  const leads = [...roots].sort((a, b) => Number(children.has(b.id)) - Number(children.has(a.id))).slice(0, LEAD_DESKS.length)
  leads.forEach((a, i) => seatOf.set(a.id, LEAD_DESKS[i]))
  const openAgents = ordered.filter((a) => !seatOf.has(a.id))

  // Mọi cụm bàn đặt ở trang thiết kế nhà đều vẽ sẵn, kể cả khi chưa đủ agent ngồi
  const pods = PODS
  const openSlots = pods.flatMap(podSlots)
  openAgents.slice(0, openSlots.length).forEach((a, i) => seatOf.set(a.id, openSlots[i]))


  // Bàn bạn đã dời: giữ id chỗ ngồi, đổi vị trí ghế và hướng
  const moved = (sl: DeskSlot): DeskSlot => {
    const p = office?.desks[sl.id]
    return p ? { ...sl, seat: { x: p.x, z: p.z }, yaw: p.yaw, home: { x: sl.seat.x, z: sl.seat.z, yaw: sl.yaw } } : sl
  }
  const slots = [...LEAD_DESKS, ...openSlots].map(moved)
  const byId = new Map(slots.map((sl) => [sl.id, sl]))
  for (const [id, sl] of seatOf) seatOf.set(id, byId.get(sl.id) ?? sl)
  const colliders = buildColliders(slots, office)
  const dc = new Set<string>()
  for (const sl of slots) for (const [c, r] of deskCells({ x: sl.seat.x, z: sl.seat.z, yaw: sl.yaw })) dc.add(cellKey(c, r))
  return { slots, seatOf, colliders, pods, nav: buildNav(OFFICE, colliders), deskCells: dc }
}

/** Vách cao bao nhiêu (m) để chặn đường / camera */
const WALL_H = { low: 1.0, tall: OFFICE.wallH }

function buildColliders(slots: DeskSlot[], office?: OfficeState): AABB[] {
  const { minX, maxX, minZ, maxZ, wallH, wallT } = OFFICE
  const w = maxX - minX, d = maxZ - minZ, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  const out: AABB[] = [
    box(cx, minZ, w + wallT, wallT, wallH, true),
    box(cx, maxZ, w + wallT, wallT, wallH, true),
    box(minX, cz, wallT, d + wallT, wallH, true),
    box(maxX, cz, wallT, d + wallT, wallH, true),
    ...BLOCKS,
  ]
  for (const f of FURNITURE) {
    const s = SIZE[f.kind]
    if (!s) continue
    let fw = f.w ?? s[0], fd = f.d ?? s[1]
    if (turned(f.yaw)) [fw, fd] = [fd, fw]
    out.push(box(f.x, f.z, fw, fd, s[2]))
  }
  for (const s of slots) {
    const c = deskCenter(s)
    const [dw, dd] = turned(s.yaw) ? [DESK_D, DESK_W] : [DESK_W, DESK_D]
    out.push(box(c.x, c.z, dw, dd, 0.75))
  }
  const o = office ?? emptyOffice()
  // Đồ mua ở cửa hàng: hộp theo các ô nó chiếm (thu vào một chút cho agent lách qua khe giữa hai món)
  for (const p of o.items) {
    const i = itemById.get(p.item)
    if (!i || p.stored || i.mount !== 'floor' || i.h <= 0) continue
    const { w, d } = footprint(i, p.rot)
    const x0 = cellX(p.c), z0 = cellZ(p.r)
    out.push({ minX: x0 + 0.06, maxX: x0 + w * CELL - 0.06, minZ: z0 + 0.06, maxZ: z0 + d * CELL - 0.06, h: i.h })
  }
  // Tường giữa các phòng (phòng khoá thì kín), vách trong phòng: mỗi ô một hộp đầy (ô cửa không nằm trong này)
  for (const [k, kind] of building(o).walls) {
    const [c, r] = k.split(',').map(Number)
    out.push({ minX: cellX(c), maxX: cellX(c) + CELL, minZ: cellZ(r), maxZ: cellZ(r) + CELL, h: WALL_H[kind], cam: kind === 'tall' })
  }
  return out
}

/**
 * Còn lối đi từ cửa vào tới mọi bàn làm việc và bảng ticket không. Trả về lý do nếu bị chặn kín
 * (để không cho đặt đồ nhốt agent).
 */
export function blockedReason(w: World): string | null {
  const n = w.nav
  const seen = flood(n, SPAWN)
  for (const sl of w.slots) {
    if (!seen[cellIndex(n, snapFree(n, sl.seat))]) return 'Chặn mất lối tới một bàn làm việc'
  }
  if (!seen[cellIndex(n, snapFree(n, { x: BOARD.x, z: BOARD.z + 1.2 }))]) return 'Chặn mất lối tới bảng ticket'
  return null
}

/** Đẩy hình tròn (x,z,r) ra khỏi các hộp. Sửa trực tiếp p. */
export function resolveCircle(p: Vec2, r: number, boxes: AABB[]) {
  for (let iter = 0; iter < 3; iter++) {
    for (const b of boxes) {
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX))
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ))
      const dx = p.x - cx, dz = p.z - cz
      const d2 = dx * dx + dz * dz
      if (d2 >= r * r) continue
      if (d2 > 1e-8) {
        const dd = Math.sqrt(d2)
        p.x += (dx / dd) * (r - dd)
        p.z += (dz / dd) * (r - dd)
      } else {
        const pen = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z]
        const m = Math.min(...pen)
        if (m === pen[0]) p.x = b.minX - r
        else if (m === pen[1]) p.x = b.maxX + r
        else if (m === pen[2]) p.z = b.minZ - r
        else p.z = b.maxZ + r
      }
    }
  }
}
