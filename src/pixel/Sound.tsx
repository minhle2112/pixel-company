import { useEffect, useRef } from 'react'
import { bubblePop, footstep, keyClick, listener, ting, unlockAudio, whoosh } from '../audio/engine'
import { actors } from '../life/actors'
import { useLife } from '../life/store'
import { player } from '../runtime'
import { useCoop } from '../store'
import { ticks, type Tick } from './stage'

/** Gõ phím theo từng đợt: gõ 1–4 giây rồi nghỉ 0,4–2,5 giây, như người thật. */
interface Typist { next: number; burstEnd: number; restEnd: number }

/**
 * Âm thanh bản pixel (giống bản 3D): tai nghe ở chỗ nhân vật, camera nhìn từ trên không xoay nên bên phải luôn là hướng đông.
 * Tiếng gõ phím của agent đang làm, bước chân, "pop" bong bóng chat, "ting" thông báo, "vút" khi mở CLI / bảng.
 */
export function PixelSound() {
  const typists = useRef(new Map<string, Typist>())
  const last = useRef({ x: player.x, z: player.z, walked: 0 })
  const time = useRef(0)
  // Trạng thái theo id, chỉ dựng lại khi danh sách agent đổi (không tạo Map mới mỗi khung hình)
  const status = useRef({ agents: null as unknown, map: new Map<string, string>() })

  // Trình duyệt chỉ cho phát tiếng sau thao tác đầu tiên của người dùng
  useEffect(() => {
    const go = () => unlockAudio()
    window.addEventListener('pointerdown', go)
    window.addEventListener('keydown', go)
    return () => {
      window.removeEventListener('pointerdown', go)
      window.removeEventListener('keydown', go)
    }
  }, [])

  // Thông báo mới → ting; mở/đóng CLI, bảng ticket → vút
  useEffect(() => {
    const unsub = useCoop.subscribe((s, p) => {
      if (s.notes.length && s.notes !== p.notes) {
        const known = new Set(p.notes.map((n) => n.id))
        const fresh = s.notes.filter((n) => !known.has(n.id))
        // Nhiều thông báo cùng lúc: chỉ kêu một tiếng, ưu tiên loại quan trọng nhất
        const order = ['error', 'ask', 'level', 'warn', 'done', 'start', 'info'] as const
        const top = order.find((k) => fresh.some((n) => n.kind === k))
        if (top) ting(top)
      }
      const open = !!s.focusId || s.boardOpen || s.fameOpen || !!s.wardrobeId
      const was = !!p.focusId || p.boardOpen || p.fameOpen || !!p.wardrobeId
      if (open !== was) whoosh(open)
    })
    // Bong bóng chat mới → pop ở chỗ agent đang đứng
    const unsubLife = useLife.subscribe((s, p) => {
      for (const [id, b] of Object.entries(s.bubbles)) {
        if (p.bubbles[id]?.id === b.id) continue
        const a = actors.get(id)
        if (a) bubblePop(a.x, a.z)
      }
    })
    return () => { unsub(); unsubLife() }
  }, [])

  useEffect(() => {
    const tick: Tick = (rawDt) => {
      const dt = Math.min(rawDt, 0.1)
      time.current += dt
      const t = time.current

      // Tai người nghe ở chỗ nhân vật; bên phải màn hình là hướng đông (+x)
      listener.x = player.x
      listener.z = player.z
      listener.rx = 1
      listener.rz = 0

      // Bước chân người chơi
      const lp = last.current
      const moved = Math.hypot(player.x - lp.x, player.z - lp.z)
      lp.x = player.x
      lp.z = player.z
      if (moved > 0.0005 && moved < 1) {
        lp.walked += moved
        const speed = moved / Math.max(dt, 1e-3)
        const stride = speed > 4 ? 0.95 : 0.7
        if (lp.walked > stride) {
          lp.walked = 0
          footstep(player.x, player.z, speed > 4 ? 1.2 : 0.8)
        }
      }

      // Gõ phím: agent đang chạy (running) và đang ngồi ở bàn
      const agents = useCoop.getState().agents
      const st = status.current
      if (st.agents !== agents) st.map = new Map(agents.map((a) => [a.id, a.status]))
      st.agents = agents
      for (const a of actors.values()) {
        if (st.map.get(a.id) !== 'running' || a.where !== 'seat') {
          typists.current.delete(a.id)
          continue
        }
        let ty = typists.current.get(a.id)
        if (!ty) {
          ty = { next: t + Math.random(), burstEnd: t + 1 + Math.random() * 3, restEnd: 0 }
          typists.current.set(a.id, ty)
        }
        if (t > ty.burstEnd) {
          // Hết đợt gõ: nghỉ một lúc rồi gõ đợt mới
          ty.restEnd = t + 0.4 + Math.random() * 2.1
          ty.burstEnd = ty.restEnd + 1 + Math.random() * 3
          ty.next = ty.restEnd
        }
        if (t < ty.next || t < ty.restEnd) continue
        keyClick(a.x, a.z, Math.random() < 0.08)
        ty.next = t + 0.07 + Math.random() * 0.13
      }
    }
    ticks.add(tick)
    return () => { ticks.delete(tick) }
  }, [])

  return null
}
