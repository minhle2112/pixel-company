import { useEffect, useMemo, useRef, useState } from 'react'
import { DESK_KINDS, partWH, type Part, type Src, type View } from '../data/catalog'
import { assetUrl, checker, img, onImage } from './draw'
import { DESK_MID, itemOf, setViewAt, useC, viewAt, type Target } from './store'

// ───────────────────────── Chọn ảnh LimeZu ─────────────────────────

interface Folder { name: string; path: string; dirs: Map<string, Folder>; files: string[] }

function tree(list: string[]): Folder {
  const root: Folder = { name: '', path: '', dirs: new Map(), files: [] }
  for (const f of list) {
    const segs = f.split('/')
    let cur = root
    for (const s of segs.slice(0, -1)) {
      let d = cur.dirs.get(s)
      if (!d) cur.dirs.set(s, (d = { name: s, path: cur.path ? `${cur.path}/${s}` : s, dirs: new Map(), files: [] }))
      cur = d
    }
    cur.files.push(f)
  }
  return root
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function SheetPicker() {
  const [list, setList] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set(['1_Interiors', '1_Interiors/16x16', 'Modern_Office']))
  const sheet = useC((s) => s.sheet)
  const file = useC((s) => s.file)
  useEffect(() => {
    fetch('/__cutter/sheets').then((r) => r.json()).then(setList, () => setList([]))
  }, [])
  const root = useMemo(() => tree(list), [list])
  // Ảnh các món đang dùng: mở nhanh
  const used = useMemo(() => {
    const s = new Set<string>()
    const add = (v?: View | null) => v?.parts.forEach((p) => p.src && s.add(p.src[0]))
    file?.items.forEach((i) => i.art.views?.forEach(add))
    if (file) Object.values(file.desk.chair).forEach(add)
    file?.desk.things.forEach((t) => Object.values(t.views).forEach(add))
    if (file) s.add(file.desk.top.src[0])
    return [...s].sort()
  }, [file])
  const pick = (f: string) => useC.setState({ sheet: f, cut: null })
  const toggle = (p: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(p)) n.delete(p)
    else n.add(p)
    return n
  })
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = words.length ? list.filter((f) => words.every((w) => f.toLowerCase().includes(w))).slice(0, 400) : []

  const renderDir = (d: Folder, depth: number): React.ReactNode => (
    <>
      {[...d.dirs.values()].map((c) => (
        <div key={c.path}>
          <button className="tree-dir" style={{ paddingLeft: 6 + depth * 12 }} onClick={() => toggle(c.path)}>
            {open.has(c.path) ? '▾' : '▸'} {c.name}
          </button>
          {open.has(c.path) && renderDir(c, depth + 1)}
        </div>
      ))}
      {d.files.map((f) => (
        <button key={f} className={`tree-file${f === sheet ? ' on' : ''}`} style={{ paddingLeft: 18 + depth * 12 }} onClick={() => pick(f)} title={f}>
          {base(f)}
        </button>
      ))}
    </>
  )

  return (
    <div className="picker">
      <input className="search" placeholder="Tìm ảnh: kitchen, office, sofa, 12_…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tree">
        {words.length ? (
          hits.length ? hits.map((f) => (
            <button key={f} className={`tree-file${f === sheet ? ' on' : ''}`} onClick={() => pick(f)} title={f}>
              {base(f)}
              <small>{f.slice(0, f.lastIndexOf('/'))}</small>
            </button>
          )) : <p className="hint">Không có ảnh nào khớp.</p>
        ) : (
          <>
            {used.length > 0 && (
              <div>
                <button className="tree-dir" onClick={() => toggle('__used')}>{open.has('__used') ? '▾' : '▸'} ⭐ Ảnh game đang dùng</button>
                {open.has('__used') && used.map((f) => (
                  <button key={f} className={`tree-file${f === sheet ? ' on' : ''}`} style={{ paddingLeft: 18 }} onClick={() => pick(f)} title={f}>{base(f)}</button>
                ))}
              </div>
            )}
            {renderDir(root, 0)}
          </>
        )}
      </div>
      <p className="hint">Mẹo: thư mục <b>…_Singles</b> có sẵn từng món một ảnh. Ảnh lớn (Theme_Sorter, Modern_Office_16x16) gom nhiều món, bấm vào món để cắt.</p>
    </div>
  )
}

// ───────────────────────── Xem ảnh, cắt vùng ─────────────────────────

/** Khung bao phần không trong suốt trong vùng (x, y, w, h); null nếu trong suốt hết */
function trim(d: ImageData, x: number, y: number, w: number, h: number): Src | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let j = Math.max(0, y); j < Math.min(d.height, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(d.width, x + w); i++)
      if (d.data[(j * d.width + i) * 4 + 3] > 0) {
        if (i < x0) x0 = i
        if (i > x1) x1 = i
        if (j < y0) y0 = j
        if (j > y1) y1 = j
      }
  return x1 < 0 ? null : ['', x0, y0, x1 - x0 + 1, y1 - y0 + 1]
}

/** Vùng liền nhau (8 hướng, cho phép khe hở `gap` pixel) quanh điểm bấm: khung bao */
function component(d: ImageData, x: number, y: number, gap: number): Src | null {
  const { width: W, height: H, data } = d
  const op = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && data[(j * W + i) * 4 + 3] > 0
  // Bấm trượt vào chỗ trong suốt sát món: tìm điểm có hình gần nhất trong 3 px
  if (!op(x, y)) {
    let best: [number, number] | null = null
    for (let r = 1; r <= 3 && !best; r++)
      for (let j = y - r; j <= y + r && !best; j++) for (let i = x - r; i <= x + r; i++) if (op(i, j)) { best = [i, j]; break }
    if (!best) return null
    ;[x, y] = best
  }
  const seen = new Uint8Array(W * H)
  const q = [y * W + x]
  seen[q[0]] = 1
  let x0 = x, x1 = x, y0 = y, y1 = y
  const R = 1 + gap
  for (let n = 0; n < q.length && n < 600_000; n++) {
    const i = q[n] % W, j = (q[n] - i) / W
    if (i < x0) x0 = i
    if (i > x1) x1 = i
    if (j < y0) y0 = j
    if (j > y1) y1 = j
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const a = i + di, b = j + dj
        if (!op(a, b)) continue
        const k = b * W + a
        if (!seen[k]) { seen[k] = 1; q.push(k) }
      }
  }
  return ['', x0, y0, x1 - x0 + 1, y1 - y0 + 1]
}

const union = (a: Src, b: Src): Src => {
  const x0 = Math.min(a[1], b[1]), y0 = Math.min(a[2], b[2])
  return [a[0], x0, y0, Math.max(a[1] + a[3], b[1] + b[3]) - x0, Math.max(a[2] + a[4], b[2] + b[4]) - y0]
}

export function SheetView() {
  const sheet = useC((s) => s.sheet)
  const cut = useC((s) => s.cut)
  const frames = useC((s) => s.frames)
  const file = useC((s) => s.file)
  const [zoom, setZoom] = useState(3)
  const [grid, setGrid] = useState(true)
  const [tight, setTight] = useState(true)
  const [gap, setGap] = useState(0)
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number; moved: boolean; shift: boolean } | null>(null)
  const [, redraw] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const pixels = useRef<ImageData | null>(null)
  const im = sheet ? img(sheet) : null

  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  // Đọc điểm ảnh để dò mép hình
  useEffect(() => {
    pixels.current = null
    if (!im) return
    const c = document.createElement('canvas')
    c.width = im.naturalWidth
    c.height = im.naturalHeight
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(im, 0, 0)
    pixels.current = g.getImageData(0, 0, c.width, c.height)
  }, [im])
  useEffect(() => {
    if (box.current) box.current.scrollTo(0, 0)
  }, [sheet])

  // Vùng các món đang dùng trong ảnh này
  const used = useMemo(() => {
    const out: Src[] = []
    const add = (v?: View | null) => v?.parts.forEach((p) => {
      if (p.src?.[0] === sheet) out.push(p.src)
    })
    file?.items.forEach((i) => i.art.views?.forEach(add))
    if (file) Object.values(file.desk.chair).forEach(add)
    file?.desk.things.forEach((t) => Object.values(t.views).forEach(add))
    if (file?.desk.top.src[0] === sheet) out.push(file.desk.top.src)
    return out
  }, [file, sheet])

  const draw = () => {
    const c = cv.current, b = box.current
    if (!c || !b) return
    const W = b.clientWidth, H = b.clientHeight
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    c.style.left = `${b.scrollLeft}px`
    c.style.top = `${b.scrollTop}px`
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.setTransform(1, 0, 0, 1, 0, 0)
    checker(g, W, H, 8)
    if (!im) return
    const sx = b.scrollLeft, sy = b.scrollTop
    g.setTransform(zoom, 0, 0, zoom, -sx, -sy)
    g.drawImage(im, 0, 0)
    g.setTransform(1, 0, 0, 1, 0, 0)
    const X = (x: number) => Math.round(x * zoom - sx) + 0.5, Y = (y: number) => Math.round(y * zoom - sy) + 0.5
    if (grid && zoom >= 2) {
      g.strokeStyle = 'rgba(255,255,255,0.12)'
      g.beginPath()
      const c0 = Math.floor(sx / zoom / 16), c1 = Math.ceil((sx + W) / zoom / 16)
      const r0 = Math.floor(sy / zoom / 16), r1 = Math.ceil((sy + H) / zoom / 16)
      for (let i = c0; i <= Math.min(c1, im.naturalWidth / 16); i++) { g.moveTo(X(i * 16), Y(r0 * 16)); g.lineTo(X(i * 16), Y(Math.min(r1 * 16, im.naturalHeight))) }
      for (let j = r0; j <= Math.min(r1, im.naturalHeight / 16); j++) { g.moveTo(X(c0 * 16), Y(j * 16)); g.lineTo(X(Math.min(c1 * 16, im.naturalWidth)), Y(j * 16)) }
      g.stroke()
    }
    const rect = (r: Src | [string, number, number, number, number], color: string, dash: number[] = []) => {
      g.setLineDash(dash)
      g.strokeStyle = color
      g.strokeRect(X(r[1]) - 1, Y(r[2]) - 1, r[3] * zoom + 1, r[4] * zoom + 1)
      g.setLineDash([])
    }
    for (const u of used) rect(u, 'rgba(110,170,255,0.7)', [3, 3])
    if (cut && cut[0] === sheet) {
      for (let f = 1; f < frames; f++) rect([sheet, cut[1] + f * cut[3], cut[2], cut[3], cut[4]], 'rgba(242,181,68,0.55)', [2, 2])
      rect(cut, '#f2b544')
    }
    if (drag?.moved) {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1)
      rect([sheet!, x, y, Math.abs(drag.x1 - drag.x0) + 1, Math.abs(drag.y1 - drag.y0) + 1], '#fff', [4, 2])
    }
  }
  useEffect(draw)

  const at = (e: React.MouseEvent): [number, number] => {
    const b = box.current!.getBoundingClientRect()
    return [Math.floor((e.clientX - b.left + box.current!.scrollLeft) / zoom), Math.floor((e.clientY - b.top + box.current!.scrollTop) / zoom)]
  }
  const setCut = (r: Src | null, shift: boolean) => {
    if (!r || !sheet) return
    const s: Src = [sheet, r[1], r[2], r[3], r[4]]
    const prev = useC.getState().cut
    useC.setState({ cut: shift && prev && prev[0] === sheet ? union(prev, s) : s, frames: shift ? useC.getState().frames : 1 })
  }
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !im) return
    const [x, y] = at(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y, moved: false, shift: e.shiftKey })
  }
  const onMove = (e: React.MouseEvent) => {
    const p = at(e)
    setHover(p)
    if (drag) setDrag({ ...drag, x1: p[0], y1: p[1], moved: drag.moved || Math.abs(p[0] - drag.x0) + Math.abs(p[1] - drag.y0) > 1 })
  }
  const onUp = () => {
    if (!drag) return
    const d = pixels.current
    if (drag.moved) {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1)
      const w = Math.abs(drag.x1 - drag.x0) + 1, h = Math.abs(drag.y1 - drag.y0) + 1
      setCut(tight && d ? trim(d, x, y, w, h) : ['', x, y, w, h], drag.shift)
    } else if (d) {
      const r = component(d, drag.x0, drag.y0, gap)
      if (r) setCut(r, drag.shift)
      else useC.getState().toast('Chỗ này trong suốt: bấm vào giữa món, hoặc kéo khung bao quanh món.')
    }
    setDrag(null)
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const b = box.current!
    const r = b.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const ix = (b.scrollLeft + mx) / zoom, iy = (b.scrollTop + my) / zoom
    const z = Math.max(1, Math.min(10, zoom + (e.deltaY < 0 ? 1 : -1)))
    setZoom(z)
    requestAnimationFrame(() => b.scrollTo(ix * z - mx, iy * z - my))
  }
  // Ctrl + lăn chuột: phóng to (chặn trình duyệt tự phóng cả trang)
  useEffect(() => {
    const b = box.current
    if (!b) return
    const stop = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault() }
    b.addEventListener('wheel', stop, { passive: false })
    return () => b.removeEventListener('wheel', stop)
  }, [])

  return (
    <div className="sheet">
      <div className="bar">
        <b className="sheet-name" title={sheet ?? ''}>{sheet ? base(sheet) : 'Chọn một ảnh bên trái'}</b>
        {im && <span className="dim">{im.naturalWidth}×{im.naturalHeight}</span>}
        <span className="grow" />
        <label title="Ctrl + lăn chuột cũng phóng to được">Phóng <button onClick={() => setZoom((z) => Math.max(1, z - 1))}>−</button> {zoom}× <button onClick={() => setZoom((z) => Math.min(10, z + 1))}>+</button></label>
        <label><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Lưới 16 px</label>
        <label title="Kéo khung: tự thu sát phần có hình"><input type="checkbox" checked={tight} onChange={(e) => setTight(e.target.checked)} /> Cắt sát</label>
        <label title="Bấm vào món: gom cả các phần cách nhau tối đa bấy nhiêu pixel">Nối khe <input type="number" min={0} max={4} value={gap} onChange={(e) => setGap(Math.max(0, Math.min(4, +e.target.value || 0)))} /> px</label>
      </div>
      <div className="sheet-box" ref={box} onScroll={draw} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { setHover(null); onUp() }} onWheel={onWheel}>
        <div style={{ position: 'relative', width: (im?.naturalWidth ?? 0) * zoom, height: (im?.naturalHeight ?? 0) * zoom }}>
          <canvas ref={cv} style={{ position: 'absolute' }} />
        </div>
      </div>
      <div className="bar dim small">
        {hover ? `x ${hover[0]}, y ${hover[1]} · ô (${Math.floor(hover[0] / 16)}, ${Math.floor(hover[1] / 16)})` : ' '}
        <span className="grow" />
        Bấm vào món: cắt sát · Kéo: cắt theo khung · Shift: gộp thêm vùng · Khung xanh nét đứt: hình game đang dùng
      </div>
    </div>
  )
}

// ───────────────────────── Vùng đang cắt → đưa vào món ─────────────────────────

/** Chỗ đặt mảnh mới: căn giữa, chân ở điểm neo (đồ treo tường: cách mép trên tường 4 px) */
function placeNew(src: Src, t: Target): Part {
  const f = useC.getState().file!
  const wall = t.kind === 'item' && itemOf(f, t.id)?.mount === 'wall'
  return { src, x: Math.round(-src[3] / 2), y: wall ? 4 : t.kind === 'chair' ? 3 - src[4] : -src[4] }
}

export function CutPanel() {
  const cut = useC((s) => s.cut)
  const frames = useC((s) => s.frames)
  const target = useC((s) => s.target)
  const part = useC((s) => s.part)
  const file = useC((s) => s.file)
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  useEffect(() => {
    const c = cv.current
    if (!c || !cut) return
    const w = cut[3] * frames, h = cut[4]
    const z = Math.max(1, Math.min(6, Math.floor(Math.min(260 / w, 110 / h))))
    c.width = w * z
    c.height = h * z
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    checker(g, c.width, c.height, 4)
    const im = img(cut[0])
    if (im) g.drawImage(im, cut[1], cut[2], w, h, 0, 0, w * z, h * z)
  })
  if (!cut) return <div className="cut empty">Chưa cắt vùng nào. Bấm vào một món trong ảnh để cắt.</div>

  const setNum = (k: 1 | 2 | 3 | 4, v: number) => {
    const n = [...cut] as Src
    n[k] = Math.max(k >= 3 ? 1 : 0, Math.round(v) || 0)
    useC.setState({ cut: n })
  }
  const src: Src = [...cut]
  const withAnim = (p: Part): Part => (frames > 1 ? { ...p, frames, speed: p.speed ?? 0.08 } : (({ frames: _f, speed: _s, ...rest }) => rest)(p))
  const { edit, toast } = useC.getState()
  const view = file && target && target.kind !== 'desk' ? viewAt(file, target) : null
  const canPart = !!target && target.kind !== 'desk'
  const isCode = !!(target?.kind === 'item' && file && itemOf(file, target.id)?.art.code)

  const add = () => {
    if (!target || target.kind === 'desk') return
    edit((f) => {
      const v: View = viewAt(f, target) ? structuredClone(viewAt(f, target)!) : { parts: [] }
      v.parts.push(withAnim(placeNew(src, target)))
      setViewAt(f, target, v)
    })
    useC.setState({ part: (view?.parts.length ?? 0) })
    toast('Đã thêm mảnh. Kéo mảnh trong khung xem trước để chỉnh chỗ.')
  }
  const replace = () => {
    if (!target || target.kind === 'desk' || part === null || !view?.parts[part]) return
    edit((f) => {
      const v = structuredClone(viewAt(f, target)!)
      const o = v.parts[part]
      // Giữ nguyên giữa mép dưới của mảnh cũ
      const [ow, oh] = partWH(o)
      const { box: _b, ...rest } = o
      v.parts[part] = withAnim({ ...rest, src, x: o.x + Math.round((ow - src[3]) / 2), y: o.y + oh - src[4] })
      setViewAt(f, target, v)
    })
  }
  const useDesk = () => {
    if (target?.kind !== 'desk') return
    edit((f) => {
      const old = target.key === 'top' ? f.desk.top : f.desk.side ?? f.desk.top
      const m = { l: Math.min(old.l, src[3] >> 1), r: Math.min(old.r, src[3] >> 1), t: Math.min(old.t, src[4] >> 1), b: Math.min(old.b, src[4] >> 1) }
      const top = { src, ...m }
      if (target.key === 'top') f.desk.top = top
      else f.desk.side = top
    })
    toast('Đã đổi hình mặt bàn. Chỉnh 4 mép giữ nguyên bên phải.')
  }
  const newItem = () => {
    const f = useC.getState().file!
    let n = 1
    while (f.items.some((i) => i.id === `mon${n}`)) n++
    const id = `mon${n}`
    edit((f) => {
      f.items.push({ id, name: 'Món mới', group: 'plant', price: 50, w: Math.max(1, Math.round(src[3] / 16)), d: 1, mount: 'floor', turn: 'none', h: 1, art: { views: [{ parts: [withAnim({ src, x: Math.round(-src[3] / 2), y: -src[4] })] }] } })
    })
    useC.setState({ target: { kind: 'item', id, rot: 0 }, part: 0 })
    toast('Đã tạo món mới: đặt tên, giá, cỡ ở bên phải rồi bấm Lưu.')
  }
  const deskSide = target?.kind === 'desk' || target?.kind === 'chair' || target?.kind === 'thing'
  const newThing = () => {
    const f = useC.getState().file!
    let n = 1
    while (f.desk.things.some((t) => t.id === `doBan${n}`)) n++
    const id = `doBan${n}`
    const part = withAnim({ src, x: Math.round(-src[3] / 2), y: -src[4] })
    edit((f) => {
      const views = Object.fromEntries(DESK_KINDS.map((k) => [k, { parts: [structuredClone(part)], at: [{ ...DESK_MID[k] }] }]))
      f.desk.things.push({ id, name: 'Đồ để bàn mới', icon: '🎁', price: 50, level: 1, views })
    })
    const { deskOwn, deskKind } = useC.getState()
    useC.setState({ target: { kind: 'thing', id, desk: deskKind }, part: 0, deskOwn: [...deskOwn, id] })
    toast('Đã tạo đồ để bàn mới (đủ 3 kiểu bàn): kéo món trên bàn cho đúng chỗ, đặt tên, giá rồi bấm Lưu.')
  }

  return (
    <div className="cut">
      <canvas ref={cv} className="pix" />
      <div className="cut-info">
        <div className="row">
          {(['x', 'y', 'rộng', 'cao'] as const).map((l, k) => (
            <label key={l}>{l} <input type="number" value={cut[k + 1]} onChange={(e) => setNum((k + 1) as 1 | 2 | 3 | 4, +e.target.value)} /></label>
          ))}
          <label title="Hình động: số khung xếp ngang liền nhau (khung đầu là vùng đang cắt)">Số khung <input type="number" min={1} max={60} value={frames} onChange={(e) => useC.setState({ frames: Math.max(1, Math.min(60, Math.round(+e.target.value) || 1)) })} /></label>
        </div>
        <div className="row">
          {canPart && !isCode && <button className="primary" onClick={add} title="Thêm vào hình đang sửa bên phải">➕ Thêm mảnh vào hình đang sửa</button>}
          {canPart && !isCode && part !== null && view?.parts[part] && <button onClick={replace}>🔁 Thay hình mảnh #{part + 1}</button>}
          {target?.kind === 'desk' && <button className="primary" onClick={useDesk}>🪑 Dùng làm {target.key === 'top' ? 'mặt bàn' : 'mặt bàn quay ngang'}</button>}
          {deskSide ? <button onClick={newThing}>✨ Tạo đồ để bàn mới từ hình này</button> : <button onClick={newItem}>✨ Tạo món mới từ hình này</button>}
          <a className="dim small" href={assetUrl(cut[0])} target="_blank" rel="noreferrer">mở ảnh gốc ↗</a>
        </div>
      </div>
    </div>
  )
}
