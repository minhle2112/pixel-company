import { Color } from 'three'
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { setMusicNight } from '../audio/engine'
import { useSettings } from '../settings'
import { ambienceAt, newAmbience, sceneHour } from '../world/time'
import { MAP_H, MAP_W } from './geom'
import type { Light } from './office'

/*
 * Ngày/đêm cho bản pixel, cùng bảng giờ với bản 3D (world/time.ts, giờ Việt Nam hoặc giờ xem thử trong Cài đặt):
 * - một lớp "nhân" (multiply) phủ cả bản đồ: trắng ban ngày, cam lúc bình minh / hoàng hôn, xanh tối ban đêm
 * - các quầng sáng cộng (add) ở đèn bàn, đèn cây, đèn trần, màn hình, sáng dần khi trời tối
 * - vệt nắng qua cửa sổ mờ đi theo nắng
 */

/**
 * Màu lớp "nhân" theo giờ (riêng cho bản pixel): ban đêm xanh tím còn giữ độ bão hoà để quầng đèn vàng nổi lên,
 * bình minh / hoàng hôn chỉ ấm nhẹ (đã giới hạn ~25%), ban ngày trắng (giữ nguyên màu gói hình).
 */
const TINT: [number, string][] = [
  [0, '#5a6496'], [4.8, '#5a6496'], [5.5, '#7a78ac'], [6.2, '#f6dcc8'], [7.3, '#fffaf4'], [12, '#ffffff'],
  [16.2, '#fffbf4'], [17.2, '#ffecd6'], [17.9, '#f8d6c4'], [18.6, '#8c80b4'], [19.6, '#5a6496'], [24, '#5a6496'],
]
const _a = new Color(), _b = new Color()
function tintAt(h: number, out: Color) {
  h = ((h % 24) + 24) % 24
  let i = 0
  while (i < TINT.length - 2 && TINT[i + 1][0] <= h) i++
  const [ha, ca] = TINT[i], [hb, cb] = TINT[i + 1]
  return out.copy(_a.set(ca)).lerp(_b.set(cb), (h - ha) / (hb - ha || 1))
}

/** Đèn ấm màu hổ phách; chỉ màn hình mới xanh */
const COLOR: Record<Light['kind'], number> = { lamp: 0xffc070, ceiling: 0xffcf8a, screen: 0x7fb4ff }

/** Quầng sáng kiểu pixel: các vòng đậm nhạt theo bậc thay vì chuyển màu mượt */
let glowTex: Texture | null = null
function glowTexture() {
  if (glowTex) return glowTex
  const n = 32
  const c = document.createElement('canvas')
  c.width = c.height = n
  const g = c.getContext('2d')!
  const img = g.createImageData(n, n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)
      // 6 bậc giảm dần theo bình phương: tâm sáng, rìa tắt êm mà vẫn thấy bậc pixel
      const a = d >= 1 ? 0 : Math.pow(1 - Math.floor(d * 6) / 6, 2)
      const i = (y * n + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  glowTex = Texture.from(c)
  glowTex.source.scaleMode = 'nearest'
  return glowTex
}

export class Lighting {
  /** Lớp tối (đặt trên người và đồ đạc) */
  readonly shade = new Graphics()
  /** Lớp quầng sáng (đặt trên lớp tối) */
  readonly glow = new Container()
  /** `k`: hệ số sáng của màn hình máy theo trạng thái agent (1 đang chạy, nhỏ hơn khi màn chờ, 0 khi tắt) */
  private lights: { s: Sprite; kind: Light['kind']; slot?: string; k: number }[] = []
  /** Độ sáng quầng màn hình theo giờ (trước khi nhân hệ số trạng thái) */
  private screenA = 0
  private masks: Graphics[] = []
  private sun: Graphics | null = null
  private panes: Graphics | null = null
  private stars: Graphics | null = null
  private amb = newAmbience()
  private tint = new Color()
  private at = -1
  private hour = 12
  private override: number | null = null

  constructor() {
    this.shade.rect(-64, -64, MAP_W + 128, MAP_H + 128).fill(0xffffff)
    this.shade.blendMode = 'multiply'
    this.glow.blendMode = 'add'
  }

  /** Gắn lại theo văn phòng mới (thuê người, đổi bậc bàn) */
  setOffice(lights: Light[], o: { sun: Graphics; panes: Graphics; stars: Graphics }) {
    for (const l of this.lights) l.s.destroy()
    for (const m of this.masks) m.destroy()
    this.masks = []
    this.lights = lights.map((l) => {
      const s = new Sprite(glowTexture())
      s.anchor.set(0.5)
      s.position.set(Math.round(l.x), Math.round(l.y))
      // Nhìn nghiêng từ trên xuống: quầng sáng hơi dẹt
      s.width = l.r * 2
      s.height = Math.round(l.r * 2 * (l.kind === 'screen' ? 1 : 0.8))
      s.tint = COLOR[l.kind]
      s.alpha = 0
      s.blendMode = 'add'
      if (l.clip) {
        const m = new Graphics().rect(l.clip.x, l.clip.y, l.clip.w, l.clip.h).fill(0xffffff)
        this.glow.addChild(m)
        this.masks.push(m)
        s.mask = m
      }
      this.glow.addChild(s)
      return { s, kind: l.kind, slot: l.slot, k: 1 }
    })
    this.sun = o.sun
    this.panes = o.panes
    this.stars = o.stars
    this.at = -1
  }

  /**
   * Màn hình máy ở bàn: đang chạy sáng hẳn, rảnh (màn chờ xanh tối) sáng nhẹ, tạm dừng / lỗi / nghỉ / bàn trống thì không hắt sáng.
   * Scene gọi cùng lúc vẽ lại màn hình.
   */
  setScreens(statusOf: (slot: string) => string | null) {
    for (const l of this.lights) {
      if (!l.slot) continue
      const st = statusOf(l.slot)
      const k = st === 'running' ? 1 : st === 'idle' ? 0.4 : 0
      if (k === l.k) continue
      l.k = k
      l.s.alpha = this.screenA * k
    }
  }

  /** Mỗi khung hình. Giờ chỉ tính lại mỗi giây (hoặc ngay khi đổi giờ xem thử). */
  update(t: number) {
    const o = useSettings.getState().hour
    if (t - this.at < 1 && this.at >= 0 && o === this.override) return
    this.at = t
    this.override = o
    const h = sceneHour()
    this.hour = h
    const a = ambienceAt(h, this.amb)
    this.shade.tint = tintAt(h, this.tint).getHex()
    // Đỉnh quầng sáng vừa phải để vẫn thấy vân sàn ở giữa vùng sáng
    this.screenA = 0.1 + 0.26 * a.lamp
    for (const l of this.lights) {
      l.s.alpha = l.kind === 'lamp' ? 0.5 * a.lamp : l.kind === 'ceiling' ? 0.34 * a.lamp : this.screenA * l.k
    }
    if (this.sun) this.sun.alpha = Math.min(1, a.sunI / 1.9) * (1 - a.night)
    // Kính cửa sổ: trong suốt khi trời sáng, ngả màu trời lúc chạng vạng, xanh đậm có sao ban đêm
    if (this.panes) {
      this.panes.tint = a.sky.getHex()
      this.panes.alpha = Math.min(0.9, Math.max(0, 1 - a.sunI / 1.5))
    }
    if (this.stars) this.stars.alpha = a.night
    setMusicNight(a.night)
  }

  /** Giờ đang hiển thị (cho công cụ dev) */
  get now() { return this.hour }

  destroy() {
    this.shade.destroy()
    this.glow.destroy({ children: true })
  }
}
