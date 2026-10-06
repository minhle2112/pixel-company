import { OFFICE } from '../world/layout'
import { MAP_COLS, MAP_ROWS, MAP_TILE, marker } from './tilemap'

/**
 * Bản pixel: nhìn từ trên xuống, nghiêng về phía bắc như Stardew Valley. Toạ độ thế giới vẫn là mét (x đông, z nam)
 * như bản 3D, để giữ nguyên bố cục, lối đi, đời sống agent. Màn hình: x → phải, z → xuống.
 * Sàn, tường, cửa sổ vẽ theo bản đồ Tiled (maps/office.tmj); mốc "room" trong bản đồ là góc tây bắc của sàn.
 */

/** Pixel (gốc, trước khi phóng to) mỗi mét: 1 m = 2 ô 16 px */
export const PPM = 32
export const TILE = 16

/** Mặt tường bắc cao bao nhiêu pixel (thấy được vì camera nghiêng về phía bắc): 2 ô như tường LimeZu trong bản đồ */
export const WALL_FACE = 32

const ROOM = marker('room')
const MX = ROOM.x
const MY = ROOM.y

if (MAP_TILE !== TILE || ROOM.width !== (OFFICE.maxX - OFFICE.minX) * PPM || ROOM.height !== (OFFICE.maxZ - OFFICE.minZ) * PPM)
  throw new Error('maps/office.tmj không khớp kích thước phòng trong src/world/room.ts')

/** Kích thước cả bản đồ (pixel gốc) */
export const MAP_W = MAP_COLS * TILE
export const MAP_H = MAP_ROWS * TILE

export const px = (x: number) => (x - OFFICE.minX) * PPM + MX
export const py = (z: number) => (z - OFFICE.minZ) * PPM + MY
/** Ngược lại: pixel → mét */
export const wx = (sx: number) => (sx - MX) / PPM + OFFICE.minX
export const wz = (sy: number) => (sy - MY) / PPM + OFFICE.minZ

/** Hướng 4 phía của sprite nhân vật, theo yaw của thế giới (forward = (sin yaw, cos yaw)) */
export type Dir = 'right' | 'up' | 'left' | 'down'
export function dirOf(yaw: number): Dir {
  const sx = Math.sin(yaw), sz = Math.cos(yaw)
  if (Math.abs(sx) > Math.abs(sz) * 1.05) return sx > 0 ? 'right' : 'left'
  return sz > 0 ? 'down' : 'up'
}
