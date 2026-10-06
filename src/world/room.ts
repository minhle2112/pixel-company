import { MAP_MARKERS as M } from './mapMarkers'

/*
 * Kích thước và đồ cố định của căn phòng: layout.ts, trạng thái văn phòng và server dùng chung.
 * Vị trí cửa sổ, bảng ticket, cửa, chỗ xuất hiện, sảnh chờ lấy từ các mốc trong bản đồ Tiled (maps/office.tmj,
 * qua file sinh mapMarkers.ts, không phụ thuộc gì nên server cũng dùng được).
 */

export interface Vec2 { x: number; z: number }

/** Hộp va chạm theo trục. h = chiều cao; cam = chặn camera (tường đặc). */
export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; h: number; cam?: boolean }

export interface DeskSlot {
  id: string
  /** open = bàn trong cụm bàn; lead = bàn riêng của Lead */
  zone: 'open' | 'lead'
  seat: Vec2
  /** Hướng agent nhìn khi ngồi (bàn nằm phía trước). forward = (sin yaw, cos yaw) */
  yaw: number
  /** Bàn bạn đã dời: chỗ gốc (ghế + hướng) để đưa về */
  home?: { x: number; z: number; yaw: number }
}

/** Việc agent làm khi dừng ở một chỗ (quyết định dáng, đồ cầm tay, câu nói) */
export type Activity =
  | 'coffee' | 'fridge' | 'water' | 'window' | 'tv' | 'foos' | 'books' | 'sofa' | 'beanbag' | 'stool' | 'meeting' | 'kanban' | 'fame'
  // Đồ mua ở cửa hàng: máy game, bi-a, mèo, bảng trắng, bếp, máy bán nước
  | 'game' | 'pool' | 'pet' | 'board' | 'cook' | 'snack'
  // Đứng tán gẫu
  | 'chat'
  // Nằm ngủ trên giường
  | 'sleep'

/** Pixel của bản đồ mỗi mét (1 m = 2 ô 16 px) */
const MAP_PPM = 2 * M.tile

/**
 * Cả toà nhà (mét), lấy từ mốc "room" (sàn) của bản đồ: x giữa toà = 0, tường bắc ở z = -8.
 * Bên trong chia thành các phòng (src/world/rooms.ts).
 */
export const OFFICE = {
  minX: -M.room.w / MAP_PPM / 2, maxX: M.room.w / MAP_PPM / 2, minZ: -8, maxZ: -8 + M.room.h / MAP_PPM, wallH: 3.2, wallT: 0.3,
}
if (M.room.w % M.tile || M.room.h % M.tile) throw new Error('maps/office.tmj: mốc "room" phải phủ trọn ô')
/** Toạ độ pixel trong bản đồ → mét, làm tròn để khỏi lệch ô lưới (5.1999… thay vì 5.2) */
const round = (v: number) => Math.round(v * 1e4) / 1e4
const mx = (p: number) => round((p - M.room.x) / MAP_PPM + OFFICE.minX)
const mz = (p: number) => round((p - M.room.y) / MAP_PPM + OFFICE.minZ)

export const SPAWN: Vec2 = { x: mx(M.spawn.x), z: mz(M.spawn.y) }

/** Tâm các cụm bàn của agent (mốc pod1, pod2... trong bản đồ), lấp theo thứ tự tên */
export const PODS: Vec2[] = M.pods.map((p) => ({ x: mx(p.x), z: mz(p.y) }))

/** Bàn riêng của Lead (mốc lead1, lead2... trong bản đồ, đặt ở trang thiết kế nhà): chỗ ngồi + hướng nhìn */
const FACE_YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }
export const LEAD_DESKS: DeskSlot[] = M.leads.map((p, i) => ({ id: `lead${i}`, zone: 'lead', seat: { x: mx(p.x), z: mz(p.y) }, yaw: FACE_YAW[p.face] }))

/** Sảnh chờ bên phải cửa vào: ứng viên đứng chờ bạn duyệt hồ sơ, mặt nhìn vào văn phòng (hơi xoay vào giữa). */
const LOBBY_YAW = [Math.PI - 0.2, Math.PI + 0.25]
export const LOBBY: (Vec2 & { yaw: number })[] = M.lobby.map((p, i) => ({ x: mx(p.x), z: mz(p.y), yaw: LOBBY_YAW[i % 2] }))

/**
 * Bảng ticket treo ở tường bắc (mặt bảng nhìn về hướng nam, +z).
 * Bản pixel nhìn từ trên xuống nghiêng về phía bắc: chỉ thấy được mặt tường bắc.
 */
export const BOARD = { x: mx(M.kanban.x + M.kanban.w / 2), y: 1.55, z: OFFICE.minZ + OFFICE.wallT / 2 + 0.04, w: round(M.kanban.w / MAP_PPM), h: 1.6 }

/** Cửa sổ trên tường bắc (toạ độ x tâm, mét) */
export const WINDOWS = M.windows.map((w) => mx(w.x + w.w / 2))

/** Cửa ra vào ở tường nam (toạ độ x tâm, mét) */
export const DOOR_X = mx(M.door.x + M.door.w / 2)

/**
 * Vùng chặn cố định vẽ trong layer Collision của bản đồ (cột, quầy xây sẵn...): không đi qua, không đặt đồ lên.
 * Không ghi chiều cao thì cao như tường, chặn cả camera bản 3D.
 */
export const BLOCKS: AABB[] = M.blocks.map((b) => {
  const h = b.height ?? OFFICE.wallH
  return { minX: mx(b.x), maxX: mx(b.x + b.w), minZ: mz(b.y), maxZ: mz(b.y + b.h), h, cam: h >= OFFICE.wallH }
})

/** Khoảng cách từ ghế tới tâm bàn */
export const SEAT_TO_DESK = 0.83
export const DESK_W = 1.4
export const DESK_D = 0.75

export const forward = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) })

export function box(cx: number, cz: number, w: number, d: number, h: number, cam = false): AABB {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h, cam }
}

export const turned = (yaw = 0) => Math.abs(Math.sin(yaw)) > 0.5

export function deskCenter(s: DeskSlot): Vec2 {
  const f = forward(s.yaw)
  return { x: s.seat.x + f.x * SEAT_TO_DESK, z: s.seat.z + f.z * SEAT_TO_DESK }
}
