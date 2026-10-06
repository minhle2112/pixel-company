import { useEffect, useMemo, useRef, useState } from 'react'
import { GROUPS, footprint, rotations, type DeskTop, type Group, type Item, type Mount, type Turn, type Use, type View } from '../data/catalog'
import type { Activity } from '../world/room'
import { checker, drawFit, drawView, img, onImage, viewBox } from './draw'
import { ID_RE, itemOf, itemProblems, setViewAt, useC, viewAt, type ChairKey, type Target } from './store'
import { DeskThings } from './DeskThings'
import { ViewEditor, type Ctx } from './ViewEditor'

/** Pixel mỗi mét, ô lưới (m), giống game (src/pixel/geom.ts, src/data/officeState.ts) */
const PPM = 32
const CELL = 0.5
const ROT_NAME = ['↓ Nhìn xuống', '← Nhìn trái', '↑ Nhìn lên', '→ Nhìn phải']
const LEATHER = '#b07a5a'

// ───────────────────────── Ảnh nhỏ ─────────────────────────

export function Thumb({ view, fw, fh, size = 36 }: { view?: View | null; fw: number; fh: number; size?: number }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  useEffect(() => {
    const c = cv.current
    if (!c) return
    c.width = c.height = size
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, size, size)
    if (!view?.parts.length) return
    const [x, y, w, h] = viewBox(view, fw, fh)
    const z = Math.min(2, size / Math.max(w, h))
    g.setTransform(z, 0, 0, z, (size - w * z) / 2 - x * z, (size - h * z) / 2 - y * z)
    drawView(g, view, !!view.flip, fw, fh)
  })
  return <canvas ref={cv} className="thumb" />
}

const itemThumbView = (i: Item) => (i.art.views?.[0] ?? null)
const footPx = (i: Item, rot = 0) => {
  const { w, d } = footprint(i, rot)
  return i.mount === 'wall' ? { fw: i.w * 16, fh: 0 } : { fw: w * 16, fh: d * 16 }
}

// ───────────────────────── Danh sách ─────────────────────────

export function TargetList() {
  const file = useC((s) => s.file)
  const target = useC((s) => s.target)
  const [q, setQ] = useState('')
  const body = useRef<HTMLDivElement>(null)
  // Món vừa chọn / vừa tạo: cuộn tới
  useEffect(() => {
    body.current?.querySelector('.li.on')?.scrollIntoView({ block: 'nearest' })
  }, [target, file?.items.length])
  if (!file) return null
  const words = q.trim().toLowerCase()
  const items = file.items.filter((i) => !words || i.name.toLowerCase().includes(words) || i.id.toLowerCase().includes(words))
  const select = (t: Target) => useC.setState({ target: t, part: null })
  const addBlank = () => {
    let n = 1
    while (file.items.some((i) => i.id === `mon${n}`)) n++
    const id = `mon${n}`
    useC.getState().edit((f) => void f.items.push({ id, name: 'Món mới', group: 'plant', price: 50, w: 1, d: 1, mount: 'floor', turn: 'none', h: 1, art: { views: [{ parts: [] }] } }))
    select({ kind: 'item', id, rot: 0 })
  }
  return (
    <div className="list">
      <div className="row">
        <input className="search" placeholder="Tìm món…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={addBlank} title="Món mới chưa có hình">➕ Món mới</button>
      </div>
      <div className="list-body" ref={body}>
        <button className={`li${target?.kind === 'desk' || target?.kind === 'chair' || target?.kind === 'thing' ? ' on' : ''}`} onClick={() => select({ kind: 'chair', key: 'front' })}>
          <Thumb view={file.desk.chair.front} fw={0} fh={0} />
          <span>Bàn ghế làm việc<small>bàn, máy tính, đồ để bàn, ghế</small></span>
        </button>
        {GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g.id)
          if (!list.length) return null
          return (
            <div key={g.id}>
              <div className="group">{g.icon} {g.name}</div>
              {list.map((i) => (
                <button key={i.id} className={`li${target?.kind === 'item' && target.id === i.id ? ' on' : ''}${itemProblems(i, file.items).length ? ' bad' : ''}`} onClick={() => select({ kind: 'item', id: i.id, rot: 0 })}>
                  <Thumb view={itemThumbView(i)} {...footPx(i)} />
                  <span>{i.name}<small>{i.price} Xu · {i.id}</small></span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ───────────────────────── Sửa một món ─────────────────────────

const MOUNTS: { id: Mount; name: string }[] = [
  { id: 'floor', name: 'Đặt trên sàn (chặn đường)' },
  { id: 'rug', name: 'Thảm (đi qua được, đồ khác đặt lên được)' },
  { id: 'wall', name: 'Treo tường bắc' },
]
const TURNS: { id: Turn; name: string }[] = [
  { id: 'none', name: 'Không xoay' },
  { id: 'flip', name: 'Lật trái / phải (tự lật gương)' },
  { id: 'two', name: '2 hướng: quay mặt / quay lưng' },
  { id: 'four', name: '4 hướng (cần hình đủ 4 hướng)' },
]
const USES: { id: Use['kind'] | 'none'; name: string; hint: string }[] = [
  { id: 'none', name: 'Chỉ để trang trí', hint: '' },
  { id: 'seat', name: 'Ngồi được', hint: 'Ghế, sofa, ghế đẩu: agent và bạn ngồi lên (bấm E)' },
  { id: 'stand', name: 'Đứng dùng', hint: 'Máy pha cà phê, tủ lạnh, kệ sách: đứng trước mặt món mà dùng' },
  { id: 'pair', name: 'Hai người hai đầu', hint: 'Bàn bóng bàn, bi-a: hai chỗ ở hai đầu cạnh dài' },
  { id: 'pet', name: 'Vuốt ve', hint: 'Thú cưng: một chỗ ngồi xổm phía trước' },
  { id: 'watch', name: 'Đứng xem từ xa', hint: 'Đồ treo tường (TV): hai chỗ đứng cách tường' },
  { id: 'bed', name: 'Nằm ngủ', hint: 'Giường một người, đầu giường phía bắc: đầu agent đặt ở ô trên cùng; đặt "front" = số hàng pixel của chăn để chăn đắp đè lên người' },
]
const ACTS: Record<Use['kind'], { id: Activity; name: string }[]> = {
  seat: [{ id: 'sofa', name: 'Ngồi thư giãn (sofa, ghế bành)' }, { id: 'stool', name: 'Ngồi ghế đẩu / ghế băng' }, { id: 'meeting', name: 'Ngồi họp' }, { id: 'beanbag', name: 'Ngồi ghế lười' }],
  stand: [
    { id: 'coffee', name: 'Pha cà phê' }, { id: 'water', name: 'Uống nước' }, { id: 'snack', name: 'Ăn vặt' }, { id: 'fridge', name: 'Mở tủ lạnh' },
    { id: 'cook', name: 'Nấu ăn' }, { id: 'game', name: 'Chơi game' }, { id: 'books', name: 'Đọc sách' }, { id: 'board', name: 'Viết bảng' }, { id: 'tv', name: 'Xem TV' },
  ],
  pair: [{ id: 'foos', name: 'Chơi bóng bàn' }, { id: 'pool', name: 'Chơi bi-a' }],
  pet: [{ id: 'pet', name: 'Vuốt ve thú cưng' }],
  watch: [{ id: 'tv', name: 'Xem TV' }],
  bed: [{ id: 'sleep', name: 'Ngủ' }],
}

/** Hướng mặt món theo rot: 0 xuống, 1 trái, 2 lên, 3 phải (như src/life/spots.ts) */
const FACE = [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }]

/** Chỗ ngồi / đứng của món ở hướng rot, pixel so với điểm neo (cùng công thức với src/life/spots.ts) */
function spotsOf(i: Item, rot: number): { seats: { x: number; y: number }[]; stands: { x: number; y: number }[]; behind: boolean } {
  const out = { seats: [] as { x: number; y: number }[], stands: [] as { x: number; y: number }[], behind: false }
  const u = i.use
  if (!u || i.mount === 'wall') return out
  const { w, d } = footprint(i, rot)
  const f = i.turn === 'four' || i.turn === 'two' ? FACE[rot] ?? FACE[0] : FACE[0]
  const lat = { x: -f.z, z: f.x }
  const cx = 0, cz = -(d * CELL) / 2
  const depth = (f.x ? w : d) * CELL
  const P = (x: number, z: number) => ({ x: Math.round(x * PPM), y: Math.round(z * PPM) })
  if (u.kind === 'seat') {
    const fwd = depth / 2 - CELL / 2 - (u.sink ?? 0)
    for (let k = 0; k < u.n; k++) {
      const o = (k - (u.n - 1) / 2) * u.gap
      out.seats.push(P(cx + f.x * fwd + lat.x * o, cz + f.z * fwd + lat.z * o))
    }
    out.behind = f.z < 0
  } else if (u.kind === 'stand') {
    const n = u.n ?? 1, span = (f.x ? d : w) * CELL, dist = depth / 2 + (u.dist ?? 0.4)
    for (let k = 0; k < n; k++) {
      const o = n > 1 ? (k - (n - 1) / 2) * Math.min(0.8, span / n) : 0
      out.stands.push(P(cx + f.x * dist + lat.x * o, cz + f.z * dist + lat.z * o))
    }
  } else if (u.kind === 'pair') {
    const along = d > w ? { x: 0, z: 1 } : { x: 1, z: 0 }
    const half = ((d > w ? d : w) * CELL) / 2 + 0.26
    for (const s of [-1, 1]) out.stands.push(P(cx + along.x * half * s, cz + along.z * half * s))
  } else if (u.kind === 'pet') out.stands.push(P(cx + 0.15, cz + (d * CELL) / 2 + 0.35))
  else if (u.kind === 'bed') out.seats.push(P(cx, cz - (d * CELL) / 2 + CELL / 2))
  return out
}

function Num({ label, value, set, step = 1, min, max, hint }: { label: string; value: number; set: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      <input type="number" step={step} min={min} max={max} value={value} onChange={(e) => set(+e.target.value)} />
    </label>
  )
}

export function ItemForm({ id, rot }: { id: string; rot: number }) {
  const file = useC((s) => s.file)!
  const saved = useC((s) => s.saved)
  const savedIds = useMemo(() => new Set((JSON.parse(saved || '{"items":[]}') as { items: Item[] }).items.map((i) => i.id)), [saved])
  const i = itemOf(file, id)
  const [newId, setNewId] = useState(id)
  useEffect(() => setNewId(id), [id])
  if (!i) return <p className="hint">Món này đã bị xoá.</p>
  const { edit } = useC.getState()
  const up = (fn: (x: Item) => void) => edit((f) => { const x = itemOf(f, id); if (x) fn(x) })
  const target: Target = { kind: 'item', id, rot }
  const rots = i.art.code ? [0] : i.turn === 'flip' ? [0, 1] : rotations(i)
  const setRot = (r: number) => useC.setState({ target: { kind: 'item', id, rot: r }, part: null })
  const problems = itemProblems(i, file.items)
  const isNew = !savedIds.has(id)

  const rename = () => {
    if (newId === id) return
    if (!ID_RE.test(newId)) return useC.getState().toast('Mã chỉ gồm chữ không dấu, số, gạch dưới, bắt đầu bằng chữ', true)
    if (file.items.some((x) => x.id === newId)) return useC.getState().toast('Mã này đã có món khác dùng', true)
    up((x) => { x.id = newId })
    useC.setState({ target: { kind: 'item', id: newId, rot } })
  }
  const duplicate = () => {
    let n = 2
    while (file.items.some((x) => x.id === `${id}${n}`)) n++
    const copy: Item = { ...structuredClone(i), id: `${id}${n}`, name: `${i.name} (bản sao)` }
    delete copy.art.code
    edit((f) => void f.items.splice(f.items.findIndex((x) => x.id === id) + 1, 0, copy))
    useC.setState({ target: { kind: 'item', id: copy.id, rot: 0 }, part: null })
  }
  const remove = () => {
    if (!confirm(`Xoá "${i.name}" khỏi cửa hàng?${isNew ? '' : '\nMón này đã đặt trong văn phòng nào thì sẽ biến mất (không hoàn Xu).'}`)) return
    edit((f) => { f.items = f.items.filter((x) => x.id !== id) })
    useC.setState({ target: null, part: null })
  }
  const setMount = (m: Mount) => up((x) => {
    x.mount = m
    if (m === 'wall') { x.d = 0; x.turn = 'none'; x.h = 0; if (x.use && x.use.kind !== 'watch') delete x.use }
    else if (x.d < 1) x.d = 1
    if (m === 'rug') { x.h = 0; delete x.use }
  })
  const setTurn = (t: Turn) => up((x) => {
    x.turn = t
    // Bỏ hình các hướng không còn dùng
    const keep = t === 'four' ? 4 : t === 'two' ? 3 : 1
    if (x.art.views) x.art.views = x.art.views.slice(0, keep).map((v, k) => (t === 'two' && k === 1 ? null : v))
  })
  const setUse = (k: Use['kind'] | 'none') => up((x) => {
    if (k === 'none') delete x.use
    else if (k === 'seat') x.use = { kind: 'seat', act: 'sofa', n: 1, gap: 0.6 }
    else if (k === 'stand') x.use = { kind: 'stand', act: 'coffee' }
    else x.use = { kind: k, act: ACTS[k][0].id }
  })

  const view = viewAt(file, target)
  const flipOf = i.turn === 'flip' && rot === 1
  const shown = view ?? i.art.views?.[0] ?? null
  const { fw, fh } = footPx(i, rot)
  const sp = spotsOf(i, rot)
  const ctx: Ctx = {
    mode: i.mount === 'wall' ? 'wall' : 'floor', fw, fh,
    flip: view ? !!view.flip : !!shown?.flip !== flipOf,
    shadow: i.art.shadow ?? (i.mount === 'wall' ? true : i.h >= 0.5 && i.mount !== 'rug'),
    seats: sp.seats, stands: sp.stands, behind: sp.behind,
  }
  const setView = (v: View) => edit((f) => setViewAt(f, target, v))

  return (
    <div className="form">
      <div className="row head">
        <Thumb view={itemThumbView(i)} {...footPx(i)} size={48} />
        <div className="grow">
          <input className="title" value={i.name} onChange={(e) => up((x) => { x.name = e.target.value })} />
          <div className="row small">
            {isNew ? (
              <label title="Mã dùng trong code và dữ liệu văn phòng; chỉ đổi được trước khi lưu lần đầu">mã <input value={newId} onChange={(e) => setNewId(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && rename()} /></label>
            ) : <span className="dim">mã: {i.id}</span>}
            {isNew && <span className="tag new">mới</span>}
          </div>
        </div>
        <button onClick={duplicate} title="Tạo món mới giống món này">📋 Nhân bản</button>
        {!i.art.code && <button onClick={remove} title="Xoá khỏi cửa hàng">🗑</button>}
      </div>
      {problems.length > 0 && <div className="warn">{problems.map((p) => <div key={p}>⚠ {p}</div>)}</div>}

      <div className="grid">
        <label className="field"><span>Nhóm</span>
          <select value={i.group} onChange={(e) => up((x) => { x.group = e.target.value as Group })}>
            {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
          </select>
        </label>
        <Num label="Giá (Xu)" value={i.price} min={0} set={(v) => up((x) => { x.price = Math.max(0, Math.round(v) || 0) })} hint="Bán lại được nửa giá. Công ty thường kiếm ~150 Xu/ngày" />
        {!i.art.code && (
          <label className="field"><span>Kiểu đặt</span>
            <select value={i.mount} onChange={(e) => setMount(e.target.value as Mount)}>
              {MOUNTS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        {!i.art.code && i.mount !== 'wall' && (
          <label className="field"><span>Xoay (phím R)</span>
            <select value={i.turn} onChange={(e) => setTurn(e.target.value as Turn)}>
              {TURNS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        {!i.art.code && <Num label={i.mount === 'wall' ? 'Rộng (cột tường)' : 'Rộng (ô 16 px)'} value={i.w} min={1} max={12} set={(v) => up((x) => { x.w = Math.max(1, Math.min(12, Math.round(v) || 1)) })} hint="Số ô chân món chiếm theo chiều ngang (hướng ↓). 1 ô = 0,5 m" />}
        {!i.art.code && i.mount !== 'wall' && <Num label="Sâu (ô 16 px)" value={i.d} min={1} max={12} set={(v) => up((x) => { x.d = Math.max(1, Math.min(12, Math.round(v) || 1)) })} hint="Số ô chân món chiếm theo chiều dọc (hướng ↓). Hình cao hơn chân là bình thường: phần trên vẽ đè lên ô phía sau" />}
        {!i.art.code && i.mount === 'floor' && <Num label="Cao (m)" value={i.h} step={0.1} min={0} max={4} set={(v) => up((x) => { x.h = Math.max(0, Math.min(4, Math.round(v * 100) / 100 || 0)) })} hint="0 = đi xuyên qua được (ghế đẩu, ghế họp). Từ 0,5 m có bóng đổ" />}
        {!i.art.code && (
          <label className="field"><span>Toả sáng ban đêm</span>
            <select value={i.light ?? ''} onChange={(e) => up((x) => { if (e.target.value) x.light = e.target.value as 'lamp' | 'screen'; else delete x.light })}>
              <option value="">Không</option><option value="lamp">Đèn (vàng ấm)</option><option value="screen">Màn hình (xanh, nhỏ)</option>
            </select>
          </label>
        )}
        {!i.art.code && i.mount !== 'rug' && (
          <label className="field"><span>Bóng đổ</span>
            <select value={i.art.shadow === undefined ? '' : i.art.shadow ? '1' : '0'} onChange={(e) => up((x) => { if (e.target.value === '') delete x.art.shadow; else x.art.shadow = e.target.value === '1' })}>
              <option value="">Tự động</option><option value="1">Có</option><option value="0">Không</option>
            </select>
          </label>
        )}
      </div>

      {!i.art.code && i.mount !== 'rug' && (
        <fieldset>
          <legend>Công dụng</legend>
          <div className="grid">
            <label className="field"><span>Agent và bạn dùng thế nào</span>
              <select value={i.use?.kind ?? 'none'} onChange={(e) => setUse(e.target.value as Use['kind'] | 'none')}>
                {USES.filter((u) => (i.mount === 'wall' ? u.id === 'none' || u.id === 'watch' : u.id !== 'watch')).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            {i.use && (
              <label className="field"><span>Việc làm</span>
                <select value={i.use.act} onChange={(e) => up((x) => { if (x.use) x.use.act = e.target.value as Activity })}>
                  {ACTS[i.use.kind].map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            {i.use?.kind === 'seat' && (
              <>
                <Num label="Số chỗ ngồi" value={i.use.n} min={1} max={6} set={(v) => up((x) => { if (x.use?.kind === 'seat') x.use.n = Math.max(1, Math.min(6, Math.round(v) || 1)) })} />
                <Num label="Cách nhau (m)" value={i.use.gap} step={0.05} min={0} set={(v) => up((x) => { if (x.use?.kind === 'seat') x.use.gap = Math.max(0, v || 0) })} />
                <Num label="Lùi về lưng ghế (m)" value={i.use.sink ?? 0} step={0.05} set={(v) => up((x) => { if (x.use?.kind === 'seat') { if (v) x.use.sink = v; else delete x.use.sink } })} hint="Dời chỗ ngồi về phía lưng ghế cho khớp hình" />
                <label className="field check" title="Ghế kê sát bàn: bước vào từ phía sau lưng ghế"><input type="checkbox" checked={!!i.use.back} onChange={(e) => up((x) => { if (x.use?.kind === 'seat') { if (e.target.checked) x.use.back = true; else delete x.use.back } })} /> Bước vào từ phía sau</label>
              </>
            )}
            {i.use?.kind === 'stand' && (
              <>
                <Num label="Số chỗ đứng" value={i.use.n ?? 1} min={1} max={4} set={(v) => up((x) => { if (x.use?.kind === 'stand') { const n = Math.max(1, Math.min(4, Math.round(v) || 1)); if (n > 1) x.use.n = n; else delete x.use.n } })} />
                <Num label="Cách mép trước (m)" value={i.use.dist ?? 0.4} step={0.1} min={0.2} set={(v) => up((x) => { if (x.use?.kind === 'stand') { if (v && v !== 0.4) x.use.dist = v; else delete x.use.dist } })} />
              </>
            )}
          </div>
          {i.use && <p className="hint">{USES.find((u) => u.id === i.use!.kind)?.hint}</p>}
        </fieldset>
      )}

      {i.art.code ? (
        <p className="hint">Hình món này vẽ bằng code (nội dung bảng thay đổi theo EXP): chỉ sửa tên, giá, nhóm ở đây.</p>
      ) : (
        <fieldset>
          <legend>Hình</legend>
          <div className="tabs">
            {rots.map((r) => (
              <button key={r} className={r === rot ? 'on' : ''} onClick={() => setRot(r)}>
                {i.turn === 'flip' && r === 1 ? '← Lật gương' : ROT_NAME[r]}
                {r !== 0 && !(i.turn === 'flip') && !i.art.views?.[r] && <small> (chưa có)</small>}
              </button>
            ))}
          </div>
          {flipOf ? (
            <>
              <p className="hint">Hướng này tự lật gương hình hướng ↓.</p>
              {shown && <ViewEditor view={shown} ctx={ctx} onChange={() => {}} readOnly />}
            </>
          ) : !view && rot !== 0 ? (
            <div className="hint">
              <p>Hướng này chưa có hình riêng, đang dùng tạm hình hướng ↓ (chân món {i.turn === 'four' && rot % 2 ? 'xoay ngang' : 'giữ nguyên'}).</p>
              <button className="primary" onClick={() => edit((f) => setViewAt(f, target, { parts: [] }))}>Tạo hình riêng cho hướng này</button>{' '}
              <button onClick={() => edit((f) => setViewAt(f, target, structuredClone(i.art.views![0]!)))}>Chép hình hướng ↓ sang</button>
            </div>
          ) : (
            <>
              <ViewOptions view={view ?? { parts: [] }} onChange={setView} seat={i.use?.kind === 'seat'} stretch={i.mount !== 'wall'} />
              <ViewEditor view={view ?? { parts: [] }} ctx={ctx} onChange={setView} />
            </>
          )}
        </fieldset>
      )}
    </div>
  )
}

function ViewOptions({ view, onChange, seat, stretch }: { view: View; onChange: (v: View) => void; seat?: boolean; stretch?: boolean }) {
  const f = view.fit
  const setFit = (p: Partial<NonNullable<View['fit']>>) => onChange({ ...view, fit: { ...(f ?? { mode: 'repeat', l: 4, r: 4, t: 4, b: 4 }), ...p } })
  return (
    <div className="opts">
      <label className="check" title="Lật gương cả hình quanh điểm neo"><input type="checkbox" checked={!!view.flip} onChange={(e) => { const v = { ...view }; if (e.target.checked) v.flip = true; else delete v.flip; onChange(v) }} /> Lật gương</label>
      {stretch && (
        <label title="Kéo mảnh đầu tiên cho vừa đúng khung chân món (thảm, bàn dài): giữ 4 mép, phần giữa lặp lại hoặc giãn ra">
          Kéo giãn mảnh #1{' '}
          <select value={f?.mode ?? ''} onChange={(e) => { if (!e.target.value) { const v = { ...view }; delete v.fit; onChange(v) } else setFit({ mode: e.target.value as 'repeat' | 'stretch' }) }}>
            <option value="">Không</option><option value="repeat">Lặp phần giữa</option><option value="stretch">Giãn phần giữa</option>
          </select>
        </label>
      )}
      {f && (
        <span className="row small">
          giữ mép: trái <input type="number" min={0} value={f.l} onChange={(e) => setFit({ l: Math.max(0, +e.target.value | 0) })} />
          phải <input type="number" min={0} value={f.r} onChange={(e) => setFit({ r: Math.max(0, +e.target.value | 0) })} />
          trên <input type="number" min={0} value={f.t} onChange={(e) => setFit({ t: Math.max(0, +e.target.value | 0) })} />
          dưới <input type="number" min={0} value={f.b} onChange={(e) => setFit({ b: Math.max(0, +e.target.value | 0) })} />
          · thêm rộng <input type="number" value={f.dw ?? 0} onChange={(e) => setFit({ dw: +e.target.value | 0 || undefined })} />
          cao <input type="number" value={f.dh ?? 0} onChange={(e) => setFit({ dh: +e.target.value | 0 || undefined })} />
        </span>
      )}
      {seat && (
        <label title="Số hàng pixel dưới cùng của hình vẽ đè lên người đang ngồi (tay ghế, mép đệm phía camera)">
          Phần đè người ngồi <input type="number" min={0} max={40} value={view.front ?? 0} onChange={(e) => { const v = { ...view }; const n = Math.max(0, +e.target.value | 0); if (n) v.front = n; else delete v.front; onChange(v) }} /> px
        </label>
      )}
    </div>
  )
}

// ───────────────────────── Bàn ghế làm việc ─────────────────────────

/** Cỡ bàn trong game (src/world/room.ts DESK_W × DESK_D, office.ts DESK_LIFT) */
const DESK_W = Math.round(1.4 * PPM), DESK_D = Math.round(0.75 * PPM), LIFT = 9, SEAT_TO_DESK = 0.83 * PPM

function DeskTopEditor({ top, which, on }: { top: DeskTop; which: 'top' | 'side'; on: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const src = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  const [w, h] = which === 'top' ? [DESK_W, DESK_D + LIFT] : [DESK_D, DESK_W + LIFT]
  useEffect(() => {
    // Ảnh gốc với 4 đường mép
    const c = src.current
    if (c) {
      const [k, sx, sy, sw, sh] = top.src
      const z = 4
      c.width = sw * z
      c.height = sh * z
      const g = c.getContext('2d')!
      g.imageSmoothingEnabled = false
      checker(g, c.width, c.height, 4)
      const im = img(k)
      if (im) g.drawImage(im, sx, sy, sw, sh, 0, 0, sw * z, sh * z)
      g.strokeStyle = '#ff5a5a'
      g.beginPath()
      for (const x of [top.l, sw - top.r]) { g.moveTo(x * z + 0.5, 0); g.lineTo(x * z + 0.5, c.height) }
      for (const y of [top.t, sh - top.b]) { g.moveTo(0, y * z + 0.5); g.lineTo(c.width, y * z + 0.5) }
      g.stroke()
    }
    const d = cv.current
    if (d) {
      const z = 4
      d.width = (w + 8) * z
      d.height = (h + 8) * z
      const g = d.getContext('2d')!
      g.imageSmoothingEnabled = false
      checker(g, d.width, d.height, 4)
      g.setTransform(z, 0, 0, z, 4 * z, 4 * z)
      drawFit(g, top.src, 0, 0, w, h, 'repeat', top.l, top.r, top.t, top.b)
    }
  })
  const set = (k: 'l' | 'r' | 't' | 'b', v: number) => useC.getState().edit((f) => {
    const t = which === 'top' ? f.desk.top : f.desk.side
    if (t) t[k] = Math.max(0, Math.round(v) || 0)
  })
  return (
    <div className={`desk-top${on ? ' on' : ''}`} onClick={() => !on && useC.setState({ target: { kind: 'desk', key: which }, part: null })}>
      <div className="row small"><b>{which === 'top' ? 'Mặt bàn' : 'Mặt bàn quay ngang'}</b><span className="dim">{on ? '← cắt vùng trong ảnh rồi bấm "Dùng làm mặt bàn"' : 'bấm để đổi hình'}</span></div>
      <div className="row top">
        <div>
          <canvas ref={src} className="pix" />
          <div className="row small">
            giữ mép (đường đỏ): trái <input type="number" min={0} value={top.l} onChange={(e) => set('l', +e.target.value)} />
            phải <input type="number" min={0} value={top.r} onChange={(e) => set('r', +e.target.value)} />
            trên <input type="number" min={0} value={top.t} onChange={(e) => set('t', +e.target.value)} />
            dưới <input type="number" min={0} value={top.b} onChange={(e) => set('b', +e.target.value)} />
          </div>
        </div>
        <div>
          <canvas ref={cv} className="pix" />
          <div className="small dim">Trong game: {w}×{h} px</div>
        </div>
      </div>
    </div>
  )
}

const CHAIRS: { key: 'front' | 'back' | 'side'; name: string; hint: string }[] = [
  { key: 'front', name: 'Ghế nhìn từ trước', hint: 'Agent ngồi quay mặt ra phía bạn: ghế nằm sau lưng người' },
  { key: 'back', name: 'Ghế nhìn từ sau', hint: 'Agent ngồi quay lưng: lưng ghế che hông người' },
  { key: 'side', name: 'Ghế nhìn ngang', hint: 'Bàn quay ngang: vẽ ghế cho người nhìn sang phải, game tự lật khi nhìn sang trái' },
]

export function DeskForm({ target }: { target: Exclude<Target, { kind: 'item' }> }) {
  const file = useC((s) => s.file)!
  const { edit } = useC.getState()
  const d = file.desk
  const base = target.kind === 'chair' ? (target.key.replace('Leather', '') as 'front' | 'back' | 'side') : null
  const leather = target.kind === 'chair' && target.key.endsWith('Leather')
  const setChair = (key: ChairKey) => useC.setState({ target: { kind: 'chair', key }, part: null })
  const view = target.kind === 'chair' ? (d.chair[target.key] ?? d.chair[base!]) : null
  const ctx: Ctx | null = base && view ? {
    mode: 'chair', fw: 0, fh: 0, seats: [{ x: 0, y: 0 }],
    tint: leather && !d.chair[target.kind === 'chair' ? target.key : 'front'] ? LEATHER : undefined,
    chairOver: base === 'back',
    desk: base === 'front' ? { top: d.top, x: -Math.round(DESK_W / 2), y: Math.round(SEAT_TO_DESK - DESK_D / 2) - LIFT, w: DESK_W, h: DESK_D + LIFT, first: false }
      : base === 'back' ? { top: d.top, x: -Math.round(DESK_W / 2), y: Math.round(-SEAT_TO_DESK - DESK_D / 2) - LIFT, w: DESK_W, h: DESK_D + LIFT, first: true }
      : { top: d.side ?? d.top, x: Math.round(SEAT_TO_DESK - DESK_D / 2), y: -Math.round(DESK_W / 2) - LIFT, w: DESK_D, h: DESK_W + LIFT, first: false },
  } : null
  const t = target.kind === 'chair' ? target : null
  return (
    <div className="form">
      <div className="row head"><b className="title">Bàn ghế làm việc</b><span className="dim small">Đổi hình cho bàn, đồ trên bàn và ghế của mọi agent. Cỡ bàn giữ nguyên.</span></div>
      <fieldset>
        <legend>Bàn</legend>
        <DeskTopEditor top={d.top} which="top" on={target.kind === 'desk' && target.key === 'top'} />
        <label className="check"><input type="checkbox" checked={!!d.side} onChange={(e) => edit((f) => { if (e.target.checked) f.desk.side = structuredClone(f.desk.top); else delete f.desk.side })} /> Hình riêng cho bàn quay ngang (không thì dùng chung hình trên, kéo theo chiều dọc)</label>
        {d.side && <DeskTopEditor top={d.side} which="side" on={target.kind === 'desk' && target.key === 'side'} />}
      </fieldset>
      <DeskThings />
      <fieldset>
        <legend>Ghế</legend>
        <div className="tabs">
          {CHAIRS.map((c) => <button key={c.key} className={base === c.key ? 'on' : ''} onClick={() => setChair(c.key)} title={c.hint}>{c.name}</button>)}
        </div>
        {base && t && view && ctx && (
          <>
            <p className="hint">{CHAIRS.find((c) => c.key === base)!.hint}.</p>
            <div className="row small">
              <button className={!leather ? 'on' : ''} onClick={() => setChair(base)}>Ghế thường</button>
              <button className={leather ? 'on' : ''} onClick={() => setChair(`${base}Leather` as ChairKey)}>Ghế da (agent đã mua)</button>
              {leather && (d.chair[t.key] ? (
                <button onClick={() => edit((f) => void delete f.desk.chair[t.key])}>Bỏ hình da riêng (nhuộm nâu ghế thường)</button>
              ) : (
                <button className="primary" onClick={() => edit((f) => { f.desk.chair[t.key] = structuredClone(f.desk.chair[base]) })}>Tạo hình da riêng</button>
              ))}
            </div>
            {leather && !d.chair[t.key] ? (
              <ViewEditor view={view} ctx={ctx} onChange={() => {}} readOnly />
            ) : (
              <ViewEditor view={d.chair[t.key]!} ctx={ctx} onChange={(v) => edit((f) => setViewAt(f, t, v))} />
            )}
          </>
        )}
      </fieldset>
    </div>
  )
}
