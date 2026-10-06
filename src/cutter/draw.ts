import { partWH, type Part, type Src, type View } from '../data/catalog'

/*
 * Vẽ hình món đồ lên canvas 2D cho trang cắt hình: cùng cách đặt mảnh như game (src/pixel/catalogArt.ts viewNode),
 * nhưng không cần PixiJS.
 */

export const assetUrl = (rel: string) => `/limezu/${rel.split('/').map(encodeURIComponent).join('/')}`

const imgs = new Map<string, HTMLImageElement>()
const listeners = new Set<() => void>()
/** Gọi lại khi một ảnh nạp xong (để vẽ lại) */
export const onImage = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Ảnh trong gói hình; chưa nạp xong thì null (nạp xong sẽ báo onImage) */
export function img(rel: string): HTMLImageElement | null {
  let im = imgs.get(rel)
  if (!im) {
    im = new Image()
    im.onload = () => listeners.forEach((f) => f())
    im.src = assetUrl(rel)
    imgs.set(rel, im)
  }
  return im.complete && im.naturalWidth ? im : null
}

/** Như assets.ts: cột / hàng nguồn và đích khi giữ 2 mép, lặp phần giữa */
function spans(n: number, a: number, m: number, z: number, total: number) {
  const out: [number, number, number][] = [[0, 0, a]]
  for (let d = a; d < total - z; d += m) out.push([a, d, Math.min(m, total - z - d)])
  out.push([n - z, total - z, z])
  return out
}

/** Vẽ vùng cắt kéo ra cỡ W × H: giữ 4 mép, phần giữa lặp lại (repeat) hoặc giãn ra (stretch) */
export function drawFit(g: CanvasRenderingContext2D, src: Src, dx: number, dy: number, W: number, H: number, mode: 'repeat' | 'stretch', l: number, r: number, t: number, b: number) {
  const [k, sx, sy, sw, sh] = src
  const im = img(k)
  if (!im) return
  W = Math.round(W)
  H = Math.round(H)
  if (mode === 'repeat') {
    for (const [ox, x, cw] of spans(sw, l, sw - l - r, r, W))
      for (const [oy, y, ch] of spans(sh, t, sh - t - b, b, H))
        if (cw > 0 && ch > 0) g.drawImage(im, sx + ox, sy + oy, cw, ch, dx + x, dy + y, cw, ch)
    return
  }
  const cols: [number, number, number, number][] = [[0, l, 0, l], [l, sw - l - r, l, W - l - r], [sw - r, r, W - r, r]]
  const rows: [number, number, number, number][] = [[0, t, 0, t], [t, sh - t - b, t, H - t - b], [sh - b, b, H - b, b]]
  for (const [ox, ow, x, w] of cols)
    for (const [oy, oh, y, h] of rows)
      if (ow > 0 && oh > 0 && w > 0 && h > 0) g.drawImage(im, sx + ox, sy + oy, ow, oh, dx + x, dy + y, w, h)
}

/** Một mảnh: vùng ảnh (khung `frame` nếu là hình động) hoặc khối màu */
export function drawPart(g: CanvasRenderingContext2D, p: Part, frame = 0) {
  if (!p.src) {
    if (!p.box) return
    g.fillStyle = p.box[2]
    g.fillRect(p.x, p.y, p.box[0], p.box[1])
    return
  }
  const [k, sx, sy, w, h] = p.src
  const im = img(k)
  if (im) g.drawImage(im, sx + (frame % (p.frames || 1)) * w, sy, w, h, p.x, p.y, w, h)
}

/** Khung (so với điểm neo) của mảnh thứ k trong hình: mảnh kéo giãn thì theo cỡ khung chân */
export function partRect(v: View, k: number, fw: number, fh: number): [number, number, number, number] {
  const p = v.parts[k]
  if (k === 0 && v.fit && p.src) {
    const W = Math.round(fw + (v.fit.dw ?? 0)), H = Math.round(fh + (v.fit.dh ?? 0))
    return [-W / 2 + p.x, -H + p.y, W, H]
  }
  return [p.x, p.y, ...partWH(p)]
}

/**
 * Vẽ cả hình, gốc toạ độ đang ở điểm neo. `only`: chỉ vẽ các hàng y ∈ [only, 0) (phần đè lên người ngồi).
 * `tint`: nhuộm màu (ghế da khi chưa có hình da riêng).
 */
export function drawView(g: CanvasRenderingContext2D, v: View, flip: boolean, fw: number, fh: number, opts: { frame?: number; only?: number; tint?: string } = {}) {
  g.save()
  if (flip) g.scale(-1, 1)
  if (opts.only !== undefined) {
    g.beginPath()
    g.rect(-4096, opts.only, 8192, -opts.only)
    g.clip()
  }
  const paint = (c: CanvasRenderingContext2D) =>
    v.parts.forEach((p, k) => {
      if (k === 0 && v.fit && p.src) {
        const [x, y, W, H] = partRect(v, 0, fw, fh)
        drawFit(c, p.src, x, y, W, H, v.fit.mode, v.fit.l, v.fit.r, v.fit.t, v.fit.b)
      } else drawPart(c, p, opts.frame)
    })
  if (!opts.tint) paint(g)
  else {
    // Nhuộm như PixiJS (nhân màu), giữ nguyên chỗ trong suốt
    const [x0, y0, w, h] = viewBox(v, fw, fh)
    const c = document.createElement('canvas').getContext('2d')!
    c.canvas.width = w
    c.canvas.height = h
    c.imageSmoothingEnabled = false
    c.translate(-x0, -y0)
    paint(c)
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = opts.tint
    c.fillRect(0, 0, w, h)
    c.globalCompositeOperation = 'destination-in'
    c.translate(-x0, -y0)
    paint(c)
    g.drawImage(c.canvas, x0, y0)
  }
  g.restore()
}

/** Khung bao cả hình (so với điểm neo, chưa lật) */
export function viewBox(v: View, fw: number, fh: number): [number, number, number, number] {
  if (!v.parts.length) return [-8, -16, 16, 16]
  const rs = v.parts.map((_, k) => partRect(v, k, fw, fh))
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]))
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]))
  return [x0, y0, x1 - x0, y1 - y0]
}

/** Nền ô bàn cờ cho chỗ trong suốt */
export function checker(g: CanvasRenderingContext2D, w: number, h: number, size: number) {
  g.fillStyle = '#2a2d38'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#323644'
  for (let y = 0; y < h; y += size) for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) g.fillRect(x, y, size, size)
}
