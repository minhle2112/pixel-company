// FILE SINH TỰ ĐỘNG từ layer "Markers" và "Collision" của maps/office.tmj (scripts/map-markers.mjs). Đừng sửa tay.
// Đơn vị: pixel của map, gốc ở góc tây bắc map.

export interface MapRect { x: number; y: number; w: number; h: number }
export interface MapPoint { x: number; y: number }
/** Vùng chặn (layer Collision): height = cao bao nhiêu mét, không ghi = cao như tường */
export interface MapBlock extends MapRect { height?: number }

export const MAP_MARKERS: {
  tile: number; room: MapRect; windows: MapRect[]; kanban: MapRect; door: MapRect; spawn: MapPoint; lobby: MapPoint[]; pods: MapPoint[]
  leads: (MapPoint & { face: 'n' | 's' | 'e' | 'w' })[]
  blocks: MapBlock[]
} = {
  tile: 16,
  room: { x: 16, y: 48, w: 1024, h: 320 },
  windows: [{ x: 88, y: 16, w: 48, h: 32 }, { x: 440, y: 16, w: 48, h: 32 }, { x: 664, y: 16, w: 48, h: 32 }, { x: 904, y: 16, w: 48, h: 32 }],
  kanban: { x: 496, y: 16, w: 96, h: 32 },
  door: { x: 528, y: 368, w: 32, h: 16 },
  spawn: { x: 544, y: 310.4 },
  lobby: [{ x: 598.4, y: 356.8 }],
  pods: [{ x: 600, y: 136 }, { x: 488, y: 136 }, { x: 488, y: 248 }, { x: 600, y: 248 }],
  leads: [{ x: 184, y: 72, face: "s" }],
  blocks: [],
}
