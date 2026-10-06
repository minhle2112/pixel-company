import { titleOf } from '../data/exp'
import { leadIdsOf } from '../data/hire'
import type { Agent, AskKind } from '../data/types'
import { player } from '../runtime'
import { useCoop } from '../store'
import type { Room } from '../world/rooms'
import { actors, type LifeActor } from './actors'
import { ACT_EMOTE, ASK_APPROVAL, ASK_DENIED, ASK_QUESTION, ASK_THANKS, BOUGHT, EXCUSE, ROOM_OPENED, GIFT, LEVEL_UP, dialogue, greet, muse, onStatus, visitTalk, type Dialogue, type Line, type World } from './lines'
import { spotById } from './spots'
import { clock, emote, expireLife, isSpeaking, readTime, say, useLife } from './store'

/**
 * Đạo diễn đời sống văn phòng: mỗi 0,25 giây xem ai đang rảnh để cho nói một câu, bắt chuyện với nhau,
 * chào bạn khi đi ngang, và cho Lead ghé bàn thành viên đang làm.
 * Chuyển động do AgentActor tự lo; ở đây chỉ ra lệnh và hiện bong bóng.
 */

const TICK = 0.25
/** Tối đa bao nhiêu bong bóng cùng lúc (câu tự nói; hội thoại và câu chào không tính) */
const MAX_MUSING = 3
const GREET_DIST = 2.4
const CHAT_DIST_SPOT = 3.2
const CHAT_DIST_SEAT = 2.0

const rand = (a: number, b: number) => a + Math.random() * (b - a)

let acc = 0
/** Vài câu gần nhất của mỗi agent, để không lặp lại */
const recent = new Map<string, string[]>()

/** Lấy một câu chưa nói gần đây (thử vài lần) */
function fresh(id: string, make: () => Line): Line {
  const said = recent.get(id) ?? []
  let line = make()
  for (let k = 0; k < 6 && said.includes(line.text); k++) line = make()
  recent.set(id, [...said, line.text].slice(-5))
  return line
}

const queue: { at: number; id: string; line: Line }[] = []

/** Bong bóng câu đang nói: nói xong câu này mới tới câu sau. */
function flushQueue() {
  const t = clock.t
  for (let k = 0; k < queue.length; ) {
    const q = queue[k]
    if (q.at <= t) {
      if (actors.has(q.id)) say(q.id, q.line.text, { real: q.line.real })
      queue.splice(k, 1)
    } else k++
  }
}

/** Xếp lịch một đoạn hội thoại; trả về lúc kết thúc. */
function play(ids: [string, string], d: Dialogue) {
  let at = clock.t + 0.2
  for (const [who, line] of d) {
    queue.push({ at, id: ids[who], line })
    at += readTime(line.text) + 0.35
  }
  return at
}

const spotOf = (a: LifeActor) => (a.where === 'spot' ? spotById(a.spot) : undefined)
const actOf = (a: LifeActor) => spotOf(a)?.act ?? null
const settled = (a: LifeActor) => a.where !== 'walk' && clock.t - a.arrivedAt > 1.5
const standing = (a: LifeActor) => (a.where === 'spot' && spotOf(a)?.sit === undefined) || a.where === 'visit'
const lead = (ag: Agent, agents: Agent[]) => leadIdsOf(agents).has(ag.id)

/** Hai agent đủ gần để nói chuyện: cùng khu (góc tán gẫu, cửa sổ...) hoặc sát nhau */
function closeEnough(a: LifeActor, b: LifeActor) {
  const d = Math.hypot(a.x - b.x, a.z - b.z)
  const area = spotOf(a)?.area
  const sameArea = !!area && area === spotOf(b)?.area
  return (sameArea && d < CHAT_DIST_SPOT) || d < CHAT_DIST_SEAT
}

function startChat(a: LifeActor, b: LifeActor, d: Dialogue) {
  const end = play([a.id, b.id], d)
  for (const [me, other] of [[a, b], [b, a]] as const) {
    me.talkUntil = end + 0.5
    me.chatCd = end + rand(30, 60)
    me.face = { x: other.x, z: other.z }
    me.faceUntil = end + 0.5
    // Đồng hồ rời chỗ đứng yên trong lúc nói chuyện; nói xong nán lại ít nhất 2 giây
    me.timer = Math.max(me.timer, 2)
    me.nextMuse = Math.max(me.nextMuse, end + rand(8, 16))
  }
}

function greetPlayer(a: LifeActor, ag: Agent, w: World) {
  const line = greet(ag, w)
  if (!line) return
  const t = clock.t
  if (ag.status === 'idle') {
    a.gesture = 'wave'
    a.gestureUntil = t + 1.8
    a.mood = 'happy'
    a.moodUntil = t + 2.5
    emote(a.id, '👋', 2)
    if (standing(a)) {
      a.face = { x: player.x, z: player.z }
      a.faceUntil = t + 3.5
    }
  }
  say(a.id, line.text, { real: line.real })
  a.nextMuse = Math.max(a.nextMuse, t + 12)
}

export function lifeTick(dt: number) {
  clock.t += dt
  acc += dt
  if (acc < TICK) return
  acc = 0

  expireLife()
  flushQueue()

  const { agents, issues, focusId } = useCoop.getState()
  const w = { agents, issues }
  const byId = new Map(agents.map((x) => [x.id, x]))
  const t = clock.t
  const list = [...actors.values()].filter((a) => byId.has(a.id))
  let musing = Object.values(useLife.getState().bubbles).filter((b) => b.until > t).length

  const idleNow = (a: LifeActor) => byId.get(a.id)!.status === 'idle' && settled(a) && a.talkUntil < t
  const canChat = (a: LifeActor) => idleNow(a) && t > a.chatCd && !isSpeaking(a.id)

  // ── Chào bạn, tự nói một mình ──
  for (const a of list) {
    const ag = byId.get(a.id)!
    if (!settled(a) || a.talkUntil > t) continue
    const dp = Math.hypot(player.x - a.x, player.z - a.z)
    if (dp < GREET_DIST && t > a.greetAt && !focusId) {
      a.greetAt = t + 90
      greetPlayer(a, ag, w)
      continue
    }
    // Có đồng nghiệp rảnh bên cạnh thì để dành cho cuộc trò chuyện
    const company = canChat(a) && list.some((b) => b !== a && canChat(b) && closeEnough(a, b))
    if (t > a.nextMuse && !isSpeaking(a.id) && !company) {
      const busy = ag.status !== 'idle'
      a.nextMuse = t + (busy ? rand(35, 80) : rand(20, 45))
      if (musing >= MAX_MUSING) continue
      const line = fresh(a.id, () => muse(ag, w, actOf(a)))
      say(a.id, line.text, { real: line.real })
      musing++
    }
  }

  // ── Hai agent rảnh ở gần nhau thì bắt chuyện ──
  const idle = list.filter(canChat)
  for (let i = 0; i < idle.length; i++) {
    for (let j = i + 1; j < idle.length; j++) {
      const a = idle[i], b = idle[j]
      if (a.talkUntil > t || b.talkUntil > t) continue
      if (!closeEnough(a, b) || Math.random() > 0.2) continue
      const [p, q] = Math.random() < 0.5 ? [a, b] : [b, a]
      startChat(p, q, dialogue(byId.get(p.id)!, byId.get(q.id)!, w))
    }
  }

  // ── Lead ghé bàn thành viên đang làm ──
  for (const a of list) {
    const ag = byId.get(a.id)!
    if (a.where === 'visit' && !a.visitTalked && t - a.arrivedAt > 0.6 && a.visitOf) {
      a.visitTalked = true
      const m = byId.get(a.visitOf)
      if (!m || !actors.has(m.id)) { a.timer = 1; continue }
      const end = play([a.id, m.id], visitTalk(ag, m, w))
      a.talkUntil = end + 0.5
      a.timer = 2.5
      continue
    }
    if (ag.status !== 'idle' || !settled(a) || a.talkUntil > t || t < a.visitCd || a.cmd || a.where === 'visit') continue
    if (!lead(ag, agents) || Math.random() > 0.02) continue
    a.visitCd = t + rand(70, 140)
    const team = agents.filter((m) => m.reportsTo === ag.id && m.status === 'running')
    if (!team.length) continue
    a.cmd = { kind: 'visit', target: team[Math.floor(Math.random() * team.length)].id }
  }
}

/** Phản ứng khi trạng thái agent vừa đổi: biểu tượng, dáng, câu nói. */
export function reactToStatus(agent: Agent, prev: string, prevTask: string | undefined) {
  const a = actors.get(agent.id)
  if (!a) return
  const t = clock.t
  switch (agent.status) {
    case 'running':
      emote(a.id, '💡', 3)
      break
    case 'idle':
      if (prev === 'running') {
        emote(a.id, '🎉', 4)
        a.gesture = 'cheer'
        a.gestureUntil = t + 2.6
        a.mood = 'happy'
        a.moodUntil = t + 4
      } else if (prev === 'paused') emote(a.id, '🙌', 2.5)
      break
    case 'error':
      emote(a.id, '😱', 2.5)
      a.mood = 'shock'
      a.moodUntil = t + 3
      break
    case 'paused':
      emote(a.id, '😴', 2.5)
      break
  }
  const line = onStatus(agent, prev, prevTask)
  if (line) say(a.id, line.text, { real: line.real })
  a.nextMuse = Math.max(a.nextMuse, t + 15)
}

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

/** Agent vừa gửi phiếu duyệt / câu hỏi cho bạn: gọi một câu (dáng giơ tay do AgentActor lo). */
export function raiseHand(agentId: string, kind: AskKind) {
  const a = actors.get(agentId)
  if (!a) return
  emote(a.id, '🙋', 3)
  say(a.id, pick(kind === 'approval' ? ASK_APPROVAL : ASK_QUESTION))
  a.nextMuse = Math.max(a.nextMuse, clock.t + 15)
}

/** Bạn vừa xử lý xong việc agent chờ: vui khi được duyệt, xụ mặt khi bị từ chối. */
export function askAnswered(agentId: string, good: boolean) {
  const a = actors.get(agentId)
  if (!a) return
  const t = clock.t
  if (good) {
    emote(a.id, '🙏', 3)
    a.gesture = 'cheer'
    a.gestureUntil = t + 2.2
    a.mood = 'happy'
    a.moodUntil = t + 4
  } else {
    emote(a.id, '😅', 3)
  }
  say(a.id, pick(good ? ASK_THANKS : ASK_DENIED))
  a.nextMuse = Math.max(a.nextMuse, t + 15)
}

/** Ăn mừng: giơ tay, mặt vui */
function celebrate(a: LifeActor, icon: string | null, sec: number) {
  const t = clock.t
  if (icon) emote(a.id, icon, sec)
  a.gesture = 'cheer'
  a.gestureUntil = t + sec - 0.4
  a.mood = 'happy'
  a.moodUntil = t + sec + 1
  a.nextMuse = Math.max(a.nextMuse, t + 15)
}

/** Agent vừa lên cấp */
export function leveledUp(agentId: string, level: number) {
  const a = actors.get(agentId)
  if (!a) return
  // Không kèm emote ⭐: lúc lên cấp đầu agent đã có chữ "LÊN CẤP!" (emote bị ẩn đúng lúc đó nên chẳng bao giờ thấy)
  celebrate(a, null, 3.2)
  say(a.id, pick(LEVEL_UP(level, titleOf(level))))
}

/** Bạn vừa mở một phòng: vài agent mừng rỡ, rủ nhau sang xem */
export function roomOpened(room: Room) {
  const list = [...actors.values()].sort(() => Math.random() - 0.5)
  list.slice(0, 4).forEach((a, i) => {
    if (a.where !== 'seat') celebrate(a, '🎉', 2.6)
    else emote(a.id, '🎉', 2.4)
    if (i < 2) say(a.id, pick(ROOM_OPENED).replace('{x}', room.name.toLowerCase()))
  })
}

/** Bạn vừa mua món mới ở quanh (x, z): agent đứng gần quay ra khen */
export function decorated(name: string, x: number, z: number) {
  const list = [...actors.values()].filter((a) => Math.hypot(a.x - x, a.z - z) < 4.5).sort(() => Math.random() - 0.5)
  list.slice(0, 2).forEach((a, i) => {
    emote(a.id, '😍', 2.4)
    if (i === 0) say(a.id, pick(BOUGHT).replace('{x}', name))
  })
}

/** Bạn vừa mua đồ để bàn cho agent: agent mừng rỡ, cảm ơn */
export function deskGift(agentId: string, name: string) {
  const a = actors.get(agentId)
  if (!a) return
  if (a.where !== 'seat') celebrate(a, '🎁', 2.8)
  else emote(a.id, '🥹', 2.8)
  say(a.id, pick(GIFT).replace('{x}', name))
}

/** Agent vừa tới một chỗ: thỉnh thoảng hiện biểu tượng việc đang làm (☕, ⚽...). */
export function onArrive(a: LifeActor) {
  const act = actOf(a)
  if (act && Math.random() < 0.6) emote(a.id, ACT_EMOTE[act], 3)
}

/** Agent đang đi bị bạn chắn đường quá lâu. */
export function excuse(a: LifeActor) {
  if (clock.t < a.excuseAt) return
  a.excuseAt = clock.t + 25
  say(a.id, EXCUSE[Math.floor(Math.random() * EXCUSE.length)])
}
