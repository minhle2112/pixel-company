import { Rectangle, Texture } from 'pixi.js'
import { loadImage } from './assets'
import type { Dir } from './geom'

/**
 * Nhân vật pixel ghép từ bộ "Character Generator" của LimeZu: thân (màu da) + mắt + bộ đồ + kiểu tóc (+ phụ kiện).
 * Mỗi lớp là một sheet 16×32 mỗi khung, cùng bố cục, nên chồng lên nhau là ra một nhân vật hoàn chỉnh.
 *
 * Bố cục sheet (hàng = động tác, mỗi hàng cao 32 px):
 *   1 đứng yên · 2 đi bộ: 6 khung mỗi hướng, theo thứ tự phải, lên, trái, xuống · 3 nằm ngủ: 6 khung chỉ có đầu (thở)
 *   4 ngồi: 6 khung quay phải, 6 khung quay trái · 6 cầm điện thoại · 7 đọc sách
 */

export const CW = 16
export const CH = 32

export interface Parts {
  /** 1–7: màu da */
  body: number
  /** 1–7 */
  eyes: number
  /** [kiểu 1–33, màu] */
  outfit: [number, number]
  /** [kiểu 1–29, màu 1–7] */
  hair: [number, number]
  /** Tên file phụ kiện (không đuôi), vd "Accessory_15_Glasses_01" */
  acc?: string | null
}

export type Anim = 'idle' | 'walk' | 'sit' | 'phone' | 'read' | 'sleep'

const ROW: Record<Anim, number> = { idle: 1, walk: 2, sleep: 3, sit: 4, phone: 6, read: 7 }
const DIR_OFF: Record<Dir, number> = { right: 0, up: 6, left: 12, down: 18 }
const GEN = '2_Characters/Character_Generator'
const pad = (n: number) => String(n).padStart(2, '0')

export const partFiles = (p: Parts) =>
  [
    `${GEN}/Bodies/16x16/Body_${pad(p.body)}.png`,
    `${GEN}/Eyes/16x16/Eyes_${pad(p.eyes)}.png`,
    `${GEN}/Outfits/16x16/Outfit_${pad(p.outfit[0])}_${pad(p.outfit[1])}.png`,
    `${GEN}/Hairstyles/16x16/Hairstyle_${pad(p.hair[0])}_${pad(p.hair[1])}.png`,
    p.acc ? `${GEN}/Accessories/16x16/${p.acc}.png` : null,
  ].filter((f): f is string => !!f)

export const partsKey = (p: Parts) => partFiles(p).join('|')

/** Sheet đã ghép của một nhân vật, cắt sẵn từng khung */
export class CharSheet {
  private cache = new Map<string, Texture>()
  private sil: Texture | null = null
  constructor(readonly base: Texture) {}

  /**
   * Bóng trắng của nhân vật (cùng khung với frame()): vẽ lệch 1 px phía sau làm viền sáng,
   * để tóc tối / xám không chìm vào lưng ghế đen.
   */
  silhouette(anim: Anim, dir: Dir, i: number): Texture {
    if (!this.sil) {
      const src = this.base.source.resource as HTMLCanvasElement
      const c = document.createElement('canvas')
      c.width = src.width
      c.height = src.height
      const g = c.getContext('2d')!
      g.drawImage(src, 0, 0)
      g.globalCompositeOperation = 'source-in'
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, c.width, c.height)
      this.sil = Texture.from(c)
    }
    const f = this.frame(anim, dir, i).frame
    const key = `sil:${f.x}:${f.y}`
    let t = this.cache.get(key)
    if (!t) {
      t = new Texture({ source: this.sil.source, frame: new Rectangle(f.x, f.y, f.width, f.height) })
      this.cache.set(key, t)
    }
    return t
  }

  frame(anim: Anim, dir: Dir, i: number): Texture {
    let col: number
    if (anim === 'idle' || anim === 'walk') col = DIR_OFF[dir] + (i % 6)
    else if (anim === 'sit') col = (dir === 'left' ? 6 : 0) + (i % 6)
    else col = i % 12
    const key = `${ROW[anim]}:${col}`
    let t = this.cache.get(key)
    if (!t) {
      t = new Texture({ source: this.base.source, frame: new Rectangle(col * CW, ROW[anim] * CH, CW, CH) })
      this.cache.set(key, t)
    }
    return t
  }
}

const sheets = new Map<string, Promise<CharSheet>>()

/** Ghép (một lần cho mỗi bộ phận) rồi dùng lại */
export function charSheet(p: Parts): Promise<CharSheet> {
  const key = partsKey(p)
  let s = sheets.get(key)
  if (!s) {
    s = (async () => {
      const imgs = await Promise.all(partFiles(p).map(loadImage))
      const c = document.createElement('canvas')
      c.width = 896
      c.height = 8 * CH
      const g = c.getContext('2d')!
      g.imageSmoothingEnabled = false
      // Chỉ cần 8 hàng đầu (tới đọc sách)
      for (const img of imgs) g.drawImage(img, 0, 0, 896, 8 * CH, 0, 0, 896, 8 * CH)
      return new CharSheet(Texture.from(c))
    })()
    sheets.set(key, s)
  }
  return s
}

/** Số khung mỗi giây của từng động tác */
export const FPS: Record<Anim, number> = { idle: 5, walk: 10, sit: 4, phone: 6, read: 4, sleep: 1.5 }

/** Khung thứ mấy tại thời điểm t (giây). Điện thoại / đọc sách lặp đoạn giữa sau lần đầu. */
export function frameAt(anim: Anim, t: number, phase = 0): number {
  const n = Math.floor((t + phase) * FPS[anim])
  if (anim === 'phone') return 3 + (n % 6)
  return n % 6
}
