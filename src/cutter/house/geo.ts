import { footprint, itemById, type Item, type View } from '../../data/catalog'
import { roomBounds, type CellRect, type HouseFile, type HouseKit, type HouseRoom } from '../../world/house'
import { gridAt, houseGrid, housePartitions, type PartKind, type Partition } from '../../world/houseMap.mjs'

/** Các phần của R còn lại sau khi khoét S (tối đa 4 khúc) */
export function subtract(R: CellRect, S: CellRect): CellRect[] {
  const [a0, b0, a1, b1] = R, [s0, t0, s1, t1] = S
  if (s0 > a1 || s1 < a0 || t0 > b1 || t1 < b0) return [R]
  const out: CellRect[] = []
  if (t0 > b0) out.push([a0, b0, a1, t0 - 1])
  if (t1 < b1) out.push([a0, t1 + 1, a1, b1])
  const m0 = Math.max(b0, t0), m1 = Math.min(b1, t1)
  if (s0 > a0) out.push([a0, m0, s0 - 1, m1])
  if (s1 < a1) out.push([s1 + 1, m0, a1, m1])
  return out
}

/** Hình chữ nhật từ hai ô góc bất kỳ */
export const norm = (c0: number, r0: number, c1: number, r1: number): CellRect => [Math.min(c0, c1), Math.min(r0, r1), Math.max(c0, c1), Math.max(r0, r1)]

/**
 * Đổi các khúc của phòng mà đồ có sẵn vẫn đứng yên (ô của đồ tính từ góc khung bao phòng, khung bao đổi thì bù lại)
 */
export function setRects(rm: HouseRoom, rects: CellRect[]) {
  if (!rects.length) return
  const a = roomBounds(rm.rects), b = roomBounds(rects)
  rm.rects = rects
  for (const k of rm.kit ?? []) {
    k.c += a.c0 - b.c0
    k.r += a.r0 - b.r0
  }
}

/** Ô (số nguyên) một món có sẵn chiếm: góc trên trái + cỡ; đồ treo tường: hàng -2 (trên tường bắc), cao 2 */
export function kitBox(i: Item, rm: HouseRoom, k: HouseKit): { c: number; r: number; w: number; d: number; wall: boolean } {
  const { c0, r0 } = roomBounds(rm.rects)
  if (i.mount === 'wall') return { c: c0 + k.c, r: -2, w: i.w, d: 2, wall: true }
  const { w, d } = footprint(i, k.rot ?? 0)
  return { c: c0 + k.c, r: r0 + k.r, w, d, wall: false }
}

/** Món có sẵn dưới điểm (ô, số thực): [phòng, chỉ số], phòng `first` được ưu tiên */
export function kitAt(h: HouseFile, fx: number, fy: number, first?: string): [string, number] | null {
  const rooms = [...h.rooms].sort((a, b) => Number(b.id === first) - Number(a.id === first))
  for (const rm of rooms) {
    const kit = rm.kit ?? []
    // Đồ đứng (không phải thảm) nằm trên thảm: xét trước
    const order = kit.map((_, i) => i).sort((a, b) => Number(itemById.get(kit[a].item)?.mount === 'rug') - Number(itemById.get(kit[b].item)?.mount === 'rug'))
    for (const i of order) {
      const it = itemById.get(kit[i].item)
      if (!it) continue
      const b = kitBox(it, rm, kit[i])
      if (fx >= b.c && fx < b.c + b.w && fy >= b.r && fy < b.r + b.d) return [rm.id, i]
    }
  }
  return null
}

/** Cửa đang có ở ô (c, r) */
export const doorAt = (h: HouseFile, c: number, r: number) => h.doors.findIndex(([c0, r0, c1, r1]) => c >= c0 && c <= c1 && r >= r0 && r <= r1)

/**
 * Cửa mới ở ô tường (c, r): nằm giữa hai phòng khác nhau (trái / phải hoặc trên / dưới), rộng 2 ô nếu được.
 * null = ô này không đặt cửa được.
 */
export function newDoor(h: HouseFile, c: number, r: number): CellRect | null {
  const g = houseGrid(h)
  const at = (cc: number, rr: number) => gridAt(h, g, cc, rr)
  if (at(c, r) !== -1) return null
  const between = (cc: number, rr: number, vertical: boolean) => {
    if (at(cc, rr) !== -1 || doorAt(h, cc, rr) >= 0) return null
    const a = vertical ? at(cc - 1, rr) : at(cc, rr - 1)
    const b = vertical ? at(cc + 1, rr) : at(cc, rr + 1)
    return a >= 0 && b >= 0 && a !== b ? `${a}-${b}` : null
  }
  for (const vertical of [true, false]) {
    const pair = between(c, r, vertical)
    if (!pair) continue
    const [dc, dr] = vertical ? [0, 1] : [1, 0]
    if (between(c + dc, r + dr, vertical) === pair) return norm(c, r, c + dc, r + dr)
    if (between(c - dc, r - dr, vertical) === pair) return norm(c - dc, r - dr, c, r)
    return [c, r, c, r]
  }
  return null
}

/** Hình của món ở hướng `rot` (như src/pixel/catalogArt.ts viewOf); món vẽ bằng code thì null */
export function viewOf(i: Item, rot: number): { view: View; flip: boolean } | null {
  const vs = i.art.views
  const own = vs?.[rot]
  if (own) return { view: own, flip: !!own.flip }
  const v = vs?.[0]
  if (!v) return null
  return { view: v, flip: !!v.flip !== (i.turn === 'flip' && rot === 1) }
}

/** Tâm 4 bàn và 4 ghế của cụm bàn quanh tâm (ô), như src/world/layout.ts: bàn 1,4 × 0,75 m */
export const POD_DESKS = [-1, 1].flatMap((sz) => [-1, 1].map((sx) => ({ x: sx * 1.4, z: sz * 0.74, seat: sz * 2.4 })))

// ───────────────────────── Vách trong phòng ─────────────────────────

/** Ô thẳng hàng từ (c0, r0) tới (c1, r1), theo chiều dài hơn: khung một hàng / một cột */
export function lineRect(c0: number, r0: number, c1: number, r1: number): CellRect {
  return Math.abs(c1 - c0) >= Math.abs(r1 - r0) ? norm(c0, r0, c1, r0) : norm(c0, r0, c0, r1)
}

/** Vẽ loại `kind` lên các ô của khung `S` (đè vách cũ); null = dỡ vách ở đó */
export function paintParts(h: HouseFile, S: CellRect, kind: PartKind | null) {
  const parts: Partition[] = (h.partitions ?? []).flatMap((p) => subtract([p[0], p[1], p[2], p[3]], S).map((r): Partition => [...r, p[4]]))
  if (kind) parts.push([...S, kind])
  h.partitions = parts
}

/** Đoạn vách (chỉ số) có ô (c, r); đoạn sau đè đoạn trước nên xét từ cuối */
export function partIndexAt(h: HouseFile, c: number, r: number): number {
  const ps = h.partitions ?? []
  for (let i = ps.length - 1; i >= 0; i--) {
    const [c0, r0, c1, r1] = ps[i]
    if (c >= c0 && c <= c1 && r >= r0 && r <= r1) return i
  }
  return -1
}

/**
 * Bấm công cụ Cửa lên vách: ô cửa trên vách thì bỏ cửa (thành vách như hai bên); ô vách thì mở cửa 2 ô theo chiều vách
 * (1 ô nếu vách chỉ còn 1 ô). Trả về false nếu ô không có vách.
 */
export function togglePartDoor(h: HouseFile, c: number, r: number): boolean {
  const parts = housePartitions(h)
  const at = (cc: number, rr: number) => parts.get(`${cc},${rr}`)
  const k = at(c, r)
  if (!k) return false
  const wall = (cc: number, rr: number) => { const x = at(cc, rr); return x && x !== 'door' ? x : undefined }
  if (k === 'door') {
    const i = partIndexAt(h, c, r)
    const [c0, r0, c1, r1] = (h.partitions ?? [])[i]
    const side = wall(c0 - 1, r0) ?? wall(c1 + 1, r1) ?? wall(c0, r0 - 1) ?? wall(c1, r1 + 1) ?? 'tall'
    paintParts(h, [c0, r0, c1, r1], side)
    return true
  }
  const horiz = !!wall(c - 1, r) || !!wall(c + 1, r) || (!wall(c, r - 1) && !wall(c, r + 1))
  const rect: CellRect = horiz
    ? wall(c + 1, r) ? [c, r, c + 1, r] : wall(c - 1, r) ? [c - 1, r, c, r] : [c, r, c, r]
    : wall(c, r + 1) ? [c, r, c, r + 1] : wall(c, r - 1) ? [c, r - 1, c, r] : [c, r, c, r]
  paintParts(h, rect, 'door')
  return true
}

/** Các đoạn vách (chỉ số) nằm trọn trong phòng thứ k: dời phòng thì dời theo */
export function partsInRoom(h: HouseFile, k: number): number[] {
  const g = houseGrid(h)
  return (h.partitions ?? []).flatMap(([c0, r0, c1, r1], i) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (gridAt(h, g, c, r) !== k) return []
    return [i]
  })
}

/** Dời các đoạn vách `idx` đi (dc, dr) */
export function shiftParts(h: HouseFile, idx: number[], dc: number, dr: number) {
  for (const i of idx) {
    const p = h.partitions?.[i]
    if (p) h.partitions![i] = [p[0] + dc, p[1] + dr, p[2] + dc, p[3] + dr, p[4]]
  }
}
