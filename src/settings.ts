import { create } from 'zustand'

export type Quality = 'auto' | 'high' | 'low'
/** Thu phóng bản pixel: 'near' = nhìn gần hơn một nấc, 'far' = xa nhất */
export type Zoom = 'near' | 'far'

export interface Settings {
  /** Âm thanh văn phòng: gõ phím, "ting", bước chân, bong bóng */
  sfx: boolean
  sfxVol: number
  /** Nhạc lofi tự sinh */
  music: boolean
  musicVol: number
  quality: Quality
  /** null = theo giờ Việt Nam; số = xem thử một giờ cố định (0–24) */
  hour: number | null
  zoom: Zoom
  /** Model của Trợ lý (lễ tân). '' = mặc định của Claude Code */
  assistantModel: string
  /** Lễ tân tự báo: ticket xong / cần quyết, tóm tắt đầu ngày (mỗi lần báo tốn một lượt hạn mức) */
  assistantProactive: boolean
}

const KEY = 'coopverse.settings.v1'
const DEFAULTS: Settings = { sfx: true, sfxVol: 0.7, music: false, musicVol: 0.5, quality: 'auto', hour: null, zoom: 'near', assistantModel: 'claude-sonnet-5-5', assistantProactive: true }

/** Model chọn được cho Trợ lý (Claude Code). Muốn rẻ / nhanh: Haiku; lập kế hoạch khó: Opus */
export const ASSISTANT_MODELS: { id: string; label: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: '', label: 'Mặc định của Claude Code' },
]

const vol = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const QUALITIES: Quality[] = ['auto', 'high', 'low']

/** Giờ hợp lệ trong [0, 24), hoặc null nếu không phải số hữu hạn. */
export function normHour(v: unknown): number | null {
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? ((n % 24) + 24) % 24 : null
}

/** Dữ liệu cũ hoặc hỏng trong localStorage không được làm hỏng app: từng trường lỗi thì về mặc định. */
function load(): Settings {
  const s = { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(KEY)
    const j: unknown = raw ? JSON.parse(raw) : null
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const o = j as Record<string, unknown>
      s.sfx = bool(o.sfx, s.sfx)
      s.sfxVol = vol(o.sfxVol, s.sfxVol)
      s.music = bool(o.music, s.music)
      s.musicVol = vol(o.musicVol, s.musicVol)
      if (QUALITIES.includes(o.quality as Quality)) s.quality = o.quality as Quality
      if (o.zoom === 'near' || o.zoom === 'far') s.zoom = o.zoom
      if (ASSISTANT_MODELS.some((m) => m.id === o.assistantModel)) s.assistantModel = o.assistantModel as string
      s.assistantProactive = bool(o.assistantProactive, s.assistantProactive)
    }
  } catch {
    /* trình duyệt chặn bộ nhớ hoặc JSON hỏng: dùng mặc định */
  }
  // ?hour=21.5 trên URL: xem thử giờ (không lưu)
  s.hour = normHour(new URLSearchParams(location.search).get('hour'))
  return s
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch)
    // Giờ xem thử chỉ dùng trong phiên, mở lại là về giờ Việt Nam
    const { set: _s, hour: _h, ...rest } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify(rest))
    } catch {
      /* bỏ qua */
    }
  },
}))
