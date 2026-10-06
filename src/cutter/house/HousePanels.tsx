import { useEffect, useRef, useState } from 'react'
import { GROUPS, ITEMS, footprint, itemById } from '../../data/catalog'
import { MAP_SHEETS } from '../../pixel/tilemap'
import { FACES, HOUSE_MAX, HOUSE_MIN, ROOM_ID_RE, podCells, type Face, type HouseFile, type HouseRoom, type RoomUse } from '../../world/house'
import { houseDoors, houseGrid, housePartitions } from '../../world/houseMap.mjs'
import { img, onImage } from '../draw'
import { Thumb } from '../Editor'
import { paintParts, viewOf } from './geo'
import { deleteSel } from './HouseView'
import { houseProblemsOf, useH, type Tool, type WallPen } from './store'

/*
 * Hai cột hai bên khung vẽ nhà: bên trái công cụ + danh sách phòng, bên phải thuộc tính thứ đang chọn
 * (cả nhà / phòng / cửa / vách / cụm bàn / chỗ chờ) và danh sách lỗi.
 */

const FLOORS = MAP_SHEETS['map:floors']
const WALLS = MAP_SHEETS['map:walls']

const PENS: { id: WallPen; name: string; hint: string }[] = [
  { id: 'tall', name: 'Tường cao', hint: 'Như tường giữa các phòng; mờ đi khi có người phía sau' },
  { id: 'low', name: 'Vách thấp', hint: 'Ngang hông, luôn thấy người' },
]

const TOOLS: { id: Tool; icon: string; name: string; key: string }[] = [
  { id: 'select', icon: '🖱️', name: 'Chọn, dời', key: 'V' },
  { id: 'room', icon: '➕', name: 'Phòng mới', key: 'N' },
  { id: 'add', icon: '▦', name: 'Thêm khúc', key: 'A' },
  { id: 'cut', icon: '✂️', name: 'Khoét bớt', key: 'X' },
  { id: 'wall', icon: '🧱', name: 'Vách', key: 'B' },
  { id: 'unwall', icon: '⛏️', name: 'Dỡ vách', key: 'U' },
  { id: 'door', icon: '🚪', name: 'Cửa', key: 'D' },
  { id: 'entrance', icon: '🏁', name: 'Cửa vào', key: 'E' },
  { id: 'window', icon: '🪟', name: 'Cửa sổ', key: 'W' },
  { id: 'kanban', icon: '📋', name: 'Bảng ticket', key: 'K' },
  { id: 'pod', icon: '🖥️', name: 'Cụm bàn', key: 'P' },
  { id: 'lead', icon: '👔', name: 'Bàn Lead', key: 'M' },
  { id: 'lobby', icon: '🧍', name: 'Chỗ chờ', key: 'L' },
  { id: 'kit', icon: '🛋️', name: 'Đồ có sẵn', key: 'O' },
]

export function HouseSide() {
  const file = useH((s) => s.file)
  const tool = useH((s) => s.tool)
  const sel = useH((s) => s.sel)
  const zoom = useH((s) => s.zoom)
  const grid = useH((s) => s.grid)
  const wallPen = useH((s) => s.wallPen)
  return (
    <div className="picker">
      <div className="tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => useH.setState({ tool: t.id })} title={`Phím ${t.key}`}>
            <span>{t.icon}</span> {t.name} <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      {tool === 'wall' && file && (
        <div className="pens">
          {PENS.map((p) => (
            <button key={p.id} className={wallPen === p.id ? 'on' : ''} title={p.hint} onClick={() => useH.setState({ wallPen: p.id })}>
              <TilePreview sheet={WALLS} c={file.walls[p.id][0]} r={file.walls[p.id][1]} w={1} h={2} scale={1} /> {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="row small">
        <span className="dim">Phóng</span>
        {[0.5, 0.75, 1, 1.5, 2].map((z) => (
          <button key={z} className={zoom === z ? 'on' : ''} onClick={() => useH.setState({ zoom: z })}>{z}×</button>
        ))}
        <label className="check"><input type="checkbox" checked={grid} onChange={(e) => useH.setState({ grid: e.target.checked })} /> Lưới</label>
      </div>
      <div className="group">Các phòng</div>
      <div className="tree">
        <button className={`tree-file${!sel ? ' on' : ''}`} onClick={() => useH.setState({ sel: null })}>🏠 Cả nhà <small>cỡ, giá, kiểu tường, lỗi</small></button>
        {file?.rooms.map((r) => (
          <button key={r.id} className={`tree-file${sel?.kind === 'room' && sel.id === r.id ? ' on' : ''}`} onClick={() => useH.setState({ sel: { kind: 'room', id: r.id } })}>
            {r.icon} {r.name} <small>{r.start ? 'mở sẵn' : '🔒 mở bằng Xu'} · {r.rects.length} khúc · {(r.kit ?? []).length} món có sẵn</small>
          </button>
        ))}
      </div>
      <p className="hint">Ô = 0,5 m (16 px). Ô sát phòng là tường, ô xa hơn là ngoài nhà. Bảng ticket, cụm bàn, cửa vào, chỗ chờ phải ở phòng mở sẵn.</p>
    </div>
  )
}

// ───────────────────────── Bên phải ─────────────────────────

export function HouseProps() {
  const file = useH((s) => s.file)
  const sel = useH((s) => s.sel)
  if (!file) return <p className="hint pad">Đang đọc house.json…</p>
  const room = sel?.kind === 'room' ? file.rooms.find((r) => r.id === sel.id) : undefined
  return (
    <div className="editor">
      {room ? <RoomForm key={room.id} room={room} kit={sel?.kind === 'room' ? sel.kit : undefined} />
        : sel?.kind === 'door' ? <DoorForm h={file} i={sel.i} />
        : sel?.kind === 'part' ? <PartForm h={file} i={sel.i} />
        : sel?.kind === 'pod' ? <PointForm h={file} list="pods" i={sel.i} />
        : sel?.kind === 'lead' ? <LeadForm h={file} i={sel.i} />
        : sel?.kind === 'lobby' ? <PointForm h={file} list="lobby" i={sel.i} />
        : <HouseForm h={file} />}
      <Problems h={file} />
    </div>
  )
}

function Problems({ h }: { h: HouseFile }) {
  const ps = houseProblemsOf(h)
  if (!ps.length) return <p className="hint pad ok-text">✓ Không có lỗi: lưu được (Ctrl+S).</p>
  return (
    <div className="form">
      <div className="warn">
        <b>⚠ {ps.length} lỗi cần sửa trước khi lưu</b>
        <ul className="problems">
          {ps.map((p) => (
            <li key={p.msg}>
              <button className="wrap linkish" onClick={() => useH.setState({ flash: p.at ?? null, ...(p.room ? { sel: { kind: 'room', id: p.room } } : {}) })}>{p.msg}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function HouseForm({ h }: { h: HouseFile }) {
  const edit = useH((s) => s.edit)
  const [W, H] = h.size
  const [size, setSize] = useState<[number, number]>([W, H])
  const [prices, setPrices] = useState(h.prices.join(', '))
  const [pick, setPick] = useState<null | 'north' | 'tall' | 'low'>(null)
  useEffect(() => setSize([W, H]), [W, H])
  useEffect(() => setPrices(h.prices.join(', ')), [h.prices])
  const starts = h.rooms.filter((r) => r.start).length
  const grid = houseGrid(h)
  const doors = houseDoors(h, grid)
  const parts = [...housePartitions(h).values()]
  return (
    <div className="form">
      <b className="title">🏠 Cả nhà</b>
      <p className="hint">
        {h.rooms.length} phòng ({starts} mở sẵn) · {doors.length} cửa · {h.pods.length} cụm bàn (đủ chỗ {h.pods.length * 4} agent)
        · {(h.leads ?? []).length ? `${h.leads!.length} bàn Lead` : 'Lead ngồi cụm bàn 1 (chưa có bàn riêng)'} · {h.lobby.length} chỗ chờ · {h.windows.length} cửa sổ · {parts.filter((k) => k !== 'door').length} ô vách, {(h.partitions ?? []).filter((p) => p[4] === 'door').length} cửa trên vách.
      </p>
      <fieldset>
        <legend>Cỡ nhà</legend>
        <div className="row">
          <label className="field">Ngang (ô)<input type="number" min={HOUSE_MIN[0]} max={HOUSE_MAX[0]} value={size[0]} onChange={(e) => setSize([Number(e.target.value), size[1]])} /></label>
          <label className="field">Dọc (ô)<input type="number" min={HOUSE_MIN[1]} max={HOUSE_MAX[1]} value={size[1]} onChange={(e) => setSize([size[0], Number(e.target.value)])} /></label>
          <button disabled={size[0] === W && size[1] === H} onClick={() => edit((x) => void (x.size = [size[0], size[1]]))}>Đổi cỡ</button>
        </div>
        <p className="hint">{W / 2} × {H / 2} m. Nhà lớn ra thì thêm chỗ ở phía đông / nam; nhỏ lại thì phòng nằm ngoài sẽ báo lỗi.</p>
      </fieldset>
      <fieldset>
        <legend>Giá mở phòng (Xu)</legend>
        <input value={prices} onChange={(e) => setPrices(e.target.value)} style={{ width: '100%' }}
          onBlur={() => {
            const ps = prices.split(/[,;\s]+/).filter(Boolean).map(Number)
            if (ps.length && ps.every((p) => Number.isInteger(p) && p >= 0)) edit((x) => void (x.prices = ps))
            else setPrices(h.prices.join(', '))
          }} />
        <p className="hint">Theo thứ tự mở: phòng mở thứ nhất, thứ hai… (phòng nào cũng vậy). Hết danh sách thì lấy giá cuối.</p>
      </fieldset>
      <fieldset>
        <legend>Kiểu tường (Room_Builder_Walls)</legend>
        {(['north', 'tall', 'low'] as const).map((k) => (
          <div key={k} className="row wall-row">
            <TilePreview sheet={WALLS} c={h.walls[k][0]} r={h.walls[k][1]} w={k === 'north' ? h.walls.north[2] ?? 1 : 1} h={2} scale={2} />
            <div className="grow small">
              <b>{k === 'north' ? 'Tường bắc của nhà' : k === 'tall' ? 'Tường giữa các phòng + tường cao trong phòng' : 'Vách thấp trong phòng'}</b>
              <div className="dim">{k === 'north' ? 'Chọn 3 ô ngang (trái, giữa, phải) hoặc 1 ô' : k === 'tall' ? 'Viên tường 1 ô, lặp ngang' : 'Lấy dải dưới của viên tường'}</div>
            </div>
            <button onClick={() => setPick(k)}>Đổi…</button>
          </div>
        ))}
        <p className="hint">Vẽ vách trong phòng: công cụ 🧱 (B). Người chơi không xây vách trong game, chỉ đặt đồ.</p>
      </fieldset>
      <fieldset>
        <legend>Bảng ticket</legend>
        <label className="field">Rộng (ô)<input type="number" min={4} max={12} value={h.kanban[1]} onChange={(e) => edit((x) => void (x.kanban[1] = Math.max(4, Math.min(12, Math.round(Number(e.target.value)) || 4))))} /></label>
        <p className="hint">Dời bảng: công cụ 📋 rồi bấm trên tường bắc.</p>
      </fieldset>
      {pick && (
        <TilePicker sheet={WALLS} title={pick === 'north' ? 'Tường bắc: kéo chọn 3 ô ngang (hoặc bấm 1 ô)' : 'Bấm chọn viên tường (2 ô dọc)'}
          maxW={pick === 'north' ? 3 : 1} maxH={1} tall
          onClose={() => setPick(null)}
          onPick={(c, r, w) => {
            edit((x) => {
              if (pick === 'north') x.walls.north = w === 3 ? [c, r, 3] : [c, r]
              else x.walls[pick] = [c, r]
            })
            setPick(null)
          }} />
      )}
    </div>
  )
}

function RoomForm({ room, kit }: { room: HouseRoom; kit?: number }) {
  const edit = useH((s) => s.edit)
  const kitItem = useH((s) => s.kitItem)
  const kitRot = useH((s) => s.kitRot)
  const [id, setId] = useState(room.id)
  const [floorPick, setFloorPick] = useState(false)
  const [topPick, setTopPick] = useState(false)
  const file = useH((s) => s.file)!
  const set = (fn: (r: HouseRoom) => void) => edit((h) => {
    const r = h.rooms.find((x) => x.id === room.id)
    if (r) fn(r)
  })
  const [fc, fr, fw = 1, fh = 1] = room.floor.fill
  const idBad = id !== room.id && (!ROOM_ID_RE.test(id) || file.rooms.some((r) => r.id === id))
  const pods = file.pods.filter((p) => {
    const [c0, r0, c1, r1] = podCells(p)
    return room.rects.some(([a, b, c, d]) => c0 <= c && c1 >= a && r0 <= d && r1 >= b)
  }).length
  return (
    <div className="form">
      <div className="row head">
        <input className="icon-input" value={room.icon} onChange={(e) => set((r) => void (r.icon = e.target.value))} title="Biểu tượng (emoji)" />
        <input className="title grow" value={room.name} onChange={(e) => set((r) => void (r.name = e.target.value))} placeholder="Tên phòng" />
      </div>
      <div className="grid">
        <label className="field">Mã phòng (không dấu)
          <input value={id} onChange={(e) => setId(e.target.value)} className={idBad ? 'bad' : ''}
            onBlur={() => {
              if (id === room.id) return
              if (idBad) return setId(room.id)
              set((r) => void (r.id = id))
              useH.setState({ sel: { kind: 'room', id } })
            }} />
        </label>
        <label className="check" title="Phòng mở sẵn: có từ đầu, không mất Xu">
          <input type="checkbox" checked={!!room.start} onChange={(e) => set((r) => { if (e.target.checked) r.start = true; else delete r.start })} /> Mở sẵn từ đầu
        </label>
      </div>
      <p className="hint">Đổi mã một phòng mà văn phòng thật đã mở: game coi như phòng cũ mất, trả lại Xu và khoá phòng lại.</p>
      <label className="field" title="Có phòng nghỉ / phòng ngủ thì agent rảnh chỉ chơi trong các phòng đó">Dùng làm
        <select value={room.use ?? ''} onChange={(e) => set((r) => { const v = e.target.value as RoomUse | ''; if (v) r.use = v; else delete r.use })}>
          <option value="">Phòng thường</option>
          <option value="rest">🛋️ Phòng nghỉ của agent</option>
          <option value="sleep">🛏️ Phòng ngủ của agent</option>
        </select>
      </label>
      <p className="hint">Có phòng nghỉ / phòng ngủ (đã mở) thì agent rảnh chỉ chơi ở đó, không ngồi chơi ở bàn hay ra phòng khác. Agent tạm dừng về giường trống mà ngủ (giường: nhóm 🛏️ Phòng ngủ), hết giường thì ngủ gục ở bàn.</p>
      <label className="field">Có gì trong phòng (hiện ở bảng Mở phòng)
        <input value={room.blurb} onChange={(e) => set((r) => void (r.blurb = e.target.value))} placeholder="vd: Bàn họp 4 ghế, bảng trắng" />
      </label>

      <fieldset>
        <legend>Sàn</legend>
        <div className="row">
          <TilePreview sheet={FLOORS} c={fc} r={fr} w={fw} h={fh} scale={2} repeat={3} />
          <div className="grow small dim">Mẫu {fw}×{fh} ô, lặp khắp phòng.</div>
          <button onClick={() => setFloorPick(true)}>Chọn sàn…</button>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={!!room.floor.top}
            onChange={(e) => set((r) => {
              if (e.target.checked) r.floor.top = [fc, Math.max(0, fr - 1)]
              else delete r.floor.top
            })} /> Hàng sát tường bắc dùng ô khác</label>
          {room.floor.top && <>
            <TilePreview sheet={FLOORS} c={room.floor.top[0]} r={room.floor.top[1]} w={fw} h={1} scale={2} />
            <button onClick={() => setTopPick(true)}>Đổi…</button>
          </>}
        </div>
        <p className="hint">Nhiều sàn LimeZu có hàng trên ngả màu (bóng tường): chọn ô đó cho hàng sát tường.</p>
      </fieldset>

      <fieldset>
        <legend>Khúc ({room.rects.length})</legend>
        {room.rects.map(([c0, r0, c1, r1], i) => (
          <div key={i} className="row small">
            <span className="grow">Khúc {i + 1}: ô ({c0}, {r0}) · {c1 - c0 + 1}×{r1 - r0 + 1} ô ({(c1 - c0 + 1) / 2}×{(r1 - r0 + 1) / 2} m)</span>
            <button disabled={room.rects.length < 2} onClick={() => set((r) => void r.rects.splice(i, 1))} title="Bỏ khúc này">✕</button>
          </div>
        ))}
        <p className="hint">Thêm khúc: công cụ ▦ rồi kéo cạnh phòng. Đổi cỡ: công cụ 🖱️, kéo mép khúc.</p>
      </fieldset>

      <fieldset>
        <legend>Đồ có sẵn ({(room.kit ?? []).length})</legend>
        <>
          <p className="hint">{room.start
            ? 'Phòng mở sẵn: đồ được đặt vào văn phòng một lần (lần mở game đầu tiên sau khi lưu). Bán / cất kho thì không tự quay lại; thêm món mới thì món mới được đặt thêm.'
            : 'Đồ được đặt vào lúc trả Xu mở phòng.'}</p>
          <div className="row">
            <select className="grow" value={kitItem ?? ''} onChange={(e) => useH.setState({ kitItem: e.target.value || null, kitRot: 0, tool: e.target.value ? 'kit' : useH.getState().tool })}>
              <option value="">— chọn món để đặt —</option>
              {GROUPS.map((g) => (
                <optgroup key={g.id} label={`${g.icon} ${g.name}`}>
                  {ITEMS.filter((i) => i.group === g.id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button disabled={!kitItem} onClick={() => useH.setState({ tool: 'kit' })}>Đặt</button>
          </div>
          {kitItem && <p className="hint">Bấm vào phòng để đặt {itemById.get(kitItem)?.name.toLowerCase()} (R xoay, hướng {kitRot}).</p>}
          <div className="kit-list">
            {(room.kit ?? []).map((k, i) => {
              const it = itemById.get(k.item)
              const v = it && viewOf(it, k.rot ?? 0)
              const fp = it ? footprint(it, k.rot ?? 0) : { w: 1, d: 1 }
              return (
                <div key={i} className={`li${kit === i ? ' on' : ''}`} onClick={() => useH.setState({ sel: { kind: 'room', id: room.id, kit: i } })}>
                  <Thumb view={v?.view} fw={fp.w * 16} fh={fp.d * 16} size={28} />
                  <span className="grow">{it?.name ?? `⚠ ${k.item}`}<small>ô ({k.c}, {k.r}) trong phòng{k.rot ? ` · xoay ${k.rot}` : ''}</small></span>
                  <button onClick={(e) => { e.stopPropagation(); useH.setState({ sel: { kind: 'room', id: room.id, kit: i } }); deleteSel() }} title="Bỏ món này">✕</button>
                </div>
              )
            })}
          </div>
          <p className="hint">Đồ có sẵn bán lại không được Xu. Ô tính từ góc tây bắc của phòng.</p>
        </>
      </fieldset>
      {pods > 0 && <p className="hint">Phòng này có {pods} cụm bàn của agent.</p>}
      <button className="danger" onClick={() => {
        edit((h) => void (h.rooms = h.rooms.filter((r) => r.id !== room.id)))
        useH.setState({ sel: null })
      }}>🗑 Xoá phòng</button>
      {floorPick && (
        <TilePicker sheet={FLOORS} title="Chọn sàn: bấm 1 ô, hoặc kéo chọn mẫu nhiều ô (tối đa 4×4)" maxW={4} maxH={4} onClose={() => setFloorPick(false)}
          onPick={(c, r, w, hh) => {
            set((x) => {
              x.floor.fill = w > 1 || hh > 1 ? [c, r, w, hh] : [c, r]
              if (x.floor.top) x.floor.top = [c, Math.max(0, r - 1)]
            })
            setFloorPick(false)
          }} />
      )}
      {topPick && (
        <TilePicker sheet={FLOORS} title="Ô cho hàng sát tường bắc" maxW={1} maxH={1} onClose={() => setTopPick(false)}
          onPick={(c, r) => { set((x) => void (x.floor.top = [c, r])); setTopPick(false) }} />
      )}
    </div>
  )
}

function DoorForm({ h, i }: { h: HouseFile; i: number }) {
  const d = houseDoors(h, houseGrid(h))[i]
  if (!d) return <p className="hint pad">Cửa này không còn.</p>
  const name = (id: string | null) => h.rooms.find((r) => r.id === id)?.name ?? 'ngoài nhà'
  const glass = d.cells.length === 2 && !d.vertical
  return (
    <div className="form">
      <b className="title">🚪 Cửa: {name(d.rooms[0])} ↔ {name(d.rooms[1])}</b>
      <p className="hint">{glass ? 'Cửa kính tự mở (2 ô trên tường ngang).' : 'Lối đi trống (cửa trên tường dọc, hoặc không đúng 2 ô).'} Cửa chỉ mở khi cả hai phòng đã mở.</p>
      <button className="danger" onClick={deleteSel}>🗑 Bỏ cửa</button>
    </div>
  )
}

function PartForm({ h, i }: { h: HouseFile; i: number }) {
  const edit = useH((s) => s.edit)
  const p = h.partitions?.[i]
  if (!p) return <p className="hint pad">Đoạn vách này không còn.</p>
  const [c0, r0, c1, r1, kind] = p
  const n = (c1 - c0 + 1) * (r1 - r0 + 1)
  const set = (k: WallPen) => edit((x) => {
    paintParts(x, [c0, r0, c1, r1], k)
  })
  return (
    <div className="form">
      <b className="title">{kind === 'door' ? '🚪 Cửa trên vách' : `🧱 ${kind === 'tall' ? 'Tường cao' : 'Vách thấp'}`} · {n} ô</b>
      <p className="hint">
        Ô ({c0}, {r0}) → ({c1}, {r1}), {n / 2} m. Mũi tên dời 1 ô; dời phòng thì vách nằm trọn trong phòng đi theo.
        {kind === 'door' ? ' Cửa 2 ô trên vách cao chạy ngang là cửa kính tự mở; còn lại là lối đi trống. Bấm lại bằng công cụ 🚪 để bỏ cửa.' : ''}
      </p>
      {kind !== 'door' && (
        <div className="row">
          {PENS.map((x) => <button key={x.id} className={kind === x.id ? 'on' : ''} onClick={() => set(x.id)} title={x.hint}>{x.name}</button>)}
        </div>
      )}
      <button className="danger" onClick={deleteSel}>🗑 {kind === 'door' ? 'Bỏ cửa (thành lối trống)' : 'Dỡ đoạn này'}</button>
    </div>
  )
}

const FACE_NAME: Record<Face, string> = { s: 'Nhìn xuống (nam)', w: 'Nhìn trái (tây)', n: 'Nhìn lên (bắc)', e: 'Nhìn phải (đông)' }

function LeadForm({ h, i }: { h: HouseFile; i: number }) {
  const edit = useH((s) => s.edit)
  const leads = h.leads ?? []
  const p = leads[i]
  if (!p) return <p className="hint pad">Không còn.</p>
  const n = leads.length
  const swap = (j: number) => {
    edit((x) => { const l = x.leads!; [l[i], l[j]] = [l[j], l[i]] })
    useH.setState({ sel: { kind: 'lead', i: j } })
  }
  return (
    <div className="form">
      <b className="title">👔 Bàn Lead{n > 1 ? ` ${i + 1}/${n}` : ''}</b>
      <p className="hint">
        Chỗ ngồi ở ô ({Math.floor(p[0])}, {Math.floor(p[1])}). Kéo bằng công cụ 🖱️ hoặc mũi tên để dời, R xoay.
        Bàn riêng cho Lead (agent không báo cáo cho ai); thành viên vẫn ngồi cụm bàn. Có nhiều Lead thì Lead có thành viên nhận bàn trước,
        hết bàn riêng thì ngồi cụm bàn. Bàn luôn có trong văn phòng, kể cả khi chưa có Lead; người chơi dời được như bàn khác.
      </p>
      <div className="row">
        {FACES.map((f) => <button key={f} className={p[2] === f ? 'on' : ''} onClick={() => edit((x) => void (x.leads![i][2] = f))}>{FACE_NAME[f]}</button>)}
      </div>
      <div className="row">
        {n > 1 && <button disabled={i === 0} onClick={() => swap(i - 1)}>▲ Lên trước</button>}
        {n > 1 && <button disabled={i === n - 1} onClick={() => swap(i + 1)}>▼ Xuống sau</button>}
        <span className="grow" />
        <button className="danger" onClick={deleteSel}>🗑 Xoá</button>
      </div>
    </div>
  )
}

function PointForm({ h, list, i }: { h: HouseFile; list: 'pods' | 'lobby'; i: number }) {
  const edit = useH((s) => s.edit)
  const p = h[list][i]
  if (!p) return <p className="hint pad">Không còn.</p>
  const n = h[list].length
  const swap = (j: number) => {
    edit((x) => void ([x[list][i], x[list][j]] = [x[list][j], x[list][i]]))
    useH.setState({ sel: { kind: list === 'pods' ? 'pod' : 'lobby', i: j } })
  }
  return (
    <div className="form">
      <b className="title">{list === 'pods' ? `🖥️ Cụm bàn ${i + 1}/${n}` : `🧍 Chỗ chờ ${i + 1}/${n}`}</b>
      <p className="hint">Tâm ở ô ({p[0]}, {p[1]}). Kéo bằng công cụ 🖱️ hoặc mũi tên để dời.
        {list === 'pods' ? ' Agent ngồi lấp từ cụm 1; mỗi cụm 4 bàn.' : ' Ứng viên chưa duyệt đứng ở đây, theo thứ tự.'}</p>
      <div className="row">
        <button disabled={i === 0} onClick={() => swap(i - 1)}>▲ Lên trước</button>
        <button disabled={i === n - 1} onClick={() => swap(i + 1)}>▼ Xuống sau</button>
        <span className="grow" />
        <button className="danger" onClick={deleteSel}>🗑 Xoá</button>
      </div>
    </div>
  )
}

// ───────────────────────── Ô hình LimeZu ─────────────────────────

/** Vẽ w × h ô từ ảnh (lặp `repeat` lần mỗi chiều cho thấy mẫu nối) */
function TilePreview({ sheet, c, r, w, h, scale, repeat = 1 }: { sheet: string; c: number; r: number; w: number; h: number; scale: number; repeat?: number }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  useEffect(() => {
    const x = cv.current?.getContext('2d')
    const im = img(sheet)
    if (!x) return
    x.canvas.width = w * 16 * repeat * scale
    x.canvas.height = h * 16 * (repeat > 1 ? 2 : 1) * scale
    x.imageSmoothingEnabled = false
    x.clearRect(0, 0, x.canvas.width, x.canvas.height)
    if (!im) return
    for (let i = 0; i < repeat; i++)
      for (let j = 0; j < (repeat > 1 ? 2 : 1); j++) x.drawImage(im, c * 16, r * 16, w * 16, h * 16, i * w * 16 * scale, j * h * 16 * scale, w * 16 * scale, h * 16 * scale)
  })
  return <canvas ref={cv} className="pix tile-prev" />
}

/**
 * Chọn ô trong ảnh LimeZu: bấm 1 ô hoặc kéo chọn tối đa maxW × maxH ô. `tall`: mỗi lựa chọn là viên tường cao 2 ô
 * (ô bấm là ô trên).
 */
function TilePicker({ sheet, title, maxW, maxH, tall, onPick, onClose }: {
  sheet: string; title: string; maxW: number; maxH: number; tall?: boolean
  onPick: (c: number, r: number, w: number, h: number) => void; onClose: () => void
}) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [, redraw] = useState(0)
  const [a, setA] = useState<[number, number] | null>(null)
  const [b, setB] = useState<[number, number] | null>(null)
  const [down, setDown] = useState(false)
  const Z = 2
  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  const box = (() => {
    if (!a || !b) return null
    const c0 = Math.min(a[0], b[0]), r0 = Math.min(a[1], b[1])
    const w = Math.min(maxW, Math.abs(b[0] - a[0]) + 1), h = Math.min(maxH, Math.abs(b[1] - a[1]) + 1)
    // Tường bắc: 1 hoặc 3 ô ngang
    return { c: c0, r: r0, w: maxW === 3 && w === 2 ? 1 : w, h }
  })()
  useEffect(() => {
    const x = cv.current?.getContext('2d')
    const im = img(sheet)
    if (!x || !im) return
    x.canvas.width = im.naturalWidth * Z
    x.canvas.height = im.naturalHeight * Z
    x.imageSmoothingEnabled = false
    x.fillStyle = '#2a2d38'
    x.fillRect(0, 0, x.canvas.width, x.canvas.height)
    x.drawImage(im, 0, 0, im.naturalWidth * Z, im.naturalHeight * Z)
    x.fillStyle = 'rgba(255, 255, 255, 0.08)'
    for (let i = 0; i <= im.naturalWidth; i += 16) x.fillRect(i * Z, 0, 1, x.canvas.height)
    for (let j = 0; j <= im.naturalHeight; j += 16) x.fillRect(0, j * Z, x.canvas.width, 1)
    if (box) {
      x.strokeStyle = '#f2b544'
      x.lineWidth = 2
      x.strokeRect(box.c * 16 * Z, box.r * 16 * Z, box.w * 16 * Z, (box.h + (tall ? 1 : 0)) * 16 * Z)
    }
  })
  const cell = (e: React.MouseEvent): [number, number] => {
    const rc = cv.current!.getBoundingClientRect()
    return [Math.floor((e.clientX - rc.left) / Z / 16), Math.floor((e.clientY - rc.top) / Z / 16)]
  }
  return (
    <div className="help" onClick={onClose}>
      <div className="tile-picker" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">{title}</b><button onClick={onClose}>Đóng</button></div>
        <div className="tile-sheet">
          <canvas ref={cv} className="pix"
            onMouseDown={(e) => { const p = cell(e); setA(p); setB(p); setDown(true) }}
            onMouseMove={(e) => { if (down) setB(cell(e)) }}
            onMouseUp={() => setDown(false)} />
        </div>
        <div className="row">
          {box ? <span className="grow small">Ô ({box.c}, {box.r}){box.w > 1 || box.h > 1 ? ` · ${box.w}×${box.h} ô` : ''}</span> : <span className="grow small dim">Bấm vào ảnh để chọn.</span>}
          <button className="primary" disabled={!box} onClick={() => box && onPick(box.c, box.r, box.w, box.h)}>Dùng</button>
        </div>
      </div>
    </div>
  )
}
