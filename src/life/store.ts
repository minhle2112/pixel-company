import { create } from 'zustand'

/** Đồng hồ của "đời sống văn phòng" (giây). Chạy theo khung hình nên dừng khi tab ẩn, khớp với __coop.step khi test. */
export const clock = { t: 0 }

export interface Bubble { id: number; text: string; until: number; real?: boolean }
export interface Emote { id: number; icon: string; until: number }

interface LifeState {
  /** agentId → câu đang nói */
  bubbles: Record<string, Bubble>
  /** agentId → biểu tượng tạm thời trên đầu (🎉, ☕, 👋...) */
  emotes: Record<string, Emote>
}

export const useLife = create<LifeState>(() => ({ bubbles: {}, emotes: {} }))

let seq = 0

/** Thời gian đọc một câu: ~55 ms mỗi ký tự, trong khoảng 2,6–7 giây. */
export const readTime = (text: string) => Math.min(7, Math.max(2.6, 1.6 + text.length * 0.055))

/** Agent nói một câu (hiện bong bóng). `real` = câu lấy từ dữ liệu Paperclip thật. Trả về số giây hiển thị. */
export function say(id: string, text: string, opts: { real?: boolean; sec?: number } = {}) {
  const sec = opts.sec ?? readTime(text)
  useLife.setState((s) => ({ bubbles: { ...s.bubbles, [id]: { id: ++seq, text, until: clock.t + sec, real: opts.real } } }))
  return sec
}

export function emote(id: string, icon: string, sec = 3) {
  useLife.setState((s) => ({ emotes: { ...s.emotes, [id]: { id: ++seq, icon, until: clock.t + sec } } }))
}

export const isSpeaking = (id: string) => (useLife.getState().bubbles[id]?.until ?? 0) > clock.t

/** Xoá bong bóng / biểu tượng đã hết giờ (chỉ ghi store khi có thay đổi). */
export function expireLife() {
  const { bubbles, emotes } = useLife.getState()
  const t = clock.t
  const live = <T extends { until: number }>(m: Record<string, T>) => {
    const out: Record<string, T> = {}
    let changed = false
    for (const [k, v] of Object.entries(m)) {
      if (v.until > t) out[k] = v
      else changed = true
    }
    return changed ? out : null
  }
  const b = live(bubbles), e = live(emotes)
  if (b || e) useLife.setState({ ...(b ? { bubbles: b } : {}), ...(e ? { emotes: e } : {}) })
}

/** Xoá hết dấu vết của một agent (khi agent rời văn phòng). */
export function forget(id: string) {
  useLife.setState((s) => {
    const bubbles = { ...s.bubbles }, emotes = { ...s.emotes }
    delete bubbles[id]
    delete emotes[id]
    return { bubbles, emotes }
  })
}
