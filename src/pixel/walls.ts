import { AnimatedSprite, Container, Graphics } from 'pixi.js'
import type { WallKind } from '../data/catalog'
import { CELL, cellKey, cellX, cellZ } from '../data/officeState'
import type { Building } from '../world/rooms'
import { cut, frames } from './assets'
import { PPM, WALL_FACE, px, py } from './geom'
import { CAP_FILL, CAP_SHADE, LOW_WALL, OUTLINE, WALL, tiled } from './office'

/**
 * Tường giữa các phòng và vách trong phòng (mỗi ô 0,5 m một khối, vẽ ở trang thiết kế nhà), cửa kính LimeZu trên tường / vách cao.
 * Nhìn từ trên nghiêng về bắc: thấy nắp vách, và mặt phía nam ở ô cuối của mỗi đoạn. Mặt vách lấy hình LimeZu (house.json walls):
 * - Vách thấp: ngang hông, mặt là dải dưới viên tường `walls.low`
 * - Tường cao: viên tường `walls.tall` như tường bắc (cao 2 ô), tự mờ đi khi có người đứng phía sau
 */

const T = CELL * PPM
/** Mặt vách cao bao nhiêu pixel */
const FACE: Record<WallKind, number> = { low: 14, tall: WALL_FACE }
/** Nắp vách thấp tối hơn tường cao một chút, để phân biệt khi nhìn từ trên */
const LOW_CAP = 0xddd6c8
const LOW_EDGE = 0xbfb4a0

export interface WallView {
  /** Các khối vách và cửa, xếp lớp cùng người */
  sorted: Container[]
  /** Mặt tường cao (chỉ mặt, nắp giữ nguyên): làm mờ khi có người đứng phía sau */
  tall: { node: Container; x0: number; x1: number; bottom: number; face: number; a: number }[]
  doors: { anim: AnimatedSprite; x: number; y: number; open: number }[]
}

/** Chân tường LimeZu (dải dưới của viên tường vách thấp) cao h pixel */
const faceTex = (() => {
  const cache = new Map<number, ReturnType<typeof cut>>()
  return (h: number) => {
    let t = cache.get(h)
    if (!t) {
      const [x, y, w, wh] = LOW_WALL
      t = cut('walls', x, y + wh - Math.min(h, wh), w, Math.min(h, wh))
      cache.set(h, t)
    }
    return t
  }
})()

export function buildWalls(b: Building): WallView {
  const out: WallView = { sorted: [], tall: [], doors: [] }
  const kindAt = (c: number, r: number) => b.walls.get(cellKey(c, r))
  // Cửa kính (2 ô trên tường / vách cao chạy ngang): cửa LimeZu động; cửa khác là lối đi trống, không vẽ gì
  for (const d of b.doors) {
    if (!d.glass) continue
    const [c, r] = d.cells[0]
    const x0 = Math.round(px(cellX(c))), bottom = Math.round(py(cellZ(r))) + T
    const node = new Container()
    const g = new Graphics()
    capCell(g, x0, bottom - FACE.tall - T, T * 2, 'tall', true, true, false, false)
    node.addChild(g)
    const a = new AnimatedSprite(frames('door', 32, 48))
    a.position.set(x0, bottom - 48)
    a.gotoAndStop(0)
    node.addChild(a)
    node.zIndex = bottom
    out.sorted.push(node)
    out.doors.push({ anim: a, x: x0 + T, y: bottom, open: 0 })
  }

  for (const [key, kind] of b.walls) {
    const [c, r] = key.split(',').map(Number)
    const x0 = Math.round(px(cellX(c))), y0 = Math.round(py(cellZ(r)))
    const bottom = y0 + T
    const F = FACE[kind]
    const same = (dc: number, dr: number) => kindAt(c + dc, r + dr) === kind

    const node = new Container()
    const g = new Graphics()
    const showFace = !same(0, 1)
    // Nắp (mặt trên của khối) nằm phía trên chỗ đứng một khoảng bằng chiều cao mặt vách
    capCell(g, x0, y0 - F, T, kind, !same(0, -1), !same(0, 1), !same(-1, 0), !same(1, 0))
    // Bóng đổ nhạt trên sàn phía đông vách thấp (cho có khối)
    if (kind === 'low' && !same(1, 0)) g.rect(x0 + T, y0 - F + 4, 2, F + T - 4).fill({ color: 0x000000, alpha: 0.18 })
    node.addChild(g)
    const face = new Container()
    node.addChild(face)
    if (showFace) {
      if (kind === 'tall') {
        // Như tường bắc: viên tường nguyên (có chân tường); mặt cao hơn viên tường thì lặp phần giữa ở dải trên
        const [wx, wy, ww, wh] = WALL
        if (F > wh) face.addChild(tiled(cut('walls', wx, wy + 8, ww, F - wh), x0, bottom - F, T, F - wh))
        face.addChild(tiled(cut('walls', wx, wy, ww, wh), x0, bottom - wh, T, wh))
      } else if (kind === 'low') {
        face.addChild(tiled(faceTex(F), x0, bottom - F, T, F))
      }
      // Viền hai bên mặt vách ở đầu đoạn
      const eg = new Graphics()
      if (!same(-1, 0)) eg.rect(x0, bottom - F, 1, F).fill(OUTLINE)
      if (!same(1, 0)) eg.rect(x0 + T - 1, bottom - F, 1, F).fill(OUTLINE)
      eg.rect(x0, bottom, T, 2).fill({ color: 0x000000, alpha: 0.14 })
      face.addChild(eg)
    }
    node.zIndex = bottom
    out.sorted.push(node)
    if (kind === 'tall' && showFace) out.tall.push({ node: face, x0, x1: x0 + T, bottom, face: F, a: 1 })
  }
  return out
}

/** Nắp một khối vách: viền tối ở cạnh không nối với khối cùng loại */
function capCell(g: Graphics, x: number, y: number, w: number, kind: WallKind, n: boolean, s: boolean, wEdge: boolean, e: boolean) {
  g.rect(x, y, w, T).fill(kind === 'low' ? LOW_CAP : CAP_FILL)
  if (kind === 'low') {
    // Mép nắp vách thấp phía đông / nam sẫm hơn cho ra khối
    if (e) g.rect(x + w - 3, y, 2, T).fill(LOW_EDGE)
    if (s) g.rect(x, y + T - 3, w, 2).fill(LOW_EDGE)
  } else if (s) g.rect(x, y + T - 3, w, 2).fill(CAP_SHADE)
  if (n) g.rect(x, y, w, 1).fill(OUTLINE)
  if (s) g.rect(x, y + T - 1, w, 1).fill(OUTLINE)
  if (wEdge) g.rect(x, y, 1, T).fill(OUTLINE)
  if (e) g.rect(x + w - 1, y, 1, T).fill(OUTLINE)
}

/**
 * Mỗi khung hình: tường cao mờ đi khi có người đứng phía sau (để vẫn thấy agent), cửa tự mở khi có người tới gần.
 * `people`: chân người (pixel gốc).
 */
export function updateWalls(v: WallView, people: { x: number; y: number }[], dt: number) {
  for (const w of v.tall) {
    // Người đứng ngay trong hàng vách (ở khung cửa) không tính là phía sau: khỏi mờ thành lỗ thủng cạnh cửa
    const behind = people.some((p) => p.y < w.bottom - T + 2 && p.y > w.bottom - w.face - T - 8 && p.x > w.x0 - 7 && p.x < w.x1 + 7)
    const target = behind ? 0.35 : 1
    w.a += (target - w.a) * Math.min(1, dt * 10)
    w.node.alpha = w.a
  }
  for (const d of v.doors) {
    const near = people.some((p) => Math.abs(p.x - d.x) < 26 && Math.abs(p.y - d.y) < 30)
    d.open = Math.max(0, Math.min(4, d.open + (near ? dt : -dt) * 14))
    d.anim.gotoAndStop(Math.round(d.open))
  }
}
