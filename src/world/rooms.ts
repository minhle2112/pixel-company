import type { WallKind } from '../data/catalog'
import { CELL, cellKey, cellX, cellZ, COLS, ROWS, type OfficeState, type Placed } from '../data/officeState'
import { HOUSE, roomBounds, type HouseKit, type RoomUse } from './house'
import { houseDoors, houseGrid, housePartitions, type PartKind } from './houseMap.mjs'

/*
 * Các phòng trong toà nhà: src/data/house.json (sửa ở trang thiết kế nhà cutter.html, mục 🏠; xem src/world/house.ts).
 * Mỗi phòng ghép từ một hay nhiều khúc chữ nhật. Ô sát phòng (kể cả chéo) mà không thuộc phòng nào là tường cao cố định
 * (src/pixel/walls.ts vẽ); ô xa hơn là ngoài nhà. Cửa giữa hai phòng nằm trên tường; cửa rộng 2 ô trên tường ngang là
 * cửa kính tự mở, cửa khác là lối đi trống. Trong phòng có thể có vách (thấp, kính, cao) và cửa trên vách, cũng vẽ ở
 * trang thiết kế nhà; người chơi không xây / dỡ vách, chỉ đặt đồ.
 *
 * Lúc đầu chỉ mở các phòng "mở sẵn". Phòng khác khoá: tường kín, phủ tối. Trả Xu để mở một phòng có cửa thông với
 * phòng đã mở; phòng mở sau đắt hơn (ROOM_PRICES). Mở xong có sẵn vài món hợp phòng (kit, bán không được Xu).
 * Không phụ thuộc React hay PixiJS: server dùng chung để kiểm giá.
 */

export type Cell = [number, number]

if (HOUSE.size[0] !== COLS || HOUSE.size[1] !== ROWS)
  throw new Error(`src/data/house.json (${HOUSE.size.join('×')} ô) không khớp maps/office.tmj (${COLS}×${ROWS}): chạy npm run house`)

/** Giá mở phòng theo thứ tự mở (phòng thứ nhất, thứ hai...), không theo phòng nào */
export const ROOM_PRICES = HOUSE.prices

export interface Rect { c0: number; c1: number; r0: number; r1: number }

export interface Room {
  id: string
  name: string
  icon: string
  blurb: string
  /** Mở sẵn từ đầu */
  start: boolean
  /** Các khúc chữ nhật (ô, tính cả hai đầu) */
  rects: Rect[]
  /** Khung bao (ô, tính cả hai đầu) */
  c0: number; c1: number; r0: number; r1: number
  /** Khúc lớn nhất (mét): đặt nhãn, đèn trần, chỗ tán gẫu */
  main: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Có cụm bàn của agent */
  desks: boolean
  kit: HouseKit[]
  /** Phòng nghỉ / phòng ngủ của agent rảnh */
  use?: RoomUse
}

export interface Door {
  id: string
  cells: Cell[]
  /** Hai phòng cửa này nối */
  rooms: [string, string]
  /** Nằm trên tường dọc (nối phòng tây với phòng đông) */
  vertical: boolean
}

/** Ô → chỉ số phòng (≥ 0), -1 = tường, -2 = ngoài nhà */
const owner = houseGrid(HOUSE)

const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS

export const ROOMS: Room[] = HOUSE.rooms.map((h, k) => {
  const rects = h.rects.map(([c0, r0, c1, r1]) => ({ c0, r0, c1, r1 }))
  const big = rects.reduce((a, b) => ((b.c1 - b.c0 + 1) * (b.r1 - b.r0 + 1) > (a.c1 - a.c0 + 1) * (a.r1 - a.r0 + 1) ? b : a))
  return {
    id: h.id, name: h.name, icon: h.icon, blurb: h.blurb, start: !!h.start, rects, ...roomBounds(h.rects),
    main: { minX: cellX(big.c0), maxX: cellX(big.c1 + 1), minZ: cellZ(big.r0), maxZ: cellZ(big.r1 + 1) },
    desks: HOUSE.pods.some(([x, z]) => owner[Math.floor(z) * COLS + Math.floor(x)] === k),
    kit: h.kit ?? [],
    use: h.use,
  }
})
export const roomById = new Map(ROOMS.map((r) => [r.id, r]))

/** Phòng chứa ô (c, r); tường / ngoài toà nhà thì undefined */
export const roomOfCell = (c: number, r: number): Room | undefined => (inGrid(c, r) ? ROOMS[owner[r * COLS + c]] : undefined)
/** Phòng chứa điểm (mét) */
export const roomAt = (x: number, z: number) => roomOfCell(Math.floor((x - cellX(0)) / CELL), Math.floor((z - cellZ(0)) / CELL))

/** Ô là tường cố định của toà nhà (kể cả chỗ cửa) hoặc ngoài nhà: không đặt gì được */
export const isFixedWall = (c: number, r: number) => inGrid(c, r) && owner[r * COLS + c] < 0
/** Ô ngoài nhà (không vẽ tường, không ai tới được) */
export const isOutside = (c: number, r: number) => inGrid(c, r) && owner[r * COLS + c] === -2

export const DOORS: Door[] = houseDoors(HOUSE, owner)
  .filter((d): d is typeof d & { rooms: [string, string] } => !!d.rooms[0] && !!d.rooms[1])
  .map((d) => ({ id: d.id, cells: d.cells, rooms: d.rooms, vertical: d.vertical }))

// ───────────────────────── Phòng đã mở ─────────────────────────

export const isOpen = (o: OfficeState, id: string) => !!roomById.get(id)?.start || o.rooms[id] !== undefined
export const openRooms = (o: OfficeState) => ROOMS.filter((r) => isOpen(o, r.id))
/** Ô nằm trong phòng đã mở */
export const cellOpen = (o: OfficeState, c: number, r: number) => {
  const rm = roomOfCell(c, r)
  return !!rm && isOpen(o, rm.id)
}
export const doorOpen = (o: OfficeState, d: Door) => isOpen(o, d.rooms[0]) && isOpen(o, d.rooms[1])

/** Cột tường bắc của toà nhà thuộc một phòng đã mở (treo đồ được) */
export const northOpen = (o: OfficeState, c: number) => cellOpen(o, c, 0)

/** Số phòng đã mở bằng Xu */
export const boughtRooms = (o: OfficeState) => ROOMS.filter((r) => !r.start && o.rooms[r.id] !== undefined).length
/** Giá mở phòng tiếp theo */
export const nextRoomPrice = (o: OfficeState) => ROOM_PRICES[Math.min(boughtRooms(o), ROOM_PRICES.length - 1)]

/** Lý do chưa mở được phòng (null = mở được, chỉ còn chờ đủ Xu) */
export function unlockBlock(o: OfficeState, id: string): string | null {
  const rm = roomById.get(id)
  if (!rm) return 'Không có phòng này'
  if (isOpen(o, id)) return 'Phòng đã mở'
  const next = DOORS.some((d) => d.rooms.includes(id) && isOpen(o, d.rooms[0] === id ? d.rooms[1] : d.rooms[0]))
  return next ? null : 'Mở phòng bên cạnh trước'
}

/** Các món có sẵn của phòng, đặt ở ô thật */
export const kitOf = (rm: Room, uid: () => string, now: number): Placed[] =>
  rm.kit.map((k) => ({ uid: uid(), item: k.item, c: rm.c0 + k.c, r: rm.r0 + k.r, rot: k.rot ?? 0, at: now, kit: true }))

// ───────────────────────── Tường, vách, cửa ─────────────────────────

/** Vách trong phòng (house.json partitions): ô "c,r" → loại, kể cả ô cửa trên vách */
const PARTS = housePartitions(HOUSE)
/** Ô có vách trong phòng (kể cả cửa trên vách, phải để trống): không đặt đồ được */
export const partAt = (c: number, r: number): PartKind | undefined => PARTS.get(cellKey(c, r))

/** Một cửa: các ô, nằm trên tường / vách dọc không, cửa kính tự mở (2 ô trên tường / vách cao chạy ngang) hay lối đi trống */
export interface BuiltDoor { cells: Cell[]; vertical: boolean; glass: boolean }

export interface Building {
  /** Ô "c,r" → loại vách: tường giữa các phòng (cao), vách trong phòng. Không gồm ô cửa đi qua được */
  walls: Map<string, WallKind>
  doors: BuiltDoor[]
}

const ALL_WALLS: Cell[] = []
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (owner[r * COLS + c] === -1) ALL_WALLS.push([c, r])

const PART_WALLS = [...PARTS].filter((e): e is [string, WallKind] => e[1] !== 'door')
const PART_DOORS: BuiltDoor[] = (HOUSE.partitions ?? []).filter((p) => p[4] === 'door').flatMap(([c0, r0, c1, r1]) => {
  const cells: Cell[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (partAt(c, r) === 'door') cells.push([c, r])
  if (!cells.length) return []
  const vertical = r1 > r0
  const glass = !vertical && cells.length === 2 && (partAt(c0 - 1, r0) === 'tall' || partAt(c1 + 1, r0) === 'tall')
  return [{ cells, vertical, glass }]
})

let built: { key: string; b: Building } | null = null

/**
 * Tường, vách, cửa của toà nhà theo các phòng đang mở (để vẽ, tính va chạm, tìm đường): tường giữa các phòng là
 * tường cao; cửa giữa hai phòng đã mở thì thành cửa (kính hoặc lối đi trống), phòng còn khoá thì tường kín.
 */
export function building(o: OfficeState): Building {
  const open = DOORS.filter((d) => doorOpen(o, d))
  const key = open.map((d) => d.id).join('|')
  if (built?.key === key) return built.b
  const walls = new Map<string, WallKind>()
  for (const [c, r] of ALL_WALLS) walls.set(cellKey(c, r), 'tall')
  for (const [k, kind] of PART_WALLS) walls.set(k, kind)
  const doors = [...PART_DOORS]
  for (const d of open) {
    for (const [c, r] of d.cells) walls.delete(cellKey(c, r))
    doors.push({ cells: d.cells, vertical: d.vertical, glass: d.cells.length === 2 && !d.vertical })
  }
  built = { key, b: { walls, doors } }
  return built.b
}
