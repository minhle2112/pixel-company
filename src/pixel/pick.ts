import { Container, Sprite, Texture } from 'pixi.js'

/**
 * Bấm chuột trên bản đồ: mỗi thứ bấm được (người, ứng viên, chính bạn, bảng treo tường) khai báo vùng của mình
 * theo pixel gốc mỗi khung hình. `z` lớn hơn = nằm trước (gần camera), được chọn khi chồng nhau.
 */
export interface Hit { x0: number; y0: number; x1: number; y1: number; z: number }

export const hits = new Map<string, Hit>()

/** Vùng bấm của một người: cả hình (rộng 16, từ đỉnh đầu tới chân), nới thêm vài pixel cho dễ trúng */
export function personHit(id: string, x: number, foot: number, head: number, z: number) {
  const h = hits.get(id)
  const x0 = x - 8, x1 = x + 8, y0 = foot - head - 3, y1 = foot + 2
  if (h) Object.assign(h, { x0, y0, x1, y1, z })
  else hits.set(id, { x0, y0, x1, y1, z })
}

/** Thứ nằm trước nhất dưới điểm (x, y) pixel gốc */
export function pickAt(x: number, y: number): string | null {
  let best: string | null = null
  let bz = -Infinity
  for (const [id, h] of hits) {
    if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && h.z > bz) { bz = h.z; best = id }
  }
  return best
}

const HL_TINT = 0xffe27a

/** Viền sáng 1 pixel quanh người khi rê chuột lên (bốn bản bóng trắng lệch 1 px, nhuộm vàng nhạt, nằm sau người) */
export function makeOutline() {
  const o = new Container()
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const s = new Sprite(Texture.EMPTY)
    s.anchor.set(0.5, 1)
    s.position.set(ox, oy)
    s.tint = HL_TINT
    o.addChild(s)
  }
  o.visible = false
  return o
}

export function setOutline(o: Container, tex: Texture | null) {
  o.visible = !!tex
  if (tex) for (const s of o.children as Sprite[]) s.texture = tex
}
