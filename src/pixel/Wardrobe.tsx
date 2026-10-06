import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { uiTick } from '../audio/engine'
import { PLAYER_ID } from '../characters/look'
import { leadIdsOf } from '../data/hire'
import { useCoop } from '../store'
import { CH, CW, charSheet, frameAt, type Parts } from './chars'
import type { Dir } from './geom'
import {
  ACCESSORIES, BODIES, EYES, HAIR_STYLES, OUTFIT_COLORS, baseParts, hairColors, randomParts, useParts, usePixelLooks,
} from './look'

/** Vẽ một khung nhân vật lên canvas (phóng to nguyên lần, giữ pixel sắc) */
function useCharCanvas(parts: Parts, scale: number, pose: (t: number) => { anim: 'idle' | 'walk'; dir: Dir; i: number }, animate: boolean) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Dáng đọc mới nhất mỗi khung (vd đổi hướng xoay) mà không phải dựng lại vòng vẽ
  const poseRef = useRef(pose)
  poseRef.current = pose
  useEffect(() => {
    let live = true
    let raf = 0
    charSheet(parts).then((sheet) => {
      if (!live) return
      const src = sheet.base.source.resource as CanvasImageSource
      const draw = (t: number) => {
        const c = ref.current
        if (!c) return
        const g = c.getContext('2d')!
        g.imageSmoothingEnabled = false
        g.clearRect(0, 0, c.width, c.height)
        const q = poseRef.current(t)
        const f = sheet.frame(q.anim, q.dir, q.i).frame
        g.drawImage(src, f.x, f.y, CW, CH, 0, 0, CW * scale, CH * scale)
      }
      const loop = (ms: number) => {
        draw(ms / 1000)
        if (animate) raf = requestAnimationFrame(loop)
      }
      loop(0)
    })
    return () => {
      live = false
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parts), scale, animate])
  return ref
}

/** Ảnh nhỏ một người (đứng yên, quay mặt ra) */
export function Avatar({ parts, scale = 2 }: { parts: Parts; scale?: number }) {
  const ref = useCharCanvas(parts, scale, () => ({ anim: 'idle', dir: 'down', i: 0 }), false)
  return <canvas ref={ref} width={CW * scale} height={CH * scale} className="px-avatar" aria-hidden />
}

const DIRS: Dir[] = ['down', 'left', 'up', 'right']

/** Xem trước lớn: đi bộ tại chỗ, bấm mũi tên để xoay */
function Preview({ parts }: { parts: Parts }) {
  const [d, setD] = useState(0)
  const dir = DIRS[d]
  const ref = useCharCanvas(parts, 7, (t) => ({ anim: 'walk', dir, i: frameAt('walk', t * 0.7) }), true)
  return (
    <div className="wd-preview px-preview">
      <canvas ref={ref} width={CW * 7} height={CH * 7} role="img" aria-label="Hình xem trước nhân vật" />
      <div className="px-turn">
        <button className="wd-chip" onClick={() => setD((d + 3) % 4)} aria-label="Xoay trái">◀</button>
        <button className="wd-chip" onClick={() => setD((d + 1) % 4)} aria-label="Xoay phải">▶</button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wd-row" role="group" aria-label={label}>
      <div className="wd-label" aria-hidden>{label}</div>
      <div className="wd-opts">{children}</div>
    </div>
  )
}

/** ◀ giá trị ▶, vòng lại ở hai đầu */
function Stepper({ value, list, onPick, show = (v) => String(v), name }: {
  value: number
  list: number[]
  onPick: (v: number) => void
  show?: (v: number) => string
  name: string
}) {
  const i = Math.max(0, list.indexOf(value))
  const go = (k: number) => onPick(list[(i + k + list.length) % list.length])
  return (
    <span className="px-step">
      <button className="wd-chip" onClick={() => go(-1)} aria-label={`${name}: trước`}>◀</button>
      <span className="px-step-v">{show(value)}</span>
      <button className="wd-chip" onClick={() => go(1)} aria-label={`${name}: sau`}>▶</button>
    </span>
  )
}

const range = (n: number) => Array.from({ length: n }, (_, k) => k + 1)

/**
 * Tủ đồ (phím C), bản pixel: ghép bộ phận trong bộ nhân vật LimeZu cho bạn hoặc từng agent.
 * Lưu trên trình duyệt này; agent mặc đồ mới ngay trong văn phòng.
 */
export function Wardrobe({ id }: { id: string }) {
  const agents = useCoop((s) => s.agents)
  const close = useCoop((s) => s.closeWardrobe)
  const open = useCoop((s) => s.openWardrobe)
  const setParts = usePixelLooks((s) => s.setParts)
  const reset = usePixelLooks((s) => s.reset)
  const custom = usePixelLooks((s) => s.custom)
  const leads = useMemo(() => leadIdsOf(agents), [agents])
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { if (before?.isConnected) before.focus() }
  }, [])
  const agent = agents.find((a) => a.id === id)
  const name = id === PLAYER_ID ? 'Bạn' : agent?.name ?? '?'
  const isLead = leads.has(id)
  const p = useParts(id, name, isLead)
  const edited = !!custom[id]

  const set = (patch: Partial<Parts>) => { uiTick(); setParts(id, patch) }
  const people = [{ id: PLAYER_ID, name: 'Bạn', lead: false }, ...agents.filter((a) => a.status !== 'terminated').map((a) => ({ id: a.id, name: a.name, lead: leads.has(a.id) }))]
  const accIds = [-1, ...ACCESSORIES.map((_, k) => k)]
  const accNow = p.acc ? ACCESSORIES.findIndex((a) => a.id === p.acc) : -1

  return (
    <div className="term-wrap wd-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="wardrobe" role="dialog" aria-modal="true" aria-label={`Tủ đồ · ${name}`} tabIndex={-1} ref={dialog}>
        <div className="term-bar">
          <span className="term-dots"><i /><i /><i /></span>
          <span className="term-title">Tủ đồ <span className="muted">· {name}{edited ? ' · đã chỉnh' : ''}</span></span>
          <button className="term-close" onClick={close} title="Đóng tủ đồ"><kbd>Esc</kbd> Xong</button>
        </div>
        <div className="wd-body">
          <nav className="wd-people" aria-label="Chọn người">
            {people.map((q) => (
              <button key={q.id} className={`wd-person${q.id === id ? ' on' : ''}`} aria-current={q.id === id} onClick={() => { uiTick(); open(q.id) }}>
                <Avatar parts={{ ...baseParts(q.id, q.name, q.lead), ...custom[q.id] }} scale={1} />
                <span>{q.name}</span>
                {custom[q.id] && <em title="Đã chỉnh">✎</em>}
              </button>
            ))}
          </nav>
          <Preview parts={p} />
          <div className="wd-controls">
            <Row label="Màu da"><Stepper name="Màu da" value={p.body} list={BODIES} onPick={(v) => set({ body: v })} show={(v) => `${BODIES.indexOf(v) + 1}/${BODIES.length}`} /></Row>
            <Row label="Mắt"><Stepper name="Mắt" value={p.eyes} list={EYES} onPick={(v) => set({ eyes: v })} show={(v) => `${v}/${EYES.length}`} /></Row>
            <Row label="Kiểu tóc">
              <Stepper name="Kiểu tóc" value={p.hair[0]} list={range(HAIR_STYLES)} onPick={(v) => set({ hair: [v, Math.min(p.hair[1], hairColors(v))] })} show={(v) => `${v}/${HAIR_STYLES}`} />
            </Row>
            <Row label="Màu tóc">
              <Stepper name="Màu tóc" value={p.hair[1]} list={range(hairColors(p.hair[0]))} onPick={(v) => set({ hair: [p.hair[0], v] })} show={(v) => `${v}/${hairColors(p.hair[0])}`} />
            </Row>
            <Row label="Bộ đồ">
              <Stepper name="Bộ đồ" value={p.outfit[0]} list={range(33)} onPick={(v) => set({ outfit: [v, Math.min(p.outfit[1], OUTFIT_COLORS[v])] })} show={(v) => `${v}/33`} />
            </Row>
            <Row label="Màu đồ">
              <Stepper name="Màu đồ" value={p.outfit[1]} list={range(OUTFIT_COLORS[p.outfit[0]])} onPick={(v) => set({ outfit: [p.outfit[0], v] })} show={(v) => `${v}/${OUTFIT_COLORS[p.outfit[0]]}`} />
            </Row>
            <Row label="Phụ kiện">
              <Stepper name="Phụ kiện" value={accNow} list={accIds} onPick={(v) => set({ acc: v < 0 ? null : ACCESSORIES[v].id })} show={(v) => (v < 0 ? 'Không' : ACCESSORIES[v].label)} />
            </Row>
            <div className="wd-actions">
              <button className="t-btn" onClick={() => { uiTick(); setParts(id, randomParts()) }}>🎲 Ngẫu nhiên</button>
              <button className="t-btn" disabled={!edited} onClick={() => { uiTick(); reset(id) }}>↺ Về mặc định</button>
            </div>
            <p className="wd-note">Hình nhân vật từ bộ Character Generator của LimeZu. Lưu trên trình duyệt này, Paperclip không bị đổi gì.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
