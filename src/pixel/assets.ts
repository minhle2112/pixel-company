import { Assets, Rectangle, Texture, TextureSource } from 'pixi.js'
import atlas from './atlas.json'
import { DESK_ART, ITEMS, type Src, type View } from '../data/catalog'
import { MAP_SHEETS } from './tilemap'

/**
 * Nạp hình LimeZu (phục vụ ở /limezu/... bởi server/limezu.ts, không nằm trong repo).
 * Mọi hình vẽ kiểu pixel: không làm mịn khi phóng to.
 */
TextureSource.defaultOptions.scaleMode = 'nearest'

export type SheetKey = keyof typeof atlas.sheets
export type SpriteName = keyof typeof atlas.sprites

export const assetUrl = (rel: string) => `/limezu/${rel.split('/').map(encodeURIComponent).join('/')}`

const sheets = new Map<string, Texture>()
const sprites = new Map<string, Texture>()

/** Đã có gói hình trên máy này chưa (thư mục COOPVERSE_ASSETS) */
export async function assetsReady(): Promise<boolean> {
  try {
    const r = await fetch('/limezu/__status', { cache: 'no-store' })
    return r.ok && ((await r.json()) as { ok?: boolean }).ok === true
  } catch {
    return false
  }
}

/** Ảnh mà đồ trang trí, bàn ghế làm việc (items.json) dùng: khoá = đường dẫn trong gói hình */
function itemSheets(): [string, string][] {
  const s = new Set<string>()
  const add = (v?: View | null) => v?.parts.forEach((p) => p.src && s.add(p.src[0]))
  for (const i of ITEMS) i.art.views?.forEach(add)
  s.add(DESK_ART.top.src[0])
  if (DESK_ART.side) s.add(DESK_ART.side.src[0])
  Object.values(DESK_ART.chair).forEach(add)
  for (const t of DESK_ART.things) Object.values(t.views).forEach(add)
  return [...s].map((rel) => [rel, rel])
}

export async function loadSheets() {
  await Promise.all(
    [...Object.entries(atlas.sheets), ...Object.entries(MAP_SHEETS), ...itemSheets()].map(async ([k, rel]) => {
      if (!sheets.has(k)) sheets.set(k, await Assets.load<Texture>(assetUrl(rel)))
    }),
  )
}

export function sheet(k: SheetKey | string): Texture {
  const t = sheets.get(k)
  if (!t) throw new Error(`Chưa nạp sheet ${k}`)
  return t
}

/** Một vùng của sheet thành texture riêng (dùng chung nguồn ảnh, không tốn bộ nhớ) */
export function region(k: SheetKey | string, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: sheet(k).source, frame: new Rectangle(x, y, w, h) })
}

/** Hình đồ đạc theo tên trong atlas.json */
export function sprite(name: SpriteName): Texture {
  let t = sprites.get(name)
  if (!t) {
    const [k, x, y, w, h] = atlas.sprites[name] as [string, number, number, number, number]
    t = region(k, x, y, w, h)
    sprites.set(name, t)
  }
  return t
}

/** Texture của một vùng cắt trong items.json (dùng chung, không tạo lại) */
const srcs = new Map<string, Texture>()
export function srcTex(src: Src): Texture {
  const key = src.join('|')
  let t = srcs.get(key)
  if (!t) srcs.set(key, (t = region(...src)))
  return t
}

/**
 * Cắt một vùng ra canvas riêng: TilingSprite (sàn, tường lặp lại) cần texture đứng một mình,
 * không phải một khung trong sheet lớn.
 */
export function cut(k: SheetKey | string, x: number, y: number, w: number, h: number): Texture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.drawImage(sheet(k).source.resource as CanvasImageSource, x, y, w, h, 0, 0, w, h)
  return Texture.from(c)
}

/**
 * Kéo một món đồ LimeZu ra kích thước mới mà không làm méo nét vẽ: giữ nguyên 4 mép
 * (l, r, t, b pixel) và lặp lại phần giữa (khác NineSliceSprite, vốn kéo giãn phần giữa).
 */
const stitched = new Map<string, Texture>()
export function stitch(name: SpriteName, w: number, h: number, l: number, r: number, t: number, b: number): Texture {
  return stitchSrc(atlas.sprites[name] as Src, w, h, l, r, t, b)
}

/** Như stitch, với vùng cắt [ảnh, x, y, rộng, cao] */
export function stitchSrc(src: Src, w: number, h: number, l: number, r: number, t: number, b: number): Texture {
  const [k, sx, sy, sw, sh] = src
  const W = Math.round(w), H = Math.round(h)
  const key = `${src.join('|')}:${W}x${H}:${l},${r},${t},${b}`
  const hit = stitched.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  const img = sheet(k).source.resource as CanvasImageSource
  const mw = sw - l - r, mh = sh - t - b
  // Cột nguồn [x, rộng] và đích; phần giữa lặp lại cho đủ
  const spans = (n: number, a: number, m: number, z: number, total: number) => {
    const out: [number, number, number][] = [[0, 0, a]]
    for (let d = a; d < total - z; d += m) out.push([a, d, Math.min(m, total - z - d)])
    out.push([n - z, total - z, z])
    return out
  }
  for (const [ox, dx, cw] of spans(sw, l, mw, r, W))
    for (const [oy, dy, ch] of spans(sh, t, mh, b, H))
      if (cw > 0 && ch > 0) g.drawImage(img, sx + ox, sy + oy, cw, ch, dx, dy, cw, ch)
  const tex = Texture.from(c)
  stitched.set(key, tex)
  return tex
}

/** Các khung của một sprite động xếp ngang (w × h mỗi khung) */
export function frames(k: SheetKey | string, w: number, h: number, count?: number, y = 0): Texture[] {
  const src = sheet(k)
  const n = count ?? Math.floor(src.width / w)
  return Array.from({ length: n }, (_, i) => region(k, i * w, y, w, h))
}

/** Ảnh gốc (để ghép nhân vật) */
export async function loadImage(rel: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = assetUrl(rel)
  await img.decode()
  return img
}
