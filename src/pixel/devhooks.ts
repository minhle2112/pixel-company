import type { Application } from 'pixi.js'
import { EXP, applyLedger, useExp } from '../data/exp'
import type { PcLiveEvent } from '../data/paperclip'
import { injectLiveEvent } from '../data/sync'
import { actors } from '../life/actors'
import { leveledUp } from '../life/director'
import { clock, useLife } from '../life/store'
import { agentPos, input, player } from '../runtime'
import { useSettings } from '../settings'
import { useCoop } from '../store'
import { view } from './view'

/**
 * Chỉ chạy ở chế độ dev (bản pixel). Giống bản 3D:
 * window.__coop.step(2) chạy 2 giây mô phỏng (cả khi tab bị ẩn, requestAnimationFrame dừng);
 * __coop.resume() chạy lại bình thường; __coop.go(x, z, 'near' | 'far') dịch bạn tới chỗ khác để xem;
 * __coop.inject / store / life / exp / grant như bản 3D.
 */
export function installDevHooks(app: Application) {
  let last = performance.now()
  const api = {
    runtime: { agentPos, input, player, view },
    store: useCoop,
    life: { actors, clock, store: useLife },
    settings: useSettings,
    app,
    step(seconds: number, fps = 30) {
      app.ticker.stop()
      last = Math.max(last, app.ticker.lastTime)
      const n = Math.round(seconds * fps)
      for (let i = 0; i < n; i++) {
        last += 1000 / fps
        app.ticker.update(last)
      }
      app.render()
      return { player: { ...player }, agents: Object.fromEntries(agentPos) }
    },
    resume() { app.ticker.start() },
    go(x: number, z: number, zoom?: 'near' | 'far') {
      player.x = x
      player.z = z
      if (zoom) useSettings.getState().set({ zoom })
      // Camera nhảy luôn tới chỗ mới thay vì trượt dần
      view.x = Infinity
    },
    inject(e: PcLiveEvent, opts?: { noRefresh?: boolean }) { injectLiveEvent?.(e, opts) },
    exp: useExp,
    grant(agentId: string, amount: number) {
      const L = useExp.getState().ledger
      const runs = { ...L.runs }
      for (let i = 0; i < Math.ceil(amount / EXP.run); i++) runs[`dev-${Date.now()}-${i}`] = [agentId, Date.now()]
      applyLedger({ ...L, runs }, (id, lv) => {
        useCoop.getState().pushNotes([{ kind: 'level', text: `⭐ (dev) ${id} lên cấp ${lv}` }])
        leveledUp(id, lv)
      })
      return useExp.getState().stats[agentId]
    },
  }
  ;(window as unknown as { __coop: typeof api }).__coop = api
  return () => { delete (window as unknown as { __coop?: unknown }).__coop }
}
