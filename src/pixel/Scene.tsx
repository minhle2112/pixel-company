import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Application, Container, Graphics, Sprite } from 'pixi.js'
import { ranking, useExp } from '../data/exp'
import { COLUMNS, groupIssues } from '../data/kanban'
import { useOffice } from '../data/officeSync'
import type { AgentStatus } from '../data/types'
import { agentPos, input, player } from '../runtime'
import { useCoop } from '../store'
import { BOARD, resolveCircle, type World } from '../world/layout'
import { assetsReady, loadSheets } from './assets'
import { PLAYER_ID } from '../characters/look'
import { charSheet, frameAt, type CharSheet } from './chars'
import { RoomOverlay, lockedAt, roomHover } from './RoomMode'
import { DecoOverlay, decoClick, decoCtx, decoLeave, decoMove } from './Decorate'
import { useDeco } from '../ui/decoStore'
import { nearestUse, using } from '../life/playerUse'
import { spotById } from '../life/spots'
import { SIT_BACK_DROP, SIT_DROP, SIT_SIDE_DROP } from './Agents'
import { partsOf, usePixelLooks } from './look'
import { stage, ticks, toScreen } from './stage'
import { hits, makeOutline, personHit, pickAt, setOutline } from './pick'
import { MAP_H, MAP_W, dirOf, px, py, wx, type Dir } from './geom'
import { buildOffice, drawFame, drawKanban, type OfficeView } from './office'
import { updateWalls } from './walls'
import { installDevHooks } from './devhooks'
import { Lighting } from './light'
import { view } from './view'
import { useSettings } from '../settings'
import { desktop } from '../desktop'

const RADIUS = 0.28
const AGENT_RADIUS = 0.28
const WALK = 2.8
const RUN = 4.8
const INTERACT_DIST = 1.7
/** Đứng cách bảng treo tường bao xa thì bấm E được */
const BOARD_DIST = 2.1
/** Pixel gốc theo chiều dọc màn hình ở mức phóng to mặc định (~21 ô) */
const VIEW_PX = 336
/** Chiều cao hình người (pixel gốc) để tính vùng bấm của bạn */
const HEAD = 24
const HL = 0xffe27a
/** Bề rộng bảng cửa hàng bên trái kể cả lề (pixel CSS) */
const DECO_PANEL = 350

/** Thứ bấm chuột được mà không phải người khác: bạn (tủ đồ) và bảng ticket trên tường */
const TIPS: Record<string, { name: string; hint: string }> = {
  player: { name: 'Bạn', hint: 'Bấm chuột: tủ đồ' },
  '#board': { name: 'Bảng ticket', hint: 'Bấm chuột: xem bảng' },
  '#fame': { name: 'Bảng vinh danh', hint: 'Bấm chuột: xem xếp hạng' },
}

/** Bấm chuột vào một thứ trên bản đồ: làm đúng việc phím E làm khi đứng gần, không cần đi tới */
function activate(id: string) {
  const s = useCoop.getState()
  if (id === '#board') s.openBoard()
  else if (id === '#fame') s.openFame()
  else if (id === 'player') s.openWardrobe('player')
  else s.openAgent(id)
}

/** Đang mở CLI / bảng / tủ đồ / phiếu duyệt: bản đồ phía sau không nhận chuột */
function busy() {
  const s = useCoop.getState()
  return !!(s.focusId || s.boardOpen || s.fameOpen || s.wardrobeId || s.askId)
}

/** Khoảng cách tới mặt bảng treo tường bắc (chỉ tính khi đứng phía trước, tức phía nam bảng) */
function wallDist(b: { x: number; z: number; w: number }) {
  const bx = Math.max(b.x - b.w / 2, Math.min(player.x, b.x + b.w / 2))
  return player.z > b.z ? Math.hypot(player.x - bx, player.z - b.z) : Infinity
}

type Phase = 'loading' | 'missing' | 'ready' | 'error'

/** Màu dấu của từng agent trên bảng vinh danh (cố định theo id) */
const FAME_COLORS = [0x6c8ed8, 0x3ccf6e, 0xe0784f, 0xc77dd8, 0x4fc2c9, 0xe8c547]
const hashOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)

/**
 * Văn phòng pixel (PixiJS): sàn, tường, đồ đạc, bàn làm việc, bạn đi lại bằng WASD.
 * Phóng to theo bội số nguyên của pixel màn hình thật để hình luôn sắc nét.
 */
export function PixelScene({ world, statusOfSlot, children }: {
  world: World
  statusOfSlot: Map<string, AgentStatus>
  /** Người trong văn phòng: chỉ dựng khi sân khấu đã sẵn sàng */
  children?: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  /** Sheet nhân vật của bạn, đổi khi chỉnh trong tủ đồ */
  const playerSheet = useRef<CharSheet | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [err, setErr] = useState('')
  const appRef = useRef<Application | null>(null)
  const layers = useRef<{ root: Container; floor: Container; sorted: Container; top: Container } | null>(null)
  const office = useRef<OfficeView | null>(null)
  const light = useRef<Lighting | null>(null)
  const statusRef = useRef(statusOfSlot)
  statusRef.current = statusOfSlot
  const worldRef = useRef(world)
  worldRef.current = world

  // ── Khởi tạo Pixi, nạp hình, vòng lặp khung hình ──
  useEffect(() => {
    let dead = false
    const app = new Application()
    let playerSprite: Sprite | null = null
    let facing: Dir = 'up'
    let lastNear: string | null = null
    let t = 0
    let screenAcc = 0
    let camShift = 0

    ;(async () => {
      if (!(await assetsReady())) {
        if (!dead) setPhase('missing')
        return
      }
      const el = host.current!
      await app.init({
        resizeTo: el,
        background: 0x1c1a26,
        antialias: false,
        roundPixels: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      if (dead) {
        app.destroy(true)
        return
      }
      el.appendChild(app.canvas)
      app.canvas.style.imageRendering = 'pixelated'
      // Chuột trên bản đồ: rê lên người / bảng thì hiện thẻ + viền sáng (tính mỗi khung hình, vì người đi lại dưới chuột),
      // bấm thì mở CLI / hồ sơ / bảng / tủ đồ ngay, không phải đi tới
      const mouse = { x: 0, y: 0, in: false }
      /** Toạ độ chuột → pixel gốc của bản đồ */
      const mapAt = (cx: number, cy: number) => {
        const r = stage.root
        if (!r || busy()) return null
        const rect = app.canvas.getBoundingClientRect()
        return { x: (cx - rect.left - r.position.x) / r.scale.x, y: (cy - rect.top - r.position.y) / r.scale.y }
      }
      const pickClient = (cx: number, cy: number) => {
        // Đang trang trí: bấm chuột để chọn / đặt đồ, không mở người hay bảng
        if (useDeco.getState().open) return null
        const p = mapAt(cx, cy)
        return p ? pickAt(p.x, p.y) : null
      }
      /** Phòng khoá dưới chuột (không tính lúc đang trang trí) */
      const roomClient = (cx: number, cy: number) => {
        const p = useDeco.getState().open ? null : mapAt(cx, cy)
        return p ? lockedAt(p.x, p.y) ?? null : null
      }
      app.canvas.addEventListener('pointermove', (e) => {
        mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true
        const p = useDeco.getState().open ? mapAt(e.clientX, e.clientY) : null
        if (p) decoMove(p.x, p.y)
      })
      app.canvas.addEventListener('pointerleave', () => { mouse.in = false; decoLeave() })
      app.canvas.addEventListener('click', (e) => {
        if (e.button !== 0) return
        if (useDeco.getState().open) {
          const p = mapAt(e.clientX, e.clientY)
          if (p) decoClick(p.x, p.y)
          return
        }
        const id = pickClient(e.clientX, e.clientY)
        if (id) return activate(id)
        // Phòng khoá: mở bảng Mở phòng, chọn sẵn phòng đó
        const room = roomClient(e.clientX, e.clientY)
        if (room) useCoop.getState().showRoom(room.id)
      })
      await loadSheets()
      playerSheet.current = await charSheet(partsOf(PLAYER_ID, 'Bạn', false))
      if (dead) return

      const root = new Container()
      const floor = new Container()
      const sorted = new Container()
      sorted.sortableChildren = true
      const top = new Container()
      // Ngày/đêm phủ lên tất cả; bong bóng, hiệu ứng lên cấp (fx) nằm trên cùng để luôn rõ
      const fx = new Container()
      const lighting = new Lighting()
      light.current = lighting
      root.addChild(floor, sorted, top, lighting.shade, lighting.glow, fx)
      app.stage.addChild(root)
      layers.current = { root, floor, sorted, top }
      appRef.current = app
      Object.assign(stage, { app, root, sorted, top, fx, overlay: overlay.current })

      playerSprite = new Sprite(playerSheet.current.frame('idle', 'up', 0))
      playerSprite.anchor.set(0.5, 1)
      const playerHl = makeOutline()
      sorted.addChild(playerHl, playerSprite)
      // Viền sáng quanh bảng treo tường khi rê chuột lên (lớp fx: không bị ngày/đêm làm tối)
      const boardHl = new Graphics()
      fx.addChild(boardHl)
      view.x = px(player.x)
      view.y = py(player.z)

      app.ticker.add((tk) => {
        const dt = Math.min(tk.deltaMS / 1000, 0.05)
        t += dt
        const w = worldRef.current
        const k = input.keys

        // ── Di chuyển: W lên (bắc), S xuống, A trái, D phải ──
        let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
        let mz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0)
        const len = Math.hypot(mx, mz)
        const running = k.has('ShiftLeft') || k.has('ShiftRight')
        // Đang ngồi / dùng đồ: đi tiếp là đứng dậy; món bị dời / cất / bán thì cũng đứng dậy
        let usingSpot = using.spot ? spotById(using.spot) : undefined
        if (using.spot && (len > 0 || !usingSpot || useDeco.getState().open)) {
          useCoop.getState().leaveUse()
          usingSpot = undefined
        }
        if (usingSpot) {
          player.x = usingSpot.x
          player.z = usingSpot.z
          if (usingSpot.yaw !== undefined) facing = dirOf(usingSpot.yaw)
        } else {
          if (len > 0) {
            mx /= len
            mz /= len
            const sp = running ? RUN : WALK
            player.x += mx * sp * dt
            player.z += mz * sp * dt
            player.facing = Math.atan2(mx, mz)
            facing = dirOf(player.facing)
          }
          const p = { x: player.x, z: player.z }
          resolveCircle(p, RADIUS, w.colliders)
          for (const a of agentPos.values()) {
            const dx = p.x - a.x, dz = p.z - a.z
            const d = Math.hypot(dx, dz), min = RADIUS + AGENT_RADIUS
            if (d < min && d > 1e-5) { p.x = a.x + (dx / d) * min; p.z = a.z + (dz / d) * min }
          }
          resolveCircle(p, RADIUS, w.colliders)
          player.x = p.x
          player.z = p.z
        }

        const sheet = playerSheet.current
        if (playerSprite && sheet) {
          // Ngồi: như agent (quay ngang thì khung ngồi LimeZu, quay xuống / lên thì hạ / nâng người); dùng đồ đứng thì
          // chơi game / bi-a nhún nhanh, đọc sách thì khung đọc
          const sit = usingSpot?.sit !== undefined
          const side = facing === 'left' || facing === 'right'
          const act = usingSpot?.act
          const anim = len > 0 ? 'walk' : sit && side ? 'sit' : act === 'books' ? 'read' : 'idle'
          const dir = anim === 'read' ? 'down' : facing
          const quick = act === 'game' || act === 'pool' || act === 'foos' ? 2.2 : 1
          const fi = frameAt(anim, running && len > 0 ? t * 1.5 : t * quick)
          const dy = !sit ? 0 : side ? SIT_SIDE_DROP : facing === 'up' ? SIT_BACK_DROP : SIT_DROP
          playerSprite.texture = sheet.frame(anim, dir, fi)
          const X = Math.round(px(player.x)), Y = Math.round(py(player.z))
          playerSprite.position.set(X, Y + 2 + dy)
          // Ngồi quay mặt xuống: vẽ đè lên ghế / sofa (như agent)
          playerSprite.zIndex = sit && facing !== 'up' ? Y + 10 : Y
          personHit('player', X, Y + 2 + dy, HEAD, playerSprite.zIndex)
          playerHl.position.set(X, Y + 2 + dy)
          playerHl.zIndex = playerSprite.zIndex - 0.5
          setOutline(playerHl, stage.hover === 'player' ? sheet.silhouette(anim, dir, fi) : null)
        }

        // ── Camera: phóng to nguyên lần pixel màn hình thật, bám theo bạn, không ra ngoài bản đồ ──
        const res = app.renderer.resolution
        const sw = app.screen.width, sh = app.screen.height
        const auto = Math.max(2, Math.round((sh * res) / VIEW_PX))
        // Chỉ hai mức, chọn trong Cài đặt (không lăn chuột): xa = hai nấc dưới mức tự động, gần = một nấc.
        // Màn thấp (mức tự động 2) thì xa chạm đáy 1: gần giữ hơn xa một nấc để hai mức vẫn khác nhau
        const far = Math.max(1, auto - 2)
        const zDev = useSettings.getState().zoom === 'far' ? far : Math.max(far + 1, auto - 1)
        view.zoomBias = zDev - auto
        const z = zDev / res
        view.zoom = zDev
        // Dịch chuyển tức thời (dev / tìm agent): nhảy luôn, không trượt
        const ease = Number.isFinite(view.x) ? 1 - Math.exp(-8 * dt) : 1
        if (!Number.isFinite(view.x)) { view.x = px(player.x); view.y = py(player.z) - 12 }
        view.x += (px(player.x) - view.x) * ease
        view.y += (py(player.z) - 12 - view.y) * ease
        const halfW = sw / z / 2, halfH = sh / z / 2
        // Đang trang trí: bảng cửa hàng che bên trái, dời khung nhìn sang phải nửa bề rộng bảng (trượt mượt)
        camShift += ((useDeco.getState().open ? DECO_PANEL / 2 : 0) - camShift) * Math.min(1, dt * 8)
        const sh2 = camShift / z
        const cx = MAP_W <= halfW * 2 - 2 * sh2 ? MAP_W / 2 - sh2 : Math.min(MAP_W - halfW, Math.max(halfW - 2 * sh2, view.x - sh2))
        const cy = MAP_H <= halfH * 2 ? MAP_H / 2 : Math.min(MAP_H - halfH, Math.max(halfH, view.y))
        root.scale.set(z)
        root.position.set(Math.round((sw / 2 - cx * z) * res) / res, Math.round((sh / 2 - cy * z) * res) / res)

        // ── Người trong văn phòng (agent, ứng viên), đạo diễn đời sống ──
        for (const f of ticks) f(dt, t)
        lighting.update(t)
        // Tường cao mờ đi khi có người phía sau, cửa tự mở khi có người tới gần
        if (office.current) {
          const people = [{ x: px(player.x), y: py(player.z) }]
          for (const a of agentPos.values()) people.push({ x: px(a.x), y: py(a.z) })
          updateWalls(office.current.walls, people, dt)
        }

        // ── Chuột: thứ đang được rê lên (người, bạn, bảng) ──
        const hv = mouse.in ? pickClient(mouse.x, mouse.y) : null
        // Phòng khoá dưới chuột (khi không rê lên người / bảng)
        const room = mouse.in && !hv ? roomClient(mouse.x, mouse.y)?.id ?? null : null
        if (room !== roomHover.id) {
          roomHover.id = room
          app.canvas.style.cursor = hv || room ? 'pointer' : ''
        }
        if (hv !== stage.hover) {
          stage.hover = hv
          app.canvas.style.cursor = hv || room ? 'pointer' : ''
          useCoop.getState().setHover(hv)
          boardHl.clear()
          const b = hv?.startsWith('#') ? hits.get(hv) : undefined
          if (b) boardHl.rect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2).stroke({ color: HL, width: 1 })
        }
        const tipEl = tip.current
        const th = hv && TIPS[hv] ? hits.get(hv) : undefined
        if (tipEl) {
          const p = th ? toScreen((th.x0 + th.x1) / 2, th.y1 + 1) : { x: -9999, y: -9999 }
          tipEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
        }

        // ── Màn hình máy tính: vẽ lại ~8 lần mỗi giây ──
        screenAcc += dt
        if (screenAcc > 0.12 && office.current) {
          screenAcc = 0
          for (const s of office.current.screens) s.draw(statusRef.current.get(s.slotId) ?? null, t)
          lighting.setScreens((slot) => statusRef.current.get(slot) ?? null)
        }

        // ── Thứ gần nhất để bấm E: agent, bảng ticket ──
        let best: string | null = null
        let bd = INTERACT_DIST
        for (const [id, a] of agentPos) {
          const dd = Math.hypot(a.x - player.x, a.z - player.z)
          if (dd < bd) { bd = dd; best = id }
        }
        const boardD = wallDist(BOARD)
        const board = boardD < BOARD_DIST && (!best || boardD - 0.8 < bd)
        if (board) best = null
        // Bảng vinh danh (nếu đã mua, treo trên tường bắc)
        const fm = office.current?.fame
        const fameD = fm ? wallDist({ x: wx(fm.x), z: BOARD.z, w: 3 }) : Infinity
        const fame = !board && fameD < BOARD_DIST && (!best || fameD - 0.8 < bd)
        if (fame) best = null
        // Đồ dùng được (sofa, máy game...): gần hơn agent thì bấm E là dùng đồ
        const nu = !board && !fame && !using.spot && !useDeco.getState().open ? nearestUse() : null
        const use = nu && (!best || nu.d < bd) ? nu.spot.id : null
        if (use) best = null
        const key = board ? '#board' : fame ? '#fame' : use ? `#use:${use}` : best
        if (key !== lastNear) {
          lastNear = key
          useCoop.getState().setNear(best, board, fame, use)
        }
      })
      setPhase('ready')
    })().catch((e: unknown) => {
      if (dead) return
      setErr(e instanceof Error ? e.message : String(e))
      setPhase('error')
    })

    return () => {
      dead = true
      Object.assign(stage, { app: null, root: null, sorted: null, top: null, fx: null, overlay: null, hover: null })
      hits.delete('player')
      useCoop.getState().setHover(null)
      appRef.current = null
      layers.current = null
      office.current = null
      roomHover.id = null
      decoCtx.view = null
      light.current = null
      try { app.destroy(true, { children: true }) } catch { /* chưa init xong */ }
    }
  }, [])

  // ── Tủ đồ: đổi bộ đồ của bạn ──
  const playerLook = usePixelLooks((s) => s.custom[PLAYER_ID])
  useEffect(() => {
    if (phase !== 'ready') return
    let live = true
    charSheet(partsOf(PLAYER_ID, 'Bạn', false)).then((s) => { if (live) playerSheet.current = s })
    return () => { live = false }
  }, [phase, playerLook])

  // ── Dựng (lại) văn phòng khi sơ đồ chỗ ngồi đổi ──
  useEffect(() => {
    const L = layers.current
    if (phase !== 'ready' || !L) return
    const old = office.current
    if (old) {
      // Chỉ gỡ đồ của văn phòng cũ: người, bong bóng, mũi tên đánh dấu cũng nằm trong các lớp này
      for (const c of [old.floor, old.top, ...old.sorted]) { c.removeFromParent(); c.destroy({ children: true }) }
    }
    const v = buildOffice(world, useOffice.getState().office)
    L.floor.addChildAt(v.floor, 0)
    L.top.addChildAt(v.top, 0)
    for (const c of v.sorted) L.sorted.addChild(c)
    office.current = v
    light.current?.setOffice(v.lights, v)
    // Bảng treo tường bấm chuột được; người đứng trước bảng thì ưu tiên người
    const r = v.boards.kanban
    hits.set('#board', { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, z: -1e9 })
    if (v.fame) {
      const f = v.fame.rect
      hits.set('#fame', { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h, z: -1e9 })
    } else hits.delete('#fame')
    decoCtx.world = world
    decoCtx.view = v
    redrawBoards()
  }, [phase, world])

  // ── Bảng ticket, bảng vinh danh trên tường: vẽ lại khi dữ liệu đổi ──
  const issues = useCoop((s) => s.issues)
  const agentsNow = useCoop((s) => s.agents)
  const stats = useExp((s) => s.stats)
  function redrawBoards() {
    const v = office.current
    if (!v) return
    const g = groupIssues(useCoop.getState().issues)
    drawKanban(v.kanban, COLUMNS.map((c) => ({ color: c.color, n: g[c.id].length })))
    if (v.fame) {
      const top = ranking(useCoop.getState().agents, useExp.getState().stats, 'total').slice(0, 3)
      drawFame(v.fame.g, top.map((r) => ({ color: FAME_COLORS[hashOf(r.agent.id) % FAME_COLORS.length], exp: r.exp })))
    }
  }
  useEffect(redrawBoards, [issues, agentsNow, stats])

  // ── Công cụ cho dev ──
  useEffect(() => {
    if (!import.meta.env.DEV || phase !== 'ready') return
    const w = window as unknown as { __pixel?: unknown }
    w.__pixel = { app: appRef.current, view, layers: layers.current, office: () => office.current, light: light.current, player }
    return appRef.current ? installDevHooks(appRef.current) : undefined
  }, [phase])

  return (
    <div id="stage" ref={host} className="pixel-stage">
      <div ref={overlay} className="px-overlay">
        <HoverTip el={tip} />
      </div>
      {phase === 'ready' && children}
      {phase === 'ready' && <RoomOverlay />}
      {phase === 'ready' && <DecoOverlay />}
      {phase === 'missing' && <MissingAssets />}
      {phase === 'error' && (
        <div className="panel center-card">
          <div className="center-title">Không vẽ được văn phòng pixel</div>
          <p className="muted">{err}</p>
        </div>
      )}
    </div>
  )
}

/** Thẻ nhỏ khi rê chuột lên chính bạn hoặc bảng treo tường (người khác có bảng tên riêng) */
function HoverTip({ el }: { el: RefObject<HTMLDivElement | null> }) {
  const id = useCoop((s) => s.hoverId)
  const t = id ? TIPS[id] : undefined
  return (
    <div className="px-anchor px-tip" ref={el} style={{ transform: 'translate(-9999px, -9999px)' }}>
      {t && (
        <div className="px-under">
          <div className="px-plate near">
            <div className="px-plate-row"><span className="px-name">{t.name}</span></div>
            <div className="px-hint">{t.hint}</div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Máy này chưa có gói hình LimeZu */
function MissingAssets() {
  const [bad, setBad] = useState<string | null>(null)
  const d = desktop
  if (d) {
    const pick = async () => {
      const r = await d.pickAssets()
      if (r.ok) location.reload()
      else if (!r.canceled) setBad(r.picked ?? '')
    }
    return (
      <div className="panel center-card">
        <div className="center-title">Chưa có gói hình pixel</div>
        <p>
          Bản pixel vẽ bằng 2 gói của LimeZu: <b>Modern Interiors</b> (
          <a href="https://limezu.itch.io/moderninteriors" target="_blank" rel="noreferrer">limezu.itch.io/moderninteriors</a>) và{' '}
          <b>Modern Office</b> (
          <a href="https://limezu.itch.io/modernoffice" target="_blank" rel="noreferrer">limezu.itch.io/modernoffice</a>).
          Gói có bản quyền nên không đi kèm app: giải nén cả hai vào một thư mục (Modern Office vào thư mục con{' '}
          <code>Modern_Office</code>) rồi chọn thư mục đó.
        </p>
        {bad !== null && (
          <p className="muted">
            Thư mục <code>{bad}</code> chưa đủ hình: cần có <code>1_Interiors</code>, <code>2_Characters</code> và{' '}
            <code>Modern_Office\Modern_Office_16x16.png</code>.
          </p>
        )}
        <div className="desk-actions">
          <button type="button" className="desk-btn primary" onClick={pick}>Chọn thư mục gói hình…</button>
          {!location.search.includes('demo') && <a href="?demo">Xem bản demo</a>}
        </div>
      </div>
    )
  }
  return (
    <div className="panel center-card">
      <div className="center-title">Chưa có gói hình pixel</div>
      <p>
        Bản pixel vẽ bằng 2 gói của LimeZu: <b>Modern Interiors</b> (
        <a href="https://limezu.itch.io/moderninteriors" target="_blank" rel="noreferrer">limezu.itch.io/moderninteriors</a>) và{' '}
        <b>Modern Office</b> (
        <a href="https://limezu.itch.io/modernoffice" target="_blank" rel="noreferrer">limezu.itch.io/modernoffice</a>).
        Gói có bản quyền nên không nằm trong repo: mỗi máy tự mua, giải nén, rồi trỏ Pixel Company tới thư mục đó
        (Modern Office giải nén vào thư mục con <code>Modern_Office</code>).
      </p>
      <p className="muted">
        Mặc định Pixel Company tìm ở <code>../coopverse-assets/limezu</code> (cạnh thư mục dự án). Để chỗ khác thì đặt{' '}
        <code>COOPVERSE_ASSETS</code> trong file <code>.env</code>, rồi chạy lại Pixel Company.
      </p>
    </div>
  )
}
