import { AnimatedSprite, Container, Graphics, NineSliceSprite, Sprite } from 'pixi.js'
import { DESK_ART, footprint, partWH, type Item, type Part, type Src, type View } from '../data/catalog'
import { CELL, cellX, cellZ } from '../data/officeState'
import atlas from './atlas.json'
import { region, sheet, srcTex, stitch, stitchSrc } from './assets'
import { PPM, px, py } from './geom'
import { sortAt, wallTop, type Light, type Rect } from './office'

/**
 * Hình của từng món trong cửa hàng, toàn bộ là hình LimeZu: các mảnh cắt ghi trong src/data/items.json
 * (trang cắt hình cutter.html). Món 4 hướng có hình từng hướng (ghế bành, sofa), món lật thì lật gương.
 */

/** Món chưa có hình: hộp giấy */
const BOX: View = { parts: [{ src: atlas.sprites.boxSmall as Src, x: -6, y: -12 }] }

/** Hình hướng rot của món (hướng thiếu dùng hình hướng 0; món lật thì hướng 1 lật gương hình hướng 0) */
export function viewOf(i: Item, rot: number): { view: View; flip: boolean } {
  const vs = i.art.views
  const own = vs?.[rot]
  if (own) return { view: own, flip: !!own.flip }
  const v = vs?.[0] ?? BOX
  return { view: v, flip: !!v.flip !== (i.turn === 'flip' && rot === 1) }
}

/** Một mảnh: hình tĩnh, hình động (các khung xếp ngang trong ảnh), hoặc khối màu */
function partNode(p: Part): Container {
  let s: Container
  if (!p.src) {
    const [w, h, col] = p.box ?? [0, 0, '#000000']
    s = new Graphics().rect(0, 0, w, h).fill(col)
  } else if (p.frames && p.frames > 1) {
    const [k, sx, sy, w, h] = p.src
    const a = new AnimatedSprite(Array.from({ length: p.frames }, (_, f) => region(k, sx + f * w, sy, w, h)))
    a.animationSpeed = p.speed ?? 0.08
    a.play()
    s = a
  } else s = new Sprite(srcTex(p.src))
  s.position.set(p.x, p.y)
  return s
}

/**
 * Dựng hình một hướng, gốc toạ độ = điểm neo (giữa mép dưới khung chân). `fw`, `fh`: cỡ khung chân (pixel),
 * để kéo mảnh `fit` cho vừa. Dùng chung cho đồ trang trí và ghế làm việc (office.ts).
 */
export function viewNode(v: View, flip: boolean, fw = 0, fh = 0): Container {
  const c = new Container()
  v.parts.forEach((p, k) => {
    if (k > 0 || !v.fit || !p.src) return void c.addChild(partNode(p))
    const f = v.fit
    const W = fw + (f.dw ?? 0), H = fh + (f.dh ?? 0)
    let s: Container
    if (f.mode === 'stretch') {
      const n = new NineSliceSprite({ texture: srcTex(p.src), leftWidth: f.l, rightWidth: f.r, topHeight: f.t, bottomHeight: f.b })
      n.width = W
      n.height = H
      s = n
    } else s = new Sprite(stitchSrc(p.src, W, H, f.l, f.r, f.t, f.b))
    s.position.set(-W / 2 + p.x, -H + p.y)
    c.addChild(s)
  })
  if (flip) c.scale.x = -1
  return c
}

/** Phần trước của ghế (`front` hàng pixel dưới cùng, vd tay ghế phía camera): vẽ đè lên người đang ngồi */
function frontNode(v: View, flip: boolean, cx: number, bottom: number): Container {
  const H = v.front ?? 0
  const c = new Container()
  for (const p of v.parts) {
    if (!p.src) continue
    const [k, sx, sy, w, h] = p.src
    const top = Math.max(p.y, -H), bot = Math.min(p.y + h, 0)
    if (bot <= top) continue
    const s = new Sprite(region(k, sx, sy + top - p.y, w, bot - top))
    s.position.set(p.x, top)
    c.addChild(s)
  }
  if (flip) c.scale.x = -1
  c.position.set(Math.round(cx), Math.round(bottom))
  // Người ngồi ghế xếp lớp ở chân + 10 (Agents.tsx), mép ghế nằm ngay trên
  c.zIndex = Math.round(bottom) + 3
  return c
}

export interface ItemView {
  node: Container
  /** sorted: xếp lớp cùng người · floor: nằm dưới mọi thứ (thảm, đồ treo tường) */
  layer: 'sorted' | 'floor'
  /** Khung bấm chuột (pixel gốc) */
  hit: Rect
  light?: Light
  /** Phần trước của ghế (tay ghế phía camera): vẽ đè lên người đang ngồi, xếp lớp riêng */
  front?: Container
}

/** Khung pixel của các ô một món chiếm trên sàn */
export function footRect(i: Item, c: number, r: number, rot: number): Rect {
  const { w, d } = footprint(i, rot)
  return { x: Math.round(px(cellX(c))), y: Math.round(py(cellZ(r))), w: w * CELL * PPM, h: d * CELL * PPM }
}

/** Khung pixel của đồ treo tường ở cột c */
export function wallRect(i: Item, c: number): Rect {
  const x = Math.round(px(cellX(c)))
  return { x, y: wallTop(), w: i.w * CELL * PPM, h: 30 }
}

/** Khung của hình (toạ độ bản đồ: node nằm ở gốc, chưa gắn vào sân khấu) */
const bounds = (o: Container): Rect => {
  const b = o.getLocalBounds()
  return { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.width), h: Math.ceil(b.height) }
}

/** Dựng hình một món đặt ở ô (c, r) hướng rot. `fame`: vẽ nội dung bảng vinh danh (Scene vẽ lại khi EXP đổi) */
export function itemView(i: Item, c: number, r: number, rot: number, fame?: Graphics): ItemView {
  if (i.mount === 'wall') return wallItem(i, c, fame)
  const f = footRect(i, c, r, rot)
  const cx = f.x + f.w / 2, bottom = f.y + f.h
  const { view, flip } = viewOf(i, rot)
  const node = viewNode(view, flip, f.w, f.h)
  node.position.set(Math.round(cx), Math.round(bottom))
  if (i.mount === 'rug') return { node, layer: 'floor', hit: f }
  let light: Light | undefined
  if (i.light === 'lamp') light = { x: Math.round(cx), y: bottom - 26, r: 40, kind: 'lamp' }
  else if (i.light === 'screen') light = { x: Math.round(cx), y: bottom - 18, r: 18, kind: 'screen' }
  sortAt(node, bottom)
  // Bóng đổ nhạt sát chân (hình LimeZu không kèm bóng); mặc định chỉ món cao từ 0,5 m (thảm, ghế đẩu, ghế họp thì thôi)
  const wrap = new Container()
  if (i.art.shadow ?? i.h >= 0.5) {
    const g = new Graphics()
    g.ellipse(Math.round(cx), bottom - 1, Math.max(4, Math.round(f.w * 0.46)), 3).fill({ color: 0x000000, alpha: 0.2 })
    wrap.addChild(g)
  }
  wrap.addChild(node)
  wrap.zIndex = node.zIndex
  return { node: wrap, layer: 'sorted', hit: bounds(wrap), light, front: view.front ? frontNode(view, flip, cx, bottom) : undefined }
}

function wallItem(i: Item, c: number, fame?: Graphics): ItemView {
  const R = wallRect(i, c)
  const cx = R.x + R.w / 2
  const node = new Container()
  let light: Light | undefined
  if (i.art.code === 'fame') {
    // Bảng vinh danh: khung bảng phấn LimeZu, nội dung (3 agent nhiều EXP nhất) vẽ ở Scene
    const top = R.y + 3
    const w = R.w, h = 26
    const shadow = new Graphics().rect(R.x + 1, top + h, w - 2, 2).fill({ color: 0x000000, alpha: 0.22 })
    const bd = new Sprite(stitch('chalkWall', w, h, 4, 4, 4, 5))
    bd.position.set(R.x, top)
    node.addChild(shadow, bd)
    if (fame) {
      fame.position.set(R.x + 5, top + 5)
      node.addChild(fame)
    }
  } else {
    // Điểm neo: giữa mép trên mặt tường; bóng một vạch mảnh dưới mảnh đầu
    const { view, flip } = viewOf(i, 0)
    const [w, h] = partWH(view.parts[0])
    const p0 = view.parts[0], x = Math.round(cx)
    if (i.art.shadow ?? true) node.addChild(new Graphics().rect(x + p0.x + 1, R.y + p0.y + h, w - 2, 1).fill({ color: 0x000000, alpha: 0.18 }))
    const v = viewNode(view, flip, R.w, 0)
    v.position.set(x, R.y)
    node.addChild(v)
    if (i.light === 'screen') light = { x, y: R.y + p0.y + h / 2, r: 18, kind: 'screen' }
  }
  return { node, layer: 'floor', hit: bounds(node), light }
}

/** Cỡ khung nội dung bảng vinh danh (pixel gốc) */
export const FAME_INNER = { w: 6 * CELL * PPM - 10, h: 16 }

// ───────────────────────── Ảnh nhỏ cho cửa hàng ─────────────────────────

type Frame = [string, number, number, number, number]
const thumbs = new Map<string, string>()

/**
 * Ảnh nhỏ (data URL) của một đồ để bàn (desk.things trong items.json, hình bàn agent quay lưng: thấy mặt trước món),
 * kèm cỡ gốc (pixel) để phóng đúng bội số nguyên; ghế da lấy theo hình ghế làm việc
 */
export function deskThumb(id: string): { url: string; w: number; h: number } | null {
  const t = DESK_ART.things.find((x) => x.id === id)
  const parts = id === 'chair' ? (DESK_ART.chair.frontLeather ?? DESK_ART.chair.front).parts
    : (t?.views.back ?? t?.views.front ?? t?.views.side)?.parts
  if (!parts?.length) return null
  const key = `desk:${id}`
  const hit = thumbs.get(key)
  const url = hit ?? composite(parts)
  if (!hit) thumbs.set(key, url)
  const [, , w, h] = bbox(parts)
  return { url, w, h }
}

/** Khung bao các mảnh (khung đầu của hình động): [x, y, rộng, cao] */
function bbox(parts: Part[]): [number, number, number, number] {
  const x0 = Math.min(...parts.map((p) => p.x)), y0 = Math.min(...parts.map((p) => p.y))
  const x1 = Math.max(...parts.map((p) => p.x + partWH(p)[0])), y1 = Math.max(...parts.map((p) => p.y + partWH(p)[1]))
  return [x0, y0, x1 - x0, y1 - y0]
}

/** Ghép các mảnh thành một ảnh (data URL) */
function composite(parts: Part[]): string {
  const [x0, y0, W, H] = bbox(parts)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  g.imageSmoothingEnabled = false
  for (const { src, box, x, y } of parts) {
    if (src) {
      const [k, sx, sy, w, h] = src
      g.drawImage(sheet(k).source.resource as CanvasImageSource, sx, sy, w, h, x - x0, y - y0, w, h)
    } else if (box) {
      g.fillStyle = box[2]
      g.fillRect(x - x0, y - y0, box[0], box[1])
    }
  }
  return cv.toDataURL()
}

/** Ảnh nhỏ (data URL) của một món ở hướng mặc định, vẽ thẳng từ ảnh LimeZu (thảm, bàn họp: hình gốc chưa kéo dãn) */
export function itemThumb(i: Item): string {
  const hit = thumbs.get(i.id)
  if (hit) return hit
  let parts: Part[]
  if (i.art.code === 'fame') parts = [{ src: atlas.sprites.chalkWall as Frame, x: 0, y: 0 }]
  else {
    const { view } = viewOf(i, 0)
    parts = view.fit ? [{ ...view.parts[0], x: 0, y: 0 }] : view.parts
  }
  const url = composite(parts)
  thumbs.set(i.id, url)
  return url
}
