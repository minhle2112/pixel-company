import { useEffect } from 'react'
import { Graphics } from 'pixi.js'
import { LEVEL_FX_MS, useExp, type LevelUp } from '../data/exp'
import { agentPos } from '../runtime'
import { PPM, px, py } from './geom'
import { stage, ticks, type Tick } from './stage'

const DUR = LEVEL_FX_MS / 1000
const SPARKS = 18
const GOLD = 0xffd36b
const COLUMN = 0xffe08a
const SPARK = [0xffd23c, 0xfff6d0]

/** Bán kính quanh người lên cấp mà lời thoại / biểu cảm tạm im (để thấy rõ hiệu ứng) */
const HUSH_M = 2.6

/** Agent này đang lên cấp, hoặc đứng / ngồi sát người đang lên cấp: tạm ẩn lời thoại và bong bóng biểu cảm */
export function hushedBy(id: string, ups: LevelUp[] = useExp.getState().levelUps) {
  if (!ups.length) return false
  const me = agentPos.get(id)
  return ups.some((u) => {
    if (u.agentId === id) return true
    const o = agentPos.get(u.agentId)
    return !!me && !!o && Math.hypot(me.x - o.x, me.z - o.z) < HUSH_M
  })
}

/** Hiệu ứng lên cấp, bản pixel: vòng sáng loang trên sàn, cột sáng vàng, sao lấp lánh xoáy lên quanh agent. */
export function PixelLevelFx() {
  const ups = useExp((s) => s.levelUps)
  return <>{ups.map((u) => <Burst key={u.id} agentId={u.agentId} />)}</>
}

function Burst({ agentId }: { agentId: string }) {
  useEffect(() => {
    if (!stage.sorted || !stage.fx) return
    // Cột sáng nằm sau, vòng sáng và sao ở trên (lớp fx, trên cả ngày/đêm). Vòng quanh hông / ghế chứ không dưới sàn:
    // người ngồi bàn thì sàn bị bàn che mất.
    const ring = new Graphics()
    const column = new Graphics()
    column.blendMode = 'add'
    const sparks = new Graphics()
    stage.fx.addChild(column, ring, sparks)
    const seeds = Array.from({ length: SPARKS }, (_, i) => ({
      a: (i / SPARKS) * Math.PI * 2, r: 0.35 + Math.random() * 0.3, v: 0.7 + Math.random() * 0.9, big: Math.random() < 0.35,
    }))
    let t = 0
    const tick: Tick = (dt) => {
      t += dt
      const p = agentPos.get(agentId)
      if (!p) return
      const X = Math.round(px(p.x)), Y = Math.round(py(p.z))
      const k = Math.min(1, t / DUR)

      // Vòng loang ra rồi mờ dần (hai đợt)
      const w = (t % 0.9) / 0.9
      const rx = Math.round(0.55 * PPM * (0.4 + w * 1.6))
      ring.clear()
      if (t < 1.8) ring.ellipse(X, Y - 8, rx, Math.max(2, Math.round(rx * 0.45))).stroke({ color: GOLD, width: 2, alpha: Math.max(0, 1 - w) })

      // Cột sáng: ba lớp đậm dần vào giữa (kiểu pixel), hiện nhanh rồi mờ dần
      const a = 0.35 * Math.min(1, t * 5) * (1 - k)
      const hgt = Math.round((0.4 + Math.min(1, t * 2) * 0.6) * 2.6 * PPM)
      const half = Math.round(0.5 * PPM * (1 - k * 0.4))
      column.clear()
      for (const [f, al] of [[1, 0.5], [0.66, 0.8], [0.33, 1]] as const) {
        const hw = Math.max(1, Math.round(half * f))
        column.rect(X - hw, Y - hgt, hw * 2, hgt).fill({ color: COLUMN, alpha: a * al })
      }

      // Sao xoáy lên: chấm 1–2 px, sau lưng người thì mờ hơn
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
      sparks.clear()
      seeds.forEach((s, i) => {
        const ang = s.a + t * 2.4
        const r = s.r + t * 0.12
        const sx = Math.round(X + Math.sin(ang) * r * PPM)
        const sy = Math.round(Y - (0.2 + t * s.v * 1.2) * PPM + Math.cos(ang) * r * PPM * 0.45)
        const sz = s.big ? 2 : 1
        sparks.rect(sx, sy, sz, sz).fill({ color: SPARK[i % 2], alpha: fade * (Math.cos(ang) < 0 ? 0.55 : 1) })
      })
    }
    ticks.add(tick)
    return () => {
      ticks.delete(tick)
      for (const g of [ring, column, sparks]) g.destroy()
    }
  }, [agentId])
  return null
}
