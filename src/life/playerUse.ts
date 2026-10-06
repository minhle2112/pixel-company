import { player } from '../runtime'
import type { Activity } from '../world/layout'
import { claim, claimedBy, release } from './actors'
import { allSpots, spotById, type Spot } from './spots'

/**
 * Bạn (người chơi) dùng đồ đã mua: đứng gần sofa, ghế bành, máy game, quầy cà phê... bấm E để ngồi / dùng,
 * bấm E lần nữa hoặc đi tiếp là đứng dậy. Chỗ bạn đang dùng được giữ chỗ, agent không tới ngồi đè.
 */

const WHO = '#player'
/** Đứng cách chỗ dùng (chỗ ngồi hoặc điểm bước vào, lấy chỗ gần hơn) bao xa thì bấm E được */
const REACH = 0.95

export const USE_LABEL: Partial<Record<Activity, string>> = {
  sofa: 'Ngồi nghỉ', stool: 'Ngồi', meeting: 'Ngồi', coffee: 'Pha cà phê', water: 'Uống nước', snack: 'Ăn vặt',
  fridge: 'Mở tủ lạnh', cook: 'Nấu mì', game: 'Chơi game', pool: 'Đánh bi-a', foos: 'Đánh bóng bàn',
  books: 'Đọc sách', board: 'Vẽ lên bảng', tv: 'Xem TV', pet: 'Vuốt mèo',
}

/** Chỗ bạn đang dùng (id trong spots.ts) */
export const using = { spot: null as string | null }

/** Chỗ dùng được gần bạn nhất (chưa có agent giữ) và khoảng cách, hoặc null */
export function nearestUse(): { spot: Spot; d: number } | null {
  let best: Spot | null = null
  let bd = REACH
  for (const s of allSpots()) {
    if (!s.item) continue
    const who = claimedBy(s.id)
    if (who && who !== WHO) continue
    const d = Math.min(Math.hypot(s.x - player.x, s.z - player.z), s.via ? Math.hypot(s.via.x - player.x, s.via.z - player.z) : Infinity)
    if (d < bd) { bd = d; best = s }
  }
  return best ? { spot: best, d: bd } : null
}

/** Ngồi / dùng một chỗ. false = có agent vừa giữ chỗ này */
export function takeSpot(id: string): boolean {
  const s = spotById(id)
  if (!s?.item || !claim(id, WHO)) return false
  using.spot = id
  player.x = s.x
  player.z = s.z
  if (s.yaw !== undefined) player.facing = s.yaw
  return true
}

/** Đứng dậy: ngồi trên đồ thì bước ra phía trước đồ */
export function standUp() {
  const s = spotById(using.spot)
  release(WHO)
  if (s?.via) {
    player.x = s.via.x
    player.z = s.via.z
  }
  using.spot = null
}
