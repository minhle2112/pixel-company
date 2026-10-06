import { useEffect, useRef, useState } from 'react'
import { DESK_KINDS, deskPlace, type DeskAt, type DeskKind, type DeskThing, type DeskThingView, type View } from '../data/catalog'
import { checker, drawFit, drawView, onImage, viewBox } from './draw'
import { Thumb } from './Editor'
import { DESK_MID, thingOf, thingProblems, useC } from './store'
import { PartList } from './ViewEditor'

/*
 * Đồ trên bàn làm việc (máy tính, bàn phím, cốc, đồ để bàn agent mua): hình từng kiểu bàn và chỗ đặt trên mặt bàn.
 * Khung xem trước dựng lại bàn như trong game (src/pixel/office.ts buildDesk): kéo món để dời chỗ đặt.
 * Bàn chật thì một món có thể có chỗ đặt riêng khi agent có thêm vài món khác (vd có màn hình thứ hai thì máy tính lệch trái).
 */

export const KIND_INFO: Record<DeskKind, { name: string; hint: string }> = {
  front: { name: 'Agent quay mặt ra', hint: 'Agent ngồi phía bắc bàn, nhìn về phía bạn: thấy mặt sau màn hình' },
  back: { name: 'Agent quay lưng', hint: 'Agent ngồi phía nam bàn, quay lưng về phía bạn: thấy mặt trước màn hình' },
  side: { name: 'Bàn quay ngang', hint: 'Bàn bên phải agent (agent nhìn sang phải); bàn quay sang trái thì game tự lật gương cả bàn' },
}

/** Cỡ mặt bàn (pixel, như office.ts: 1,4 × 0,75 m, cao 9 px), chỗ người ngồi so với góc trên trái hình mặt bàn */
const LIFT = 9
const SIZE: Record<DeskKind, [number, number]> = { front: [45, 24], back: [45, 24], side: [24, 45] }
const SEAT: Record<DeskKind, { x: number; y: number }> = { front: { x: 22, y: -5 }, back: { x: 22, y: 47 }, side: { x: -15, y: 31 } }
const PERSON = 'rgba(160,130,255,0.75)'
const LEATHER = '#b07a5a'

/** Chỗ đặt đang dùng của món theo các đồ agent có (kể cả chỗ "ẩn"); -1 = không chỗ nào hợp */
export function activeAt(v: DeskThingView, has: (id: string) => boolean): number {
  let best = -1
  v.at.forEach((a, k) => {
    if ((a.if ?? []).every(has) && (best < 0 || (a.if?.length ?? 0) > (v.at[best].if?.length ?? 0))) best = k
  })
  return best
}

/** Khung bao hình món (so với điểm neo, đã tính lật gương) */
function thingBox(v: View): [number, number, number, number] {
  const [x, y, w, h] = viewBox(v, 0, 0)
  return [v.flip ? -x - w : x, y, w, h]
}

function person(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = PERSON
  g.beginPath()
  g.arc(x, y - 22, 5, 0, Math.PI * 2)
  g.fill()
  g.fillRect(x - 5, y - 17, 10, 12)
  g.fillRect(x - 4, y - 5, 8, 4)
}

/** Màn hình sáng (như liveScreen trong office.ts khi agent đang chạy việc) */
function screen(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (w < 3 || h < 3) {
    g.fillStyle = '#3ccf6e'
    g.fillRect(x, y, w, h)
    return
  }
  g.fillStyle = '#0f1d17'
  g.fillRect(x, y, w, h)
  for (let row = 0; row < h; row += 2) {
    g.fillStyle = row % 4 ? '#3ccf6e' : '#9be7b4'
    g.fillRect(x + 1, y + row, Math.min(2 + ((row * 7) % (w - 2)), w - 2), 1)
  }
}

// ───────────────────────── Khung xem trước bàn ─────────────────────────

function DeskScene() {
  const file = useC((s) => s.file)!
  const target = useC((s) => s.target)
  const kind = useC((s) => s.deskKind)
  const own = useC((s) => s.deskOwn)
  const [zoom, setZoom] = useState(5)
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null)
  const drag = useRef<{ id: string; k: number; mx: number; my: number; x: number; y: number; moved?: { x: number; y: number } } | null>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])

  const has = (id: string) => own.includes(id)
  const sel = target?.kind === 'thing' ? target.id : null
  const [dw, dd] = SIZE[kind]
  const top = kind === 'side' ? file.desk.side ?? file.desk.top : file.desk.top
  const seat = SEAT[kind]
  const plainChair = file.desk.chair[kind]
  const leatherChair = file.desk.chair[`${kind}Leather`]
  const chair = has('chair') && leatherChair ? leatherChair : plainChair
  const tint = has('chair') && !leatherChair ? LEATHER : undefined
  // Món đang hiện, xếp như game: hàng xa vẽ trước, bằng nhau thì món ghi trước vẽ trước
  const shown = file.desk.things.flatMap((t, k) => {
    const p = deskPlace(t, kind, has)
    if (!p) return []
    const at: DeskAt = live?.id === t.id ? { ...p.at, x: live.x, y: live.y } : p.at
    return [{ t, k, view: p.view, at }]
  })
  shown.sort((a, b) => a.at.y - b.at.y || a.k - b.k)

  // Vùng vẽ: bàn, người, ghế, các món; chừa lề
  const rects: [number, number, number, number][] = [[0, 0, dw, dd + LIFT + 2], [seat.x - 8, seat.y - 28, 16, 32]]
  const [cx, cy, cw, ch] = viewBox(chair, 0, 0)
  rects.push([seat.x + cx, seat.y + cy, cw, ch])
  for (const s of shown) {
    const [x, y, w, h] = thingBox(s.view)
    rects.push([s.at.x + x, s.at.y + y, w, h])
  }
  const M = 10
  const x0 = Math.floor(Math.min(...rects.map((r) => r[0])) - M), y0 = Math.floor(Math.min(...rects.map((r) => r[1])) - M)
  const x1 = Math.ceil(Math.max(...rects.map((r) => r[0] + r[2])) + M), y1 = Math.ceil(Math.max(...rects.map((r) => r[1] + r[3])) + M)
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
    const desk = () => {
      g.fillStyle = 'rgba(0,0,0,0.2)'
      g.fillRect(2, dd + LIFT - 2, dw - 1, 3)
      drawFit(g, top.src, 0, 0, dw, dd + LIFT, 'repeat', top.l, top.r, top.t, top.b)
      if (has('trophy')) {
        g.fillStyle = '#f2c14e'
        g.fillRect(2, dd + 1, dw - 4, 2)
        g.fillStyle = '#ffe9a8'
        g.fillRect(2, dd + 1, dw - 4, 1)
        g.fillStyle = '#9a6b14'
        g.fillRect(2, dd + 3, dw - 4, 1)
      }
      for (const s of shown) {
        g.save()
        g.translate(s.at.x, s.at.y)
        drawView(g, s.view, !!s.view.flip, 0, 0)
        g.restore()
      }
      for (const s of shown) if (s.view.screen) screen(g, s.at.x + s.view.screen[0], s.at.y + s.view.screen[1], s.view.screen[2], s.view.screen[3])
    }
    const sitter = () => {
      g.save()
      g.translate(seat.x, seat.y)
      drawView(g, chair, false, 0, 0, { tint })
      g.restore()
      person(g, seat.x, seat.y)
    }
    if (kind === 'back') {
      desk()
      person(g, seat.x, seat.y)
      g.save()
      g.translate(seat.x, seat.y)
      drawView(g, chair, false, 0, 0, { tint })
      g.restore()
    } else {
      sitter()
      desk()
    }
    // Món đang chọn: khung, điểm neo, mặt màn hình, quầng đèn
    const s = shown.find((x) => x.t.id === sel)
    g.lineWidth = 1 / zoom
    if (s) {
      const [bx, by, bw, bh] = thingBox(s.view)
      g.strokeStyle = '#f2b544'
      g.setLineDash([3 / zoom, 2 / zoom])
      g.strokeRect(s.at.x + bx, s.at.y + by, bw, bh)
      g.setLineDash([])
      if (s.view.screen) {
        g.strokeStyle = '#5ad1ff'
        g.strokeRect(s.at.x + s.view.screen[0], s.at.y + s.view.screen[1], s.view.screen[2], s.view.screen[3])
      }
      if (s.t.light) {
        const lx = s.at.x + s.t.light[0], ly = s.at.y + s.t.light[1]
        const grd = g.createRadialGradient(lx, ly, 0, lx, ly, 30)
        grd.addColorStop(0, 'rgba(255,214,120,0.35)')
        grd.addColorStop(1, 'rgba(255,214,120,0)')
        g.fillStyle = grd
        g.fillRect(lx - 30, ly - 30, 60, 60)
      }
      g.strokeStyle = '#ff5a5a'
      g.beginPath()
      g.moveTo(s.at.x - 3, s.at.y); g.lineTo(s.at.x + 3, s.at.y); g.moveTo(s.at.x, s.at.y - 3); g.lineTo(s.at.x, s.at.y + 3)
      g.stroke()
    }
  })

  const pick = (e: React.MouseEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / zoom + x0, (e.clientY - r.top) / zoom + y0]
  }
  const onDown = (e: React.MouseEvent) => {
    cv.current?.focus()
    const [mx, my] = pick(e)
    for (let i = shown.length - 1; i >= 0; i--) {
      const s = shown[i]
      const [bx, by, bw, bh] = thingBox(s.view)
      if (mx >= s.at.x + bx && mx < s.at.x + bx + bw && my >= s.at.y + by && my < s.at.y + by + bh) {
        useC.setState({ target: { kind: 'thing', id: s.t.id, desk: kind }, part: null })
        drag.current = { id: s.t.id, k: activeAt(s.view, has), mx, my, x: s.at.x, y: s.at.y }
        return
      }
    }
  }
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const [mx, my] = pick(e)
    d.moved = { x: d.x + Math.round(mx - d.mx), y: d.y + Math.round(my - d.my) }
    setLive({ id: d.id, ...d.moved })
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    setLive(null)
    if (!d?.moved || (d.moved.x === d.x && d.moved.y === d.y)) return
    const to = d.moved
    useC.getState().edit((f) => {
      const a = thingOf(f, d.id)?.views[kind]?.at[d.k]
      if (a) Object.assign(a, to)
    })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const s = shown.find((x) => x.t.id === sel)
    const step = e.shiftKey ? 8 : 1
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (!s || !mv[e.key]) return
    e.preventDefault()
    const [dx, dy] = mv[e.key]
    const k = activeAt(s.view, has)
    useC.getState().edit((f) => {
      const a = thingOf(f, s.t.id)?.views[kind]?.at[k]
      if (a) Object.assign(a, { x: a.x + dx, y: a.y + dy })
    })
  }

  return (
    <div className="view-ed">
      <div className="row small">
        <span className="dim">Xem trước</span>
        <button onClick={() => setZoom((z) => Math.max(2, z - 1))}>−</button> {zoom}× <button onClick={() => setZoom((z) => Math.min(9, z + 1))}>+</button>
        <span className="grow" />
        <span className="dim">Bấm chọn món · kéo / ←↑→↓ dời chỗ đặt (Shift: 8 px)</span>
      </div>
      <div className="preview">
        <canvas ref={cv} tabIndex={0} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onKeyDown={onKey} />
      </div>
    </div>
  )
}

// ───────────────────────── Cả phần đồ trên bàn ─────────────────────────

const ifName = (ids: string[], things: DeskThing[]) => ids.map((id) => { const t = things.find((x) => x.id === id); return t ? `${t.icon ?? ''} ${t.name}`.trim() : id }).join(' + ')

export function DeskThings() {
  const file = useC((s) => s.file)!
  const target = useC((s) => s.target)
  const kind = useC((s) => s.deskKind)
  const own = useC((s) => s.deskOwn)
  const things = file.desk.things
  const priced = things.filter((t) => t.price !== undefined)
  const sel = target?.kind === 'thing' ? things.find((t) => t.id === target.id) : undefined
  const select = (t: DeskThing) => {
    // Đồ để bàn agent mua: bật giả lập "đã có" để thấy món trên bàn
    const next = t.price !== undefined && !own.includes(t.id) ? [...own, t.id] : own
    useC.setState({ target: { kind: 'thing', id: t.id, desk: kind }, part: null, deskOwn: next })
  }
  const setKind = (k: DeskKind) => useC.setState((s) => ({ deskKind: k, part: null, ...(s.target?.kind === 'thing' ? { target: { ...s.target, desk: k } } : {}) }))
  const toggleOwn = (id: string, on: boolean) => useC.setState({ deskOwn: on ? [...own, id] : own.filter((x) => x !== id) })
  const addBlank = () => {
    let n = 1
    while (things.some((t) => t.id === `doBan${n}`)) n++
    const id = `doBan${n}`
    useC.getState().edit((f) => void f.desk.things.push({ id, name: 'Đồ để bàn mới', icon: '🎁', price: 50, level: 1, views: {} }))
    useC.setState({ target: { kind: 'thing', id, desk: kind }, part: null, deskOwn: [...own, id] })
  }
  return (
    <fieldset>
      <legend>Đồ trên bàn</legend>
      <p className="hint">Máy tính, bàn phím, cốc luôn có trên bàn; món có giá là đồ để bàn agent mua (bảng chọn khi trang trí). Bấm món trong khung để sửa, kéo để dời chỗ đặt.</p>
      <div className="tabs">
        {DESK_KINDS.map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)} title={KIND_INFO[k].hint}>{KIND_INFO[k].name}</button>)}
      </div>
      <p className="hint">{KIND_INFO[kind].hint}.</p>
      <div className="row small own">
        <span className="dim">Thử như agent đã mua:</span>
        {priced.map((t) => (
          <label key={t.id} className="check"><input type="checkbox" checked={own.includes(t.id)} onChange={(e) => toggleOwn(t.id, e.target.checked)} /> {t.icon} {t.name}</label>
        ))}
      </div>
      <DeskScene />
      <div className="things">
        {things.map((t) => {
          const v = t.views[kind] ?? t.views.back ?? t.views.front ?? t.views.side
          return (
            <button key={t.id} className={`li${sel?.id === t.id ? ' on' : ''}${thingProblems(t, things).length ? ' bad' : ''}`} onClick={() => select(t)}>
              {t.id === 'chair' ? <span className="thumb emoji">{t.icon}</span> : <Thumb view={v} fw={0} fh={0} size={28} />}
              <span>{t.name}<small>{t.price === undefined ? 'luôn có' : `${t.price} Xu · cấp ${t.level ?? 1}`}{!t.views[kind] && t.id !== 'chair' ? ' · không có ở kiểu bàn này' : ''}</small></span>
            </button>
          )
        })}
        <button className="li add" onClick={addBlank} title="Hoặc cắt hình rồi bấm ✨ Tạo đồ để bàn mới từ hình này">➕ Đồ để bàn mới</button>
      </div>
      {sel && <ThingForm key={sel.id} thing={sel} kind={kind} />}
    </fieldset>
  )
}

// ───────────────────────── Sửa một món trên bàn ─────────────────────────

function ThingForm({ thing, kind }: { thing: DeskThing; kind: DeskKind }) {
  const things = useC((s) => s.file!.desk.things)
  const own = useC((s) => s.deskOwn)
  const { edit } = useC.getState()
  const up = (fn: (t: DeskThing) => void) => edit((f) => { const t = thingOf(f, thing.id); if (t) fn(t) })
  const upView = (fn: (v: DeskThingView) => void) => up((t) => { const v = t.views[kind]; if (v) fn(v) })
  const view = thing.views[kind]
  const has = (id: string) => own.includes(id)
  const active = view ? activeAt(view, has) : -1
  const bad = thingProblems(thing, things)
  // Đồ khác đang bật trong giả lập: dùng làm điều kiện cho chỗ đặt riêng
  const others = own.filter((id) => id !== thing.id && things.some((t) => t.id === id && t.price !== undefined && t.id !== 'chair'))
  const sameIf = (a: DeskAt) => [...(a.if ?? [])].sort().join() === [...others].sort().join()
  const num = (v: string, min = -999) => Math.max(min, Math.round(+v) || 0)

  return (
    <div className="thing-form">
      <div className="row head">
        <input className="title" value={thing.name} onChange={(e) => up((t) => { t.name = e.target.value })} />
      </div>
      <div className="row small"><span className="dim">Mã: {thing.id}</span>{thing.id === 'chair' && <span className="dim">· hình ghế da sửa ở phần Ghế bên dưới</span>}</div>
      {bad.length > 0 && <div className="warn">{bad.join(' · ')}</div>}
      {thing.price !== undefined ? (
        <div className="row small">
          <label>Biểu tượng <input value={thing.icon ?? ''} style={{ width: 44 }} onChange={(e) => up((t) => { t.icon = e.target.value })} /></label>
          <label>Giá <input type="number" min={0} value={thing.price} onChange={(e) => up((t) => { t.price = num(e.target.value, 0) })} /> Xu</label>
          <label title="Agent đạt cấp này mới mua được">Mở ở cấp <input type="number" min={1} max={99} value={thing.level ?? 1} onChange={(e) => up((t) => { t.level = num(e.target.value, 1) })} /></label>
        </div>
      ) : <p className="hint">Luôn có trên bàn mọi agent (không bán).</p>}
      {thing.id !== 'chair' && (
        <label className="check"><input type="checkbox" checked={thing.price !== undefined} onChange={(e) => up((t) => { if (e.target.checked) { t.price = 50; t.level = 1; t.icon ??= '🎁' } else { delete t.price; delete t.level } })} /> Agent phải mua (đồ để bàn); bỏ chọn = luôn có trên bàn</label>
      )}
      {thing.id !== 'chair' && (
        <label className="check" title="Quầng sáng ấm ban đêm như đèn bàn">
          <input type="checkbox" checked={!!thing.light} onChange={(e) => up((t) => { if (e.target.checked) t.light = [0, -10]; else delete t.light })} /> Toả sáng ban đêm
          {thing.light && <> · tâm x <input type="number" value={thing.light[0]} onChange={(e) => up((t) => { t.light = [num(e.target.value), t.light![1]] })} /> y <input type="number" value={thing.light[1]} onChange={(e) => up((t) => { t.light = [t.light![0], num(e.target.value)] })} /></>}
        </label>
      )}

      {thing.id !== 'chair' && (!view ? (
        <div className="hint">
          <p>Món này không có hình ở kiểu bàn <b>{KIND_INFO[kind].name}</b> (không vẽ). Cắt hình rồi bấm <b>➕ Thêm mảnh</b>, hoặc:</p>
          <div className="row">
            {DESK_KINDS.filter((k) => k !== kind && thing.views[k]).map((k) => (
              <button key={k} onClick={() => up((t) => {
                const src = structuredClone(t.views[k]!)
                // Bàn ngang khác cỡ: đặt lại giữa bàn
                t.views[kind] = { ...src, at: (k === 'side') === (kind === 'side') ? src.at : [{ ...DESK_MID[kind] }] }
              })}>Chép hình từ "{KIND_INFO[k].name}"</button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="opts">
            <div className="row">
              <label className="check"><input type="checkbox" checked={!!view.flip} onChange={(e) => upView((v) => { if (e.target.checked) v.flip = true; else delete v.flip })} /> Lật gương</label>
              <label className="check" title="Mặt màn hình đổi theo trạng thái agent (đang chạy: chữ chạy, rảnh: màn chờ, lỗi: nháy đỏ); tính từ điểm neo, không lật">
                <input type="checkbox" checked={!!view.screen} onChange={(e) => upView((v) => { if (e.target.checked) v.screen = [-6, -13, 12, 7]; else delete v.screen })} /> Có màn hình sáng
              </label>
              <span className="grow" />
              <button onClick={() => { if (confirm(`Bỏ hình "${thing.name}" ở kiểu bàn này?`)) up((t) => void delete t.views[kind]) }}>Bỏ hình ở kiểu bàn này</button>
            </div>
            {view.screen && (
              <div className="row small">
                mặt màn hình: x <input type="number" value={view.screen[0]} onChange={(e) => upView((v) => { v.screen![0] = num(e.target.value) })} />
                y <input type="number" value={view.screen[1]} onChange={(e) => upView((v) => { v.screen![1] = num(e.target.value) })} />
                rộng <input type="number" min={1} value={view.screen[2]} onChange={(e) => upView((v) => { v.screen![2] = num(e.target.value, 1) })} />
                cao <input type="number" min={1} value={view.screen[3]} onChange={(e) => upView((v) => { v.screen![3] = num(e.target.value, 1) })} />
                <span className="dim">(rộng / cao dưới 3: chỉ một vệt sáng)</span>
              </div>
            )}
          </div>
          <div className="at-list">
            <div className="row small"><b>Chỗ đặt trên bàn</b><span className="dim">(điểm neo, pixel từ góc trên trái mặt bàn)</span></div>
            {view.at.map((a, k) => (
              <div key={k} className={`at${k === active ? ' on' : ''}`}>
                <span className="at-name">{a.if?.length ? <>Khi có {ifName(a.if, things)}</> : 'Mặc định'}{k === active && <span className="tag new">đang dùng</span>}</span>
                <label>x <input type="number" value={a.x} onChange={(e) => upView((v) => { v.at[k].x = num(e.target.value) })} /></label>
                <label>y <input type="number" value={a.y} onChange={(e) => upView((v) => { v.at[k].y = num(e.target.value) })} /></label>
                {!!a.if?.length && (
                  <>
                    <label className="check" title="Bàn chật: không vẽ món này"><input type="checkbox" checked={!!a.hide} onChange={(e) => upView((v) => { if (e.target.checked) v.at[k].hide = true; else delete v.at[k].hide })} /> Ẩn</label>
                    <button title="Xoá chỗ đặt riêng này" onClick={() => upView((v) => void v.at.splice(k, 1))}>🗑</button>
                  </>
                )}
              </div>
            ))}
            <button className="wrap" disabled={!others.length || view.at.some(sameIf)} onClick={() => {
              const cur = view.at[active] ?? view.at[0]
              upView((v) => void v.at.unshift({ x: cur?.x ?? 0, y: cur?.y ?? 0, if: [...others] }))
            }} title="Bàn chật: khi agent có đủ các đồ đang bật ở trên thì món này đặt chỗ khác (hoặc ẩn)">
              ➕ Chỗ riêng khi có {others.length ? ifName(others, things) : '… (bật vài đồ ở trên trước)'}
            </button>
          </div>
          <div className="row small"><b>Mảnh hình</b><span className="dim">x, y so với điểm neo</span></div>
          <PartList view={view} onChange={(v) => upView((cur) => { cur.parts = v.parts })} />
        </>
      ))}

      <button className="danger" onClick={() => {
        const why = thing.id === 'chair' ? 'Ghế da sẽ không mua được nữa (agent đã mua thì về ghế thường).'
          : thing.id === 'trophy' ? 'Agent đã mua sẽ mất cúp và nẹp vàng trên bàn.'
          : thing.price !== undefined ? 'Agent đã mua món này sẽ không thấy nó nữa (không hoàn Xu).' : 'Món này sẽ biến khỏi bàn của mọi agent.'
        if (!confirm(`Xoá "${thing.name}" khỏi bàn làm việc? ${why}
Chưa lưu thì vẫn hoàn tác được (Ctrl+Z).`)) return
        edit((f) => {
          f.desk.things = f.desk.things.filter((t) => t.id !== thing.id)
          // Chỗ đặt riêng "khi có món này" của các món khác: không còn dùng tới
          for (const t of f.desk.things) for (const v of Object.values(t.views)) if (v) v.at = v.at.filter((a) => !a.if?.includes(thing.id))
        })
        useC.setState((s) => ({ target: { kind: 'chair', key: 'front' }, part: null, deskOwn: s.deskOwn.filter((x) => x !== thing.id) }))
      }}>🗑 Xoá khỏi bàn làm việc</button>
    </div>
  )
}
