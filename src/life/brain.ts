import type { Mood, PoseMode } from '../characters/Character'
import type { AgentStatus } from '../data/types'
import { damp, lerpAngle, rand } from '../lib/math'
import { agentPos, lobbyPos, player } from '../runtime'
import { navRef, route } from '../world/nav'
import { forward, type Activity, type DeskSlot, type Vec2 } from '../world/layout'
import { actors, chooseBed, chooseSpot, hasAgentRooms, newActor, release, resetToSeat, type LifeActor } from './actors'
import { excuse, onArrive } from './director'
import { spotById } from './spots'
import { clock, forget, isSpeaking } from './store'

/**
 * "Bộ não" của một agent trong văn phòng pixel: đi đâu, đi đường nào (lưới tìm đường src/world/nav.ts),
 * né ai, dừng lại làm gì, dáng và nét mặt. Không vẽ gì cả.
 */

const WALK_SPEED = 1.35
/** Khoảng cách bắt đầu né người khác khi đi */
const PERSONAL = 0.85
/** Ghé bàn đồng nghiệp: đứng sau lưng ghế bao xa */
const VISIT_BACK = 0.62

/** Dáng khi dừng ở một chỗ */
const ACT_POSE: Partial<Record<Activity, PoseMode>> = { coffee: 'drink', water: 'drink', foos: 'play', pool: 'play', game: 'play', books: 'read', sleep: 'sleep' }

/** Agent đang chờ bạn: 'approval' = có phiếu duyệt, 'question' = chỉ có câu hỏi */
export type Asking = 'approval' | 'question' | null

/** Kết quả mỗi khung hình: vẽ theo đây */
export interface Body {
  mode: PoseMode
  mood: Mood
  /** Đang ngồi (ghế, sofa, ghế đẩu) */
  seat: boolean
  /** Ngồi cao/thấp hơn ghế văn phòng (m) */
  lift: number
  /** Nằm ngủ trên giường */
  lie?: boolean
}

/** Chỗ đứng sau ghế đồng nghiệp */
function behind(s: DeskSlot): Vec2 {
  const f = forward(s.yaw)
  return { x: s.seat.x - f.x * VISIT_BACK, z: s.seat.z - f.z * VISIT_BACK }
}

/**
 * Bắt đầu đi tới `to` theo lưới tìm đường. Đang ngồi trên đồ thì bước ra phía trước trước (a.exit);
 * `via`: chỗ ngồi trên đồ thì đi tới phía trước đồ rồi mới bước vào.
 */
function walkTo(a: LifeActor, to: Vec2, dest: LifeActor['dest'], via?: Vec2) {
  const from: Vec2 = a.exit ?? a
  a.pts = [...(a.exit ? [{ ...a.exit }] : []), ...route(navRef.current, from, via ?? to), ...(via ? [{ ...to }] : [])]
  a.exit = null
  a.i = 0
  a.dest = dest
  a.where = 'walk'
}

/** Lấy (hoặc tạo) trạng thái sống của agent */
export function actorFor(id: string, slot: DeskSlot): LifeActor {
  let a = actors.get(id)
  if (!a) {
    a = newActor(id, slot)
    actors.set(id, a)
  }
  return a
}

/**
 * Bàn của agent vừa được (xếp) lại. Sơ đồ dựng lại mà chỗ ngồi giữ nguyên thì không kéo agent về ghế.
 * Vừa được duyệt thuê: đi bộ từ sảnh (chỗ đứng lúc làm ứng viên) về bàn mới.
 */
export function placeActor(a: LifeActor, slot: DeskSlot) {
  const same = a.slot.id === slot.id && a.slot.seat.x === slot.seat.x && a.slot.seat.z === slot.seat.z
  if (same) a.slot = slot
  else resetToSeat(a, slot)
  const from = lobbyPos.get(a.id)
  if (from) {
    lobbyPos.delete(a.id)
    Object.assign(a, { x: from.x, z: from.z, yaw: Math.PI })
    walkTo(a, slot.seat, 'seat')
  }
}

/** Agent rời văn phòng: xoá hết dấu vết */
export function dropActor(id: string) {
  actors.delete(id)
  release(id)
  agentPos.delete(id)
  forget(id)
}

/** Đi tới chỗ mới (cửa sổ, bảng...), không còn chỗ nào thì về bàn */
function wander(a: LifeActor) {
  const id = chooseSpot(a, a.spot)
  const s = spotById(id)
  if (!s) return walkTo(a, a.slot.seat, 'seat')
  a.spot = s.id
  walkTo(a, s, 'spot', s.via)
}

/** Đang ở / đang đi tới một giường */
const bedBound = (a: LifeActor) => spotById(a.spot)?.act === 'sleep' && (a.where === 'spot' || (a.where === 'walk' && a.dest === 'spot'))

/**
 * Một bước mô phỏng. Đang làm / lỗi / chờ bạn duyệt → ngồi ở bàn (chờ duyệt thì giơ tay).
 * Tạm dừng → về giường trống ở phòng ngủ mà ngủ; hết giường thì ngủ gục ở bàn.
 * Rảnh → đi tới các chỗ chơi, tụ tập nói chuyện. Văn phòng có phòng nghỉ / phòng ngủ (house.json `use`) thì chỉ chơi
 * ở đó và không về bàn ngồi chơi; không có thì chơi khắp văn phòng (cửa sổ, bảng ticket, góc tán gẫu...), thỉnh thoảng về bàn.
 */
export function stepActor(a: LifeActor, st: AgentStatus, ask: Asking, rawDt: number): Body {
  const dt = Math.min(rawDt, 0.05)
  const slot = a.slot
  const t = clock.t
  const talking = a.talkUntil > t
  // Tạm dừng: tìm giường (vài giây thử lại một lần nếu hết giường)
  const napping = st === 'paused' && ask === null
  if (napping && !bedBound(a) && !talking && t >= a.bedAt) {
    a.bedAt = t + 4
    const bed = spotById(chooseBed(a))
    if (bed) {
      a.cmd = null
      a.spot = bed.id
      walkTo(a, bed, 'spot', bed.via)
    }
  }
  // Có việc chờ bạn: về bàn ngồi giơ tay, để bạn biết tìm ở đâu
  const wantsSeat = (st !== 'idle' || ask !== null) && !(napping && bedBound(a))
  const toSeat = () => {
    release(a.id)
    a.spot = null
    walkTo(a, slot.seat, 'seat')
  }

  // ── Lệnh ghé bàn từ director ──
  if (a.cmd && (wantsSeat || a.where === 'walk')) a.cmd = null
  if (a.cmd && !talking) {
    const m = actors.get(a.cmd.target)
    a.cmd = null
    if (m) {
      release(a.id)
      a.spot = null
      a.visitOf = m.id
      a.lookAt = { ...m.slot.seat }
      walkTo(a, behind(m.slot), 'visit')
    }
  }

  if (a.where === 'seat') {
    if (!wantsSeat && !talking) {
      a.timer -= dt
      if (a.timer <= 0) wander(a)
    }
  } else if (a.where === 'spot' || a.where === 'visit') {
    if (wantsSeat) toSeat()
    else if (!talking) {
      a.timer -= dt
      if (napping) a.timer = Math.max(a.timer, 1)
      else if (a.timer <= 0) {
        if (a.where === 'visit' || (!hasAgentRooms() && Math.random() < 0.3)) toSeat()
        else wander(a)
      }
    }
  } else {
    // Đang đi mà có việc → quay về bàn
    if (wantsSeat && a.dest !== 'seat') toSeat()
    const tgt = a.pts[a.i] ?? slot.seat
    const dx = tgt.x - a.x, dz = tgt.z - a.z
    const d = Math.hypot(dx, dz)
    let speed = WALK_SPEED

    // ── Né người khác: cùng đi sang phải; bạn chắn ngay trước mặt thì đứng chờ ──
    if (d > 1e-4) {
      const fx = dx / d, fz = dz / d
      const rx = -fz, rz = fx
      let blocked = false
      const avoid = (ox: number, oz: number, isPlayer: boolean, still: boolean) => {
        const vx = ox - a.x, vz = oz - a.z
        const od = Math.hypot(vx, vz)
        if (od > PERSONAL || od < 1e-4) return
        const ahead = (vx * fx + vz * fz) / od
        if (ahead < 0.2) return
        // Mục tiêu ở ngay sau người kia (vd ghế bên cạnh) thì không cần né
        if (d < od) return
        const push = (PERSONAL - od) * 1.8 * dt
        a.x += rx * push
        a.z += rz * push
        if (ahead > 0.75 && od < 0.6) {
          if (isPlayer) blocked = true
          else if (still) speed *= 0.5
        }
      }
      for (const o of actors.values()) if (o !== a) avoid(o.x, o.z, false, o.where !== 'walk')
      avoid(player.x, player.z, true, true)
      if (blocked) {
        speed = 0
        a.blockedFor += dt
        if (a.blockedFor > 1.2) excuse(a)
      } else a.blockedFor = 0
    }

    const step = speed * dt
    if (d <= Math.max(step, 1e-4)) {
      a.x = tgt.x
      a.z = tgt.z
      a.i++
      if (a.i >= a.pts.length) {
        a.arrivedAt = t
        if (a.dest === 'seat') {
          a.where = 'seat'
          a.x = slot.seat.x
          a.z = slot.seat.z
          a.timer = rand(8, 20)
        } else if (a.dest === 'visit') {
          a.where = 'visit'
          a.visitTalked = false
          a.timer = 12
        } else {
          a.where = 'spot'
          const here = spotById(a.spot)
          a.exit = here?.via ? { ...here.via } : null
          a.timer = here?.act === 'sleep' ? rand(40, 80) : here?.sit !== undefined ? rand(18, 34) : rand(12, 26)
          onArrive(a)
        }
      }
    } else if (step > 0) {
      a.x += (dx / d) * step
      a.z += (dz / d) * step
      a.yaw = lerpAngle(a.yaw, Math.atan2(dx, dz), damp(10, dt))
    }
  }

  // ── Dáng, nét mặt, hướng nhìn ──
  const speaking = isSpeaking(a.id)
  let seat = false
  let lift = 0
  let mode: PoseMode = 'stand'
  let yawTo: number | null = null
  const here = a.where === 'spot' ? spotById(a.spot) : undefined
  if (a.where === 'seat') {
    seat = true
    mode =
      // Đang làm mà vẫn chờ bạn: gõ phím, thỉnh thoảng giơ tay
      ask && (st !== 'running' || Math.sin(t * 0.6 + a.phase) > 0.35) ? 'raise' :
      st === 'running' ? 'type' :
      st === 'paused' ? 'sleep' :
      st === 'error' ? (Math.sin(t * 0.7 + a.phase) > -0.2 ? 'facepalm' : 'sit') :
      speaking ? 'talk' : 'sit'
    yawTo = slot.yaw
  } else if (a.where === 'spot') {
    seat = here?.sit !== undefined
    lift = here?.sit ?? 0
    let base = (here?.act && ACT_POSE[here.act]) || (seat ? 'sit' : 'stand')
    // Bi-a, bóng bàn: hai đầu bàn thay lượt mỗi 4 giây; người chờ đứng yên
    if (here && (here.act === 'pool' || here.act === 'foos')) base = Math.floor(t / 4) % 2 === (here.id.endsWith(':a') ? 0 : 1) ? 'play' : 'stand'
    mode = speaking && base !== 'play' ? 'talk' : base
    yawTo = !seat && a.face && a.faceUntil > t ? Math.atan2(a.face.x - a.x, a.face.z - a.z) : here?.yaw ?? null
  } else if (a.where === 'visit') {
    mode = speaking ? 'talk' : 'stand'
    if (a.lookAt) yawTo = Math.atan2(a.lookAt.x - a.x, a.lookAt.z - a.z)
    if (a.face && a.faceUntil > t) yawTo = Math.atan2(a.face.x - a.x, a.face.z - a.z)
  } else {
    mode = 'walk'
  }
  if (a.where !== 'walk' && a.gesture && a.gestureUntil > t) mode = a.gesture
  if (yawTo !== null) a.yaw = lerpAngle(a.yaw, yawTo, damp(7, dt))

  let mood: Mood = st === 'running' ? 'focus' : st === 'error' ? 'shock' : 'normal'
  if (here?.act === 'foos' || here?.act === 'pool' || here?.act === 'game' || here?.act === 'pet') mood = 'happy'
  if (a.mood && a.moodUntil > t) mood = a.mood

  agentPos.set(a.id, { x: a.x, z: a.z })
  return { mode, mood, seat, lift, lie: here?.act === 'sleep' && a.where === 'spot' }
}
