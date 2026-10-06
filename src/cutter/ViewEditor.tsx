import { useEffect, useRef, useState } from 'react'
import { partWH, type DeskTop, type Part, type View } from '../data/catalog'
import { checker, drawFit, drawPart, drawView, onImage, partRect, viewBox } from './draw'
import { useC } from './store'

/**
 * Khung xem trước + sửa một hình (một hướng của món, hoặc một kiểu ghế làm việc):
 * kéo mảnh bằng chuột, phím mũi tên dời 1 px (Shift: 8 px), Delete xoá mảnh.
 * Điểm neo (dấu + đỏ): giữa mép dưới khung chân món; đồ treo tường: mép trên mặt tường; ghế làm việc: chỗ ngồi.
 */

export interface Ctx {
  mode: 'floor' | 'wall' | 'chair'
  /** Cỡ khung chân (pixel): đồ treo tường thì fh = 0 */
  fw: number
  fh: number
  flip?: boolean
  shadow?: boolean
  /** Chỗ người ngồi (pixel, so với điểm neo); `behind`: người ngồi quay lưng, món che người */
  seats?: { x: number; y: number }[]
  behind?: boolean
  /** Chỗ đứng dùng món (chấm xanh) */
  stands?: { x: number; y: number }[]
  /** Ghế làm việc: bàn đặt ở đâu so với chỗ ngồi, vẽ trước hay sau người */
  desk?: { top: DeskTop; x: number; y: number; w: number; h: number; first: boolean }
  /** Ghế vẽ sau người (ghế nhìn từ sau) */
  chairOver?: boolean
  tint?: string
}

const PERSON = 'rgba(160,130,255,0.75)'
/** Hình người ngồi đơn giản (chân ở chỗ ngồi) */
function person(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = PERSON
  g.beginPath()
  g.arc(x, y - 22, 5, 0, Math.PI * 2)
  g.fill()
  g.fillRect(x - 5, y - 17, 10, 12)
  g.fillRect(x - 4, y - 5, 8, 4)
}

export function ViewEditor({ view, ctx, onChange, readOnly }: { view: View; ctx: Ctx; onChange: (v: View) => void; readOnly?: boolean }) {
  const part = useC((s) => s.part)
  const [zoom, setZoom] = useState(4)
  const [live, setLive] = useState<View | null>(null)
  const [frame, setFrame] = useState(0)
  const drag = useRef<{ k: number; mx: number; my: number; x: number; y: number; live?: View } | null>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  const v = live ?? view
  const animated = v.parts.some((p) => (p.frames ?? 1) > 1)
  useEffect(() => {
    if (!animated) return
    const t = setInterval(() => setFrame((f) => f + 1), 120)
    return () => clearInterval(t)
  }, [animated])

  // Vùng vẽ (so với điểm neo): bao hình, khung chân, bàn, người; chừa lề
  const [bx, by, bw, bh] = viewBox(v, ctx.fw, ctx.fh)
  const xs = [bx, bx + bw, -ctx.fw / 2, ctx.fw / 2], ys = [by, by + bh, -ctx.fh, 0]
  if (ctx.mode === 'wall') ys.push(34)
  if (ctx.desk) xs.push(ctx.desk.x, ctx.desk.x + ctx.desk.w), ys.push(ctx.desk.y, ctx.desk.y + ctx.desk.h)
  for (const s of [...(ctx.seats ?? []), ...(ctx.stands ?? [])]) xs.push(s.x - 8, s.x + 8), ys.push(s.y - 28, s.y + 4)
  const M = 12
  const x0 = Math.floor(Math.min(...xs, -40) - M), x1 = Math.ceil(Math.max(...xs, 40) + M)
  const y0 = Math.floor(Math.min(...ys) - M), y1 = Math.ceil(Math.max(...ys, 16) + M)
  const W = x1 - x0, H = y1 - y0

  useEffect(() => {
    const c = cv.current
    if (!c) return
    c.width = W * zoom
    c.height = H * zoom
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    checker(g, c.width, c.height, 8)
    g.setTransform(zoom, 0, 0, zoom, -x0 * zoom, -y0 * zoom)
    // Sàn / tường
    if (ctx.mode === 'wall') {
      g.fillStyle = '#5d6170'
      g.fillRect(x0, 0, W, 32)
      g.fillStyle = '#3b3e49'
      g.fillRect(x0, y0, W, -y0)
      g.fillStyle = 'rgba(80,220,130,0.18)'
      g.fillRect(-ctx.fw / 2, 0, ctx.fw, 30)
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.10)'
      g.lineWidth = 1 / zoom
      g.beginPath()
      for (let x = Math.ceil((x0 + ctx.fw / 2) / 16) * 16 - ctx.fw / 2; x < x1; x += 16) { g.moveTo(x, y0); g.lineTo(x, y1) }
      for (let y = Math.ceil(y0 / 16) * 16; y < y1; y += 16) { g.moveTo(x0, y); g.lineTo(x1, y) }
      g.stroke()
      if (ctx.fw && ctx.fh) {
        g.fillStyle = 'rgba(80,220,130,0.18)'
        g.fillRect(-ctx.fw / 2, -ctx.fh, ctx.fw, ctx.fh)
      }
    }
    if (ctx.shadow && ctx.mode === 'floor') {
      g.fillStyle = 'rgba(0,0,0,0.2)'
      g.beginPath()
      g.ellipse(0, -1, Math.max(4, Math.round(ctx.fw * 0.46)), 3, 0, 0, Math.PI * 2)
      g.fill()
    }
    if (ctx.shadow && ctx.mode === 'wall' && v.parts[0]) {
      const p = v.parts[0]
      const [w, h] = partWH(p)
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.fillRect(p.x + 1, p.y + h, w - 2, 1)
    }
    const deskNow = () => {
      const d = ctx.desk!
      drawFit(g, d.top.src, d.x, d.y, d.w, d.h, 'repeat', d.top.l, d.top.r, d.top.t, d.top.b)
    }
    if (ctx.desk?.first) deskNow()
    const persons = () => ctx.seats?.forEach((s) => person(g, s.x, s.y))
    const item = () => drawView(g, v, !!ctx.flip, ctx.fw, ctx.fh, { frame, tint: ctx.tint })
    if (ctx.behind || ctx.chairOver) { persons(); item() } else { item(); persons() }
    if (v.front && ctx.seats?.length) drawView(g, v, !!ctx.flip, ctx.fw, ctx.fh, { frame, only: -v.front })
    if (ctx.desk && !ctx.desk.first) deskNow()
    for (const s of ctx.stands ?? []) {
      g.fillStyle = 'rgba(90,200,255,0.8)'
      g.beginPath()
      g.arc(s.x, s.y, 3, 0, Math.PI * 2)
      g.fill()
    }
    // Khung chân, điểm neo, mảnh đang chọn
    g.lineWidth = 1 / zoom
    if (ctx.fw && ctx.mode === 'floor') {
      g.strokeStyle = 'rgba(80,220,130,0.9)'
      g.strokeRect(-ctx.fw / 2, -ctx.fh, ctx.fw, ctx.fh)
    }
    g.strokeStyle = '#ff5a5a'
    g.beginPath()
    g.moveTo(-4, 0); g.lineTo(4, 0); g.moveTo(0, -4); g.lineTo(0, 4)
    g.stroke()
    if (part !== null && v.parts[part] && !readOnly) {
      const [px, py, pw, ph] = partRect(v, part, ctx.fw, ctx.fh)
      g.strokeStyle = '#f2b544'
      g.setLineDash([3 / zoom, 2 / zoom])
      g.strokeRect(ctx.flip ? -px - pw : px, py, pw, ph)
      g.setLineDash([])
    }
  })

  const pick = (e: React.MouseEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect()
    // Hình đang lật gương: đổi về toạ độ chưa lật
    const x = (e.clientX - r.left) / zoom + x0
    return [ctx.flip ? -x : x, (e.clientY - r.top) / zoom + y0]
  }
  const onDown = (e: React.MouseEvent) => {
    if (readOnly) return
    cv.current?.focus()
    const [mx, my] = pick(e)
    for (let k = v.parts.length - 1; k >= 0; k--) {
      const [px, py, pw, ph] = partRect(v, k, ctx.fw, ctx.fh)
      if (mx >= px && mx < px + pw && my >= py && my < py + ph) {
        useC.setState({ part: k })
        drag.current = { k, mx, my, x: v.parts[k].x, y: v.parts[k].y }
        return
      }
    }
    useC.setState({ part: null })
  }
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const [mx, my] = pick(e)
    const parts = v.parts.map((p, k) => (k === d.k ? { ...p, x: d.x + Math.round(mx - d.mx), y: d.y + Math.round(my - d.my) } : p))
    d.live = { ...v, parts }
    setLive(d.live)
  }
  const onUp = () => {
    if (drag.current?.live) onChange(drag.current.live)
    drag.current = null
    setLive(null)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly || part === null || !v.parts[part]) return
    const step = e.shiftKey ? 8 : 1
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (mv[e.key]) {
      e.preventDefault()
      const [mx, dy] = mv[e.key]
      const dx = ctx.flip ? -mx : mx
      onChange({ ...v, parts: v.parts.map((p, k) => (k === part ? { ...p, x: p.x + dx, y: p.y + dy } : p)) })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onChange({ ...v, parts: v.parts.filter((_, k) => k !== part) })
      useC.setState({ part: null })
    }
  }

  return (
    <div className="view-ed">
      <div className="row small">
        <span className="dim">Xem trước</span>
        <button onClick={() => setZoom((z) => Math.max(1, z - 1))}>−</button> {zoom}× <button onClick={() => setZoom((z) => Math.min(8, z + 1))}>+</button>
        <span className="grow" />
        <span className="dim">{readOnly ? 'Chỉ xem' : 'Kéo mảnh · ←↑→↓ dời 1 px (Shift: 8) · Delete xoá'}</span>
      </div>
      <div className="preview">
        <canvas ref={cv} tabIndex={0} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onKeyDown={onKey} />
      </div>
      <div className="legend small dim">
        <span><i style={{ background: 'rgba(80,220,130,0.6)' }} /> chỗ món chiếm</span>
        <span><i style={{ background: '#ff5a5a' }} /> điểm neo</span>
        {!!ctx.seats?.length && <span><i style={{ background: PERSON }} /> người ngồi thử</span>}
        {!!ctx.stands?.length && <span><i style={{ background: 'rgba(90,200,255,0.8)' }} /> chỗ đứng dùng</span>}
      </div>
      {!readOnly && <PartList view={v} onChange={onChange} />}
    </div>
  )
}

function PartThumb({ p }: { p: Part }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const [w, h] = partWH(p)
    const z = Math.max(1, Math.floor(28 / Math.max(w, h, 1)))
    c.width = w * z
    c.height = h * z
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.scale(z, z)
    drawPart(g, { ...p, x: 0, y: 0 })
  })
  return <canvas ref={cv} className="pix part-thumb" />
}

export function PartList({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const part = useC((s) => s.part)
  const set = (k: number, p: Partial<Part>) => onChange({ ...view, parts: view.parts.map((q, i) => (i === k ? clean({ ...q, ...p }) : q)) })
  const move = (k: number, d: number) => {
    const parts = [...view.parts]
    const j = k + d
    if (j < 0 || j >= parts.length) return
    ;[parts[k], parts[j]] = [parts[j], parts[k]]
    onChange({ ...view, parts })
    useC.setState({ part: j })
  }
  if (!view.parts.length) return <p className="hint">Hình này chưa có mảnh nào: cắt một vùng trong ảnh rồi bấm <b>➕ Thêm mảnh</b>.</p>
  return (
    <div className="parts">
      {view.parts.map((p, k) => (
        <div key={k} className={`part${k === part ? ' on' : ''}`} onClick={() => useC.setState({ part: k })}>
          <PartThumb p={p} />
          <div className="part-body">
            <div className="row small">
              <b>#{k + 1}</b>
              {k === 0 && view.fit && <span className="tag">kéo giãn</span>}
              {p.src ? <span className="dim" title={p.src[0]}>{p.src[0].slice(p.src[0].lastIndexOf('/') + 1)} · {p.src.slice(1).join(', ')}</span>
                : p.box && <BoxFields box={p.box} set={(box) => set(k, { box })} />}
            </div>
            <div className="row small">
              <label>x <input type="number" value={p.x} onChange={(e) => set(k, { x: Math.round(+e.target.value) || 0 })} /></label>
              <label>y <input type="number" value={p.y} onChange={(e) => set(k, { y: Math.round(+e.target.value) || 0 })} /></label>
              <label title="Hình động: số khung xếp ngang">khung <input type="number" min={1} value={p.frames ?? 1} onChange={(e) => set(k, { frames: Math.max(1, Math.round(+e.target.value) || 1) })} /></label>
              {(p.frames ?? 1) > 1 && <label title="Khung mỗi nhịp: 0,05 chậm – 0,15 nhanh">tốc độ <input type="number" step={0.01} min={0.01} max={1} value={p.speed ?? 0.08} onChange={(e) => set(k, { speed: Math.max(0.01, +e.target.value || 0.08) })} /></label>}
            </div>
          </div>
          <div className="part-btns">
            <button title="Vẽ trước (nằm dưới)" onClick={(e) => { e.stopPropagation(); move(k, -1) }}>▲</button>
            <button title="Vẽ sau (nằm trên)" onClick={(e) => { e.stopPropagation(); move(k, 1) }}>▼</button>
            <button title="Xoá mảnh" onClick={(e) => { e.stopPropagation(); onChange({ ...view, parts: view.parts.filter((_, i) => i !== k) }); useC.setState({ part: null }) }}>🗑</button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Khối màu: cỡ + màu */
function BoxFields({ box, set }: { box: [number, number, string]; set: (b: [number, number, string]) => void }) {
  const [w, h, col] = box
  return (
    <span className="row small" onClick={(e) => e.stopPropagation()}>
      khối màu <input type="color" value={col} onChange={(e) => set([w, h, e.target.value])} />
      <label>rộng <input type="number" min={1} value={w} onChange={(e) => set([Math.max(1, Math.round(+e.target.value) || 1), h, col])} /></label>
      <label>cao <input type="number" min={1} value={h} onChange={(e) => set([w, Math.max(1, Math.round(+e.target.value) || 1), col])} /></label>
    </span>
  )
}

/** Bỏ thuộc tính hình động khi chỉ còn 1 khung */
function clean(p: Part): Part {
  if ((p.frames ?? 1) > 1) return p
  const { frames: _f, speed: _s, ...rest } = p
  return rest
}
