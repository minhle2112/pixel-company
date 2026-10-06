import { Color } from 'three'
import { useSettings } from '../settings'

const VN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** Giờ hiện tại ở Việt Nam (GMT+7), dạng số thập phân 0–24. */
export function vnHour(d = new Date()) {
  const [h, m, s] = VN.format(d).split(':').map(Number)
  return h + m / 60 + s / 3600
}

/** Giờ đang dùng cho cảnh: giờ xem thử nếu có, không thì giờ Việt Nam. */
export const sceneHour = () => useSettings.getState().hour ?? vnHour()

export function fmtHour(h: number) {
  const m = Math.floor((h % 1) * 60 + 1e-6)
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function periodOf(h: number) {
  if (h < 5) return 'Khuya'
  if (h < 11) return 'Buổi sáng'
  if (h < 13) return 'Buổi trưa'
  if (h < 18) return 'Buổi chiều'
  if (h < 22) return 'Buổi tối'
  return 'Khuya'
}

/** TP.HCM: mặt trời mọc ~5:45, lặn ~17:45 quanh năm (chênh không quá nửa tiếng). */
const RISE = 5.75
const SET = 17.75

/** Độ cao mặt trời: 1 = đỉnh đầu, 0 = đường chân trời, âm = đêm. */
export function sunElevation(h: number) {
  const f = (h - RISE) / (SET - RISE)
  if (f >= 0 && f <= 1) return Math.sin(Math.PI * f)
  const off = f < 0 ? -f : f - 1
  return -Math.sin(Math.min(1, off * 2) * Math.PI / 2) * 0.6
}

/** 0..1: phần trăm đường đi của mặt trời từ đông sang tây (ngoài ngày thì kẹp 0/1). */
export const sunProgress = (h: number) => Math.min(1, Math.max(0, (h - RISE) / (SET - RISE)))

interface Key { h: number; sky: string; sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; lamp: number }

// Bảng màu theo giờ, nội suy tuyến tính giữa các mốc
const KEYS: Key[] = [
  { h: 0, sky: '#0a1330', sun: '#7f95c8', sunI: 0.32, hemiSky: '#34436e', hemiGround: '#1d1b26', hemiI: 0.45, lamp: 1 },
  { h: 4.8, sky: '#0d1636', sun: '#7f95c8', sunI: 0.32, hemiSky: '#34436e', hemiGround: '#1d1b26', hemiI: 0.45, lamp: 1 },
  { h: 5.5, sky: '#34407a', sun: '#a08cc0', sunI: 0.3, hemiSky: '#5a5f8a', hemiGround: '#3a3040', hemiI: 0.55, lamp: 1 },
  { h: 6.2, sky: '#f0a27a', sun: '#ffae6e', sunI: 0.9, hemiSky: '#ffd2b0', hemiGround: '#7a6250', hemiI: 0.85, lamp: 0.6 },
  { h: 7.3, sky: '#b4dcf2', sun: '#ffe6c4', sunI: 1.6, hemiSky: '#fff1e0', hemiGround: '#988670', hemiI: 1.15, lamp: 0 },
  { h: 12, sky: '#bfe3f5', sun: '#fff3dc', sunI: 1.9, hemiSky: '#fff6e8', hemiGround: '#9a8a70', hemiI: 1.25, lamp: 0 },
  { h: 16.2, sky: '#bfe0f2', sun: '#fff0d4', sunI: 1.8, hemiSky: '#fff4e4', hemiGround: '#9a8a70', hemiI: 1.22, lamp: 0 },
  { h: 17.2, sky: '#f6c88e', sun: '#ffc27a', sunI: 1.4, hemiSky: '#ffe2c0', hemiGround: '#8a7460', hemiI: 1.05, lamp: 0.2 },
  { h: 17.9, sky: '#e48a6c', sun: '#ff9a60', sunI: 0.8, hemiSky: '#f0b0a0', hemiGround: '#6a5058', hemiI: 0.8, lamp: 0.7 },
  { h: 18.6, sky: '#4c4680', sun: '#9a88c8', sunI: 0.35, hemiSky: '#6a6aa0', hemiGround: '#3a3048', hemiI: 0.6, lamp: 1 },
  { h: 19.6, sky: '#121c44', sun: '#7f95c8', sunI: 0.32, hemiSky: '#3a4872', hemiGround: '#201d2a', hemiI: 0.48, lamp: 1 },
  { h: 24, sky: '#0a1330', sun: '#7f95c8', sunI: 0.32, hemiSky: '#34436e', hemiGround: '#1d1b26', hemiI: 0.45, lamp: 1 },
]

const _a = new Color(), _b = new Color()
const mix = (out: Color, a: string, b: string, t: number) => out.copy(_a.set(a)).lerp(_b.set(b), t)

export interface Ambience {
  sky: Color
  sun: Color
  sunI: number
  hemiSky: Color
  hemiGround: Color
  hemiI: number
  /** Đèn trong phòng: 0 = tắt (ban ngày), 1 = bật hết */
  lamp: number
  /** Độ "đêm" của bầu trời (sao hiện ra): 0..1 */
  night: number
}

/** Ánh sáng và màu trời ở một giờ. Ghi vào `out` để không tạo đối tượng mới mỗi khung hình. */
export function ambienceAt(h: number, out: Ambience) {
  h = ((h % 24) + 24) % 24
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++
  const a = KEYS[i], b = KEYS[i + 1]
  const t = (h - a.h) / (b.h - a.h || 1)
  mix(out.sky, a.sky, b.sky, t)
  mix(out.sun, a.sun, b.sun, t)
  mix(out.hemiSky, a.hemiSky, b.hemiSky, t)
  mix(out.hemiGround, a.hemiGround, b.hemiGround, t)
  out.sunI = a.sunI + (b.sunI - a.sunI) * t
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t
  out.lamp = a.lamp + (b.lamp - a.lamp) * t
  const e = sunElevation(h)
  out.night = Math.min(1, Math.max(0, -e / 0.3))
  return out
}

export const newAmbience = (): Ambience => ({
  sky: new Color(), sun: new Color(), sunI: 0, hemiSky: new Color(), hemiGround: new Color(), hemiI: 0, lamp: 0, night: 0,
})
