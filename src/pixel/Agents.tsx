import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { titleOf, useExp, useLevel } from '../data/exp'
import { useOffice } from '../data/officeSync'
import { leadIdsOf } from '../data/hire'
import { STATUS_COLOR, STATUS_LABEL, type Agent, type AgentStatus } from '../data/types'
import { actorFor, placeActor, dropActor, stepActor, type Asking, type Body } from '../life/brain'
import type { LifeActor } from '../life/actors'
import { lifeTick, reactToStatus } from '../life/director'
import { spotById } from '../life/spots'
import { clock, useLife } from '../life/store'
import { agentPos, lobbyPos, player } from '../runtime'
import { useCoop } from '../store'
import { LOBBY, type DeskSlot, type World } from '../world/layout'
import { sprite, type SpriteName } from './assets'
import { charSheet, frameAt, partsKey, type Anim, type CharSheet, type Parts } from './chars'
import { dirOf, px, py, type Dir } from './geom'
import { useParts } from './look'
import { PixelLevelFx, hushedBy } from './LevelFx'
import { PixelSound } from './Sound'
import { stage, ticks, toScreen, type Tick } from './stage'
import { hits, makeOutline, personHit, setOutline } from './pick'

/**
 * Ngồi ghế quay mặt xuống (về phía camera): dùng khung đứng, hạ người xuống để mép bàn che phần chân.
 * Quay lưng lại: nâng người lên một chút để đầu + vai nhô khỏi lưng ghế (hình người chỉ cao ~24 trong khung 32).
 */
export const SIT_DROP = 11
export const SIT_BACK_DROP = -7
/** Ngồi nghiêng (ghế ăn, ghế đẩu): khung ngồi có sẵn của LimeZu */
export const SIT_SIDE_DROP = 1
/** Nằm giường: chỗ nằm ở giữa ô gối, đầu (hàng 4–19 của khung) hạ xuống cho nằm trên gối, chăn che cằm */
const LIE_DROP = 17
/** Đỉnh đầu cách chân bao nhiêu pixel (khung 32, người cao ~24) */
const HEAD = 24
/** Ứng viên quay sang nhìn khi bạn lại gần */
const LOOK_DIST = 3.2

/** Biểu cảm tạm thời (emoji từ director) có bong bóng pixel tương ứng trong bộ UI của LimeZu */
const EMOTE_SPRITE: Record<string, SpriteName> = {
  '🎉': 'emStar', '🏆': 'emStar', '😱': 'emWarn', '😴': 'emSleep', '🙋': 'emAskGold', '🙏': 'emHeart', '🙌': 'emHeart',
  '💧': 'emDrop', '😅': 'emDrop', '📺': 'emScreen', '🏓': 'emMusic', '🌤️': 'emSun', '😌': 'emNotes', '👋': 'emHeart',
}

interface Framing {
  anim: Anim
  dir: Dir
  i: number
  /** Hạ người xuống bao nhiêu pixel so với chân */
  dy: number
  /** Ngồi quay lưng về camera (đầu nhô khỏi lưng ghế) */
  back?: boolean
  /** Nằm giường: xếp lớp trên giường, dưới chăn */
  lie?: boolean
}

/** Chọn động tác + khung hình theo dáng mà "bộ não" quyết định */
function framing(a: LifeActor, b: Body, t: number): Framing {
  const dir = dirOf(a.yaw)
  const ph = a.phase
  if (b.mode === 'walk') return { anim: 'walk', dir, i: frameAt('walk', t, ph), dy: 0 }
  if (b.lie) return { anim: 'sleep', dir: 'down', i: frameAt('sleep', t, ph), dy: LIE_DROP, lie: true }
  if (b.seat) {
    if (dir === 'left' || dir === 'right') return { anim: 'sit', dir, i: frameAt('sit', t, ph), dy: SIT_SIDE_DROP }
    // Đang ngủ gật (tạm dừng) thì đứng yên một khung
    const i = b.mode === 'sleep' ? 0 : frameAt('idle', t, ph)
    return { anim: 'idle', dir, i, dy: dir === 'up' ? SIT_BACK_DROP : SIT_DROP, back: dir === 'up' }
  }
  if (b.mode === 'read' || b.mode === 'cv') return { anim: 'read', dir: 'down', i: frameAt('read', t, ph), dy: 0 }
  if (b.mode === 'play') return { anim: 'idle', dir, i: frameAt('idle', t * 2.2, ph), dy: 0 }
  // Chờ tới lượt (bi-a, bóng bàn): đứng yên nhìn bàn, không lướt điện thoại
  const act = a.where === 'spot' ? spotById(a.spot)?.act : undefined
  if (b.mode === 'stand' && (act === 'pool' || act === 'foos')) return { anim: 'idle', dir, i: 0, dy: 0 }
  // Đứng một chỗ lâu: thỉnh thoảng lướt điện thoại
  if (b.mode === 'stand' && a.where === 'spot' && Math.sin(t * 0.13 + ph) > 0.45) {
    return { anim: 'phone', dir: 'down', i: frameAt('phone', t, ph), dy: 0 }
  }
  return { anim: 'idle', dir, i: frameAt('idle', t, ph), dy: 0 }
}

/** Sheet nhân vật đã ghép, nạp lại khi đổi bộ phận (tủ đồ) */
function useSheet(parts: Parts) {
  const ref = useRef<CharSheet | null>(null)
  const key = partsKey(parts)
  useEffect(() => {
    let live = true
    charSheet(parts).then((s) => { if (live) ref.current = s })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return ref
}

function useAsking(id: string): Asking {
  return useCoop((s): Asking => {
    const mine = s.asks.filter((a) => a.agentId === id)
    return !mine.length ? null : mine.some((a) => a.kind === 'approval') ? 'approval' : 'question'
  })
}

/** Dựng sprite người + bóng + bong bóng biểu cảm + mũi tên đánh dấu, gỡ khi rời đi */
function makeBody() {
  // Sân khấu đang dựng lại (vd nạp lại nóng khi dev): bỏ qua, lượt sau dựng
  if (!stage.sorted || !stage.fx) return null
  const body = new Container()
  const shadow = new Graphics().ellipse(0, 0, 5, 2).fill({ color: 0x000000, alpha: 0.22 })
  const man = new Sprite(Texture.EMPTY)
  man.anchor.set(0.5, 1)
  // Viền sáng mờ quanh người ngồi quay lưng (tóc tối không chìm vào lưng ghế đen)
  const rim = new Container()
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) {
    const r = new Sprite(Texture.EMPTY)
    r.anchor.set(0.5, 1)
    r.position.set(ox, oy)
    r.alpha = 0.5
    rim.addChild(r)
  }
  rim.visible = false
  // Viền sáng khi rê chuột lên (bấm để mở CLI / hồ sơ)
  const hl = makeOutline()
  body.addChild(shadow, rim, hl, man)
  const bubble = new Sprite(Texture.EMPTY)
  bubble.anchor.set(0.5, 1)
  const arrow = new Sprite(sprite('arrowDown'))
  arrow.anchor.set(0.5, 1)
  arrow.visible = false
  stage.sorted!.addChild(body)
  stage.fx!.addChild(bubble, arrow)
  return {
    body, shadow, man, rim, hl, bubble, arrow,
    destroy() {
      body.destroy({ children: true })
      bubble.destroy()
      arrow.destroy()
    },
  }
}


/** Lớp DOM mới tạo nằm ngoài màn hình cho tới khung hình đầu tiên đặt đúng chỗ */
const OFFSCREEN = { transform: 'translate(-9999px, -9999px)' }

/**
 * Vị trí lời nói của từng người trong khung hình này. Sau khi mọi người đã cập nhật, layoutSpeech() đẩy các bong bóng
 * chồng nhau lên trên, để hai người đứng cạnh nhau cùng nói vẫn đọc được.
 */
const heads = new Map<string, { el: HTMLDivElement; x: number; y: number; w: number; h: number }>()
let measureAt = 0

function layoutSpeech(t: number) {
  // Đo kích thước bong bóng ~4 lần mỗi giây (đọc layout mỗi khung hình thì chậm)
  const measure = t > measureAt
  if (measure) measureAt = t + 0.25
  const list = [...heads.values()]
  for (const it of list) {
    if (measure) {
      const say = it.el.querySelector<HTMLElement>('.px-over')
      it.w = say?.offsetWidth ?? 0
      it.h = say?.offsetHeight ?? 0
    }
  }
  // Người ở thấp (gần camera) giữ chỗ trước, người phía trên bị đẩy lên khi chồng nhau
  list.sort((a, b) => b.y - a.y)
  const placed: { l: number; r: number; t: number; b: number }[] = []
  const W = stage.overlay?.clientWidth ?? 9999
  for (const it of list) {
    let y = it.y
    // Giữ bong bóng trong màn hình (cách mép 8 px); đường nối vẫn chỉ về đúng người nói
    const x = it.w > 0 ? Math.min(W - it.w / 2 - 8, Math.max(it.w / 2 + 8, it.x)) : it.x
    if (it.h > 0) {
      const l = x - it.w / 2, r = x + it.w / 2
      for (let pass = 0; pass < 4; pass++) {
        const hit = placed.find((p) => l < p.r && r > p.l && y - it.h < p.b && y > p.t)
        if (!hit) break
        y = hit.t - 2
      }
      placed.push({ l, r, t: y - it.h, b: y })
    }
    it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    // Bị đẩy lên / dời ngang: hiện tên người nói + đường nối xuống đầu họ
    const lead = Math.round(it.y - y)
    const shift = Math.round(it.x - x)
    const pushed = lead > 2 || Math.abs(shift) > 2
    if (it.el.classList.contains('pushed') !== pushed) it.el.classList.toggle('pushed', pushed)
    if (pushed) {
      it.el.style.setProperty('--lead', `${lead}px`)
      it.el.style.setProperty('--shift', `${shift}px`)
    }
  }
}

/** Đặt lớp DOM: lời nói phía trên đầu (trên bong bóng biểu cảm nếu có), bảng tên dưới chân */
function placeDom(id: string, head: HTMLDivElement | null, feet: HTMLDivElement | null, x: number, top: number, foot: number) {
  if (head) {
    const p = toScreen(x, top)
    const h = heads.get(id)
    if (h && h.el === head) { h.x = p.x; h.y = p.y }
    else heads.set(id, { el: head, x: p.x, y: p.y, w: 0, h: 0 })
  }
  if (feet) {
    const p = toScreen(x, foot)
    const f = plates.get(id)
    if (f && f.el === feet) { f.x = p.x; f.y = p.y }
    else plates.set(id, { el: feet, x: p.x, y: p.y, w: 0, h: 0, big: false })
  }
}

/** Bảng tên dưới chân của từng người; layoutPlates() xếp lại cho các bảng bé không đè lên nhau */
const plates = new Map<string, { el: HTMLDivElement; x: number; y: number; w: number; h: number; big: boolean }>()
let plateMeasureAt = 0

function layoutPlates(t: number) {
  const measure = t > plateMeasureAt
  if (measure) plateMeasureAt = t + 0.25
  const list = [...plates.values()]
  if (measure) {
    for (const it of list) {
      const pl = it.el.querySelector<HTMLElement>('.px-plate')
      it.w = pl?.offsetWidth ?? 0
      it.h = pl?.offsetHeight ?? 0
      // Thẻ đầy đủ (đứng gần / rê chuột) nằm đè lên trên, không xếp cùng
      it.big = !!pl?.classList.contains('near')
    }
  }
  // Trên trước, trái trước: người sau bị lệch sang phải một chút (chồng ít) hoặc xuống dưới (chồng nhiều)
  list.sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: { l: number; r: number; t: number; b: number }[] = []
  for (const it of list) {
    let x = it.x, y = it.y
    if (!it.big && it.w > 0) {
      const beside = it.el.classList.contains('beside')
      const left = () => (beside ? x : x - it.w / 2)
      for (let pass = 0; pass < 6; pass++) {
        const l = left()
        const hit = placed.find((p) => l < p.r + 2 && l + it.w + 2 > p.l && y < p.b + 1 && y + it.h + 1 > p.t)
        if (!hit) break
        const ov = hit.r + 2 - l
        if (ov <= 14) x += ov
        else y = hit.b + 1
      }
      placed.push({ l: left(), r: left() + it.w, t: y, b: y + it.h })
    }
    it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }
}

/** Bong bóng thường trực: biểu cảm vừa có > đang chờ bạn > trạng thái > đang làm (dấu ba chấm, lúc có lúc không) */
function bubbleOf(id: string, st: AgentStatus, ask: Asking, t: number, phase: number): SpriteName | null {
  const em = useLife.getState().emotes[id]
  if (em && em.until > clock.t && !hushedBy(id)) return EMOTE_SPRITE[em.icon] ?? null
  if (ask) return ask === 'approval' ? 'emAskGold' : 'emAsk'
  if (st === 'paused') return 'emSleep'
  // Lỗi: nhấp nháy để dễ thấy
  if (st === 'error') return Math.floor(t * 2.5) % 2 ? 'emError' : null
  if (st === 'running' && ((t * 0.12 + phase) % 1) < 0.3) return `emDots${Math.floor(t * 6) % 8}` as SpriteName
  return null
}

/** Một agent pixel: bộ não ở life/brain, ở đây chỉ vẽ */
function PixelAgent({ agent, slot, isLead }: { agent: Agent; slot: DeskSlot; isLead: boolean }) {
  const parts = useParts(agent.id, agent.name, isLead)
  const sheet = useSheet(parts)
  const anchor = useRef<HTMLDivElement>(null)
  const feet = useRef<HTMLDivElement>(null)
  const actor = useRef<LifeActor>(null!)
  if (!actor.current) actor.current = actorFor(agent.id, slot)
  const status = useRef(agent.status)
  status.current = agent.status
  const asking = useAsking(agent.id)
  const askRef = useRef(asking)
  askRef.current = asking

  useEffect(() => placeActor(actor.current, slot), [slot])

  // Trạng thái đổi → biểu cảm, câu nói (bỏ qua lần đầu)
  const prev = useRef({ status: agent.status, task: agent.task })
  useEffect(() => {
    const p = prev.current
    if (p.status !== agent.status) reactToStatus(agent, p.status, p.task)
    prev.current = { status: agent.status, task: agent.task }
  }, [agent])

  useEffect(() => {
    const v = makeBody()
    if (!v) return
    const tick: Tick = (dt, t) => {
      const a = actor.current
      const b = stepActor(a, status.current, askRef.current, dt)
      const f = framing(a, b, t)
      const sh = sheet.current
      if (sh) v.man.texture = sh.frame(f.anim, f.dir, f.i)
      v.rim.visible = !!f.back && !!sh
      if (v.rim.visible) for (const r of v.rim.children as Sprite[]) r.texture = sh!.silhouette(f.anim, f.dir, f.i)
      const X = Math.round(px(a.x)), Y = Math.round(py(a.z))
      v.body.position.set(X, Y + f.dy)
      // Ngồi bàn: xếp đúng ở ghế để mép bàn / lưng ghế che phần dưới người.
      // Ngồi ghế đẩu / ghế ăn (nghiêng hoặc quay ra): người vẽ đè lên ghế. Sofa (quay lưng): lưng sofa che người.
      // Nằm giường: trên giường (xếp lớp ở mép dưới giường), dưới chăn (mép dưới + 3, catalogArt frontNode)
      v.body.zIndex = a.where === 'seat' ? Math.round(py(a.slot.seat.z)) : f.lie ? Y + 25 : b.seat && !f.back ? Y + 10 : Y
      v.shadow.visible = !b.seat
      v.shadow.position.set(0, -f.dy)
      personHit(a.id, X, Y + f.dy, HEAD, v.body.zIndex)
      setOutline(v.hl, stage.hover === a.id && sh ? sh.silhouette(f.anim, f.dir, f.i) : null)

      const top = Y + f.dy - HEAD
      const em = bubbleOf(a.id, status.current, askRef.current, t, a.phase)
      v.bubble.visible = !!em
      // Người ngồi bàn quay lưng: màn hình nằm ngay trên đầu, đặt bong bóng lệch sang phải cho khỏi che màn hình
      const side = f.back && a.where === 'seat'
      if (em) {
        v.bubble.texture = sprite(em)
        v.bubble.position.set(side ? X + 16 : X, side ? top + 6 : top + 1)
      }
      const ping = useCoop.getState().ping
      const pinged = ping?.id === a.id && performance.now() - ping.at < 6000
      v.arrow.visible = pinged
      if (pinged) v.arrow.position.set(X, top - (em ? 19 : 2) - Math.round(Math.abs(Math.sin(t * 6)) * 4))

      // Ngồi bàn quay mặt ra: dưới chân là mặt bàn + màn hình hàng dưới, đặt bảng tên cạnh người
      const beside = a.where === 'seat' && f.dir === 'down'
      placeDom(a.id, anchor.current, feet.current, beside ? X + 10 : X, em && !side ? top - 17 : top, beside ? top + 4 : Y + f.dy + 1)
      const fe0 = feet.current
      if (fe0 && fe0.classList.contains('beside') !== beside) fe0.classList.toggle('beside', beside)
      const fe = feet.current
      const hov = stage.hover === a.id
      if (fe && fe.classList.contains('hover') !== hov) fe.classList.toggle('hover', hov)
    }
    ticks.add(tick)
    return () => {
      ticks.delete(tick)
      heads.delete(agent.id)
      plates.delete(agent.id)
      hits.delete(agent.id)
      v.destroy()
      dropActor(agent.id)
    }
  }, [agent.id])

  if (!stage.overlay) return null
  return createPortal(
    <>
      <div className="px-anchor" style={OFFSCREEN} ref={anchor}><Overhead agent={agent} /></div>
      <div className="px-anchor" style={OFFSCREEN} ref={feet}><Plate agent={agent} asking={asking} isLead={isLead} /></div>
    </>,
    stage.overlay,
  )
}

/** Bỏ emoji màu trong câu nói (đã có bong bóng biểu cảm pixel) */
const plain = (text: string) => text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim()

/** Trên đầu agent: câu đang nói, emoji tạm thời không có hình pixel, lên cấp, +EXP */
function Overhead({ agent }: { agent: Agent }) {
  const bubble = useLife((s) => s.bubbles[agent.id])
  const em = useLife((s) => s.emotes[agent.id])
  const emoji = em && !EMOTE_SPRITE[em.icon] ? em : null
  const pop = useExp((s) => s.pops[agent.id])
  const ups = useExp((s) => s.levelUps)
  const up = ups.find((u) => u.agentId === agent.id)
  // Lúc lên cấp (của mình hoặc người sát bên): im lặng cho hiệu ứng nổi bật; câu nói vẫn còn thì hiện lại sau
  const hush = hushedBy(agent.id, ups)
  const fresh = pop && Date.now() - pop.at < 2500
  const xu = useOffice((s) => s.pops[agent.id])
  const xuFresh = xu && Date.now() - xu.at < 2500
  return (
    <div className="px-over">
      {/* Key có tiền tố: id câu nói / emote (life/store) và id lên cấp / EXP (data/exp) đến từ các bộ đếm khác nhau, có thể trùng số */}
      {bubble && !hush && <div key={`say${bubble.id}`} className={`px-say${bubble.real ? ' real' : ''}`} data-who={agent.name}>{plain(bubble.text)}</div>}
      {emoji && !hush && <div key={`emo${emoji.id}`} className="px-emoji">{emoji.icon}</div>}
      {up && <div key={`up${up.id}`} className="px-lvup">LÊN CẤP {up.level}!</div>}
      {fresh && <div key={`xp${pop.id}`} className="px-xp">+{pop.amount} EXP</div>}
      {xuFresh && <div key={`xu${xu.id}`} className="px-xp px-xu">+{xu.amount} Xu</div>}
    </div>
  )
}

/** Bảng tên dưới chân. Dòng phụ (danh hiệu, việc đang làm) chỉ hiện khi bạn đứng gần: chờ bạn thì đã có bong bóng "?". */
function Plate({ agent, asking, isLead }: { agent: Agent; asking: Asking; isLead: boolean }) {
  const near = useCoop((s) => s.nearId === agent.id)
  const hover = useCoop((s) => s.hoverId === agent.id)
  const lv = useLevel(agent.id)
  const sub = near || hover
  return (
    <div className="px-under">
      <div className={`px-plate${sub ? ' near' : ''}${lv >= 9 ? ' gold' : ''}`} style={{ borderLeftColor: STATUS_COLOR[agent.status] }}>
        <div className="px-plate-row">
          {!sub && <span className="px-dot" style={{ background: STATUS_COLOR[agent.status] }} />}
          {isLead && <span className="px-lead" title="Lead">★</span>}
          {sub && <span className="px-lv">Lv{lv}</span>}
          <span className="px-name">{agent.name}</span>
        </div>
        {sub && (
          <>
            <div className="px-rank">{titleOf(lv)}</div>
            <div className={`px-sub${asking ? ' ask' : ''}`}>
              {asking === 'approval' ? 'Chờ bạn duyệt' : asking ? 'Chờ bạn trả lời' : agent.status === 'running' && agent.task ? agent.task : STATUS_LABEL[agent.status]}
            </div>
            {hover && <div className="px-hint">{agent.status === 'terminated' ? 'Đã nghỉ việc' : 'Bấm chuột: mở CLI'}</div>}
          </>
        )}
      </div>
    </div>
  )
}

/** Ứng viên chờ duyệt thuê: đứng ở sảnh cầm hồ sơ, bạn lại gần thì quay sang nhìn. Không đi lại. */
function PixelCandidate({ agent, spot }: { agent: Agent; spot: (typeof LOBBY)[number] }) {
  const parts = useParts(agent.id, agent.name, false)
  const sheet = useSheet(parts)
  const feet = useRef<HTMLDivElement>(null)
  const hasAsk = useCoop((s) => s.asks.some((a) => a.candidateId === agent.id))
  const askRef = useRef(hasAsk)
  askRef.current = hasAsk

  useEffect(() => {
    const v = makeBody()
    if (!v) return
    agentPos.set(agent.id, { x: spot.x, z: spot.z })
    lobbyPos.set(agent.id, { x: spot.x, z: spot.z })
    const phase = Math.random() * 10
    const tick: Tick = (_dt, t) => {
      const pd = Math.hypot(player.x - spot.x, player.z - spot.z)
      const sh = sheet.current
      const fr: [Anim, Dir, number] = pd < LOOK_DIST
        ? ['idle', dirOf(Math.atan2(player.x - spot.x, player.z - spot.z)), frameAt('idle', t, phase)]
        : ['read', 'down', frameAt('read', t, phase)]
      if (sh) v.man.texture = sh.frame(...fr)
      const X = Math.round(px(spot.x)), Y = Math.round(py(spot.z))
      v.body.position.set(X, Y)
      v.body.zIndex = Y
      personHit(agent.id, X, Y, HEAD, Y)
      setOutline(v.hl, stage.hover === agent.id && sh ? sh.silhouette(...fr) : null)
      v.bubble.visible = askRef.current
      if (askRef.current) {
        // Ứng viên: phong bì hồ sơ (khác dấu "?" của agent đang chờ bạn)
        v.bubble.texture = sprite('emMail')
        v.bubble.position.set(X, Y - HEAD + 1)
      }
      placeDom(agent.id, null, feet.current, X, 0, Y + 1)
      const fe = feet.current
      const hov = stage.hover === agent.id
      if (fe && fe.classList.contains('hover') !== hov) fe.classList.toggle('hover', hov)
    }
    ticks.add(tick)
    return () => {
      ticks.delete(tick)
      hits.delete(agent.id)
      v.destroy()
      agentPos.delete(agent.id)
      plates.delete(agent.id)
    }
  }, [agent.id, spot])

  const near = useCoop((s) => s.nearId === agent.id)
  const hover = useCoop((s) => s.hoverId === agent.id)
  const boss = useCoop((s) => s.agents.find((a) => a.id === agent.reportsTo)?.name)
  if (!stage.overlay) return null
  return createPortal(
    <div className="px-anchor" style={OFFSCREEN} ref={feet}>
      <div className="px-under">
        <div className={`px-plate cand${near || hover ? ' near' : ''}`}>
          <div className="px-plate-row"><span className="px-name">{agent.name}</span></div>
          {(near || hover) && <div className="px-sub ask">Ứng viên{boss ? ` · ${boss}` : ''}</div>}
          {hover && <div className="px-hint">Bấm chuột: xem hồ sơ</div>}
        </div>
      </div>
    </div>,
    stage.overlay,
  )
}

/** Toàn bộ người trong văn phòng pixel + đạo diễn đời sống văn phòng */
export function PixelAgents({ world }: { world: World }) {
  const agents = useCoop((s) => s.agents)
  const [, force] = useState(0)

  useEffect(() => {
    const f: Tick = (dt) => lifeTick(Math.min(dt, 0.1))
    // Chạy sau khi mọi người đã cập nhật vị trí (effect của con chạy trước cha nên tick này nằm sau)
    const lay: Tick = (_dt, t) => { layoutSpeech(t); layoutPlates(t) }
    ticks.add(f)
    ticks.add(lay)
    // Lớp phủ DOM có sau lượt render đầu: vẽ lại một lần để bảng tên gắn vào
    if (stage.overlay) force((n) => n + 1)
    return () => { ticks.delete(f); ticks.delete(lay) }
  }, [])

  const leadIds = useMemo(() => leadIdsOf(agents), [agents])
  // Ứng viên chờ duyệt thuê: đứng ở sảnh (tối đa số chỗ ở sảnh, còn lại xem trong danh sách Q)
  const candidates = agents.filter((a) => a.candidate && a.status !== 'terminated').slice(0, LOBBY.length)
  return (
    <>
      {agents
        .filter((a) => a.status !== 'terminated' && world.seatOf.has(a.id))
        .map((a) => <PixelAgent key={a.id} agent={a} slot={world.seatOf.get(a.id)!} isLead={leadIds.has(a.id)} />)}
      {candidates.map((a, i) => <PixelCandidate key={a.id} agent={a} spot={LOBBY[i]} />)}
      <PixelLevelFx />
      <PixelSound />
    </>
  )
}
