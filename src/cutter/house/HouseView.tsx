import { useEffect, useMemo, useRef, useState } from 'react'
import { footprint, itemById, nextRot } from '../../data/catalog'
import { MAP_SHEETS, MAP_TILESETS, tileAt } from '../../pixel/tilemap'
import { FACES, leadDesk, podCells, roomBounds, type CellRect } from '../../world/house'
import { MAP_DX, MAP_DY, gridAt, houseDoors, houseGrid, houseLayers, spawnOf } from '../../world/houseMap.mjs'
import { drawView, img, onImage } from '../draw'
import { useC } from '../store'
import { POD_DESKS, doorAt, kitAt, kitBox, lineRect, newDoor, norm, paintParts, partIndexAt, partsInRoom, setRects, shiftParts, subtract, togglePartDoor, viewOf } from './geo'
import { freeRoomId, houseProblemsOf, useH, type Sel, type Tool } from './store'

/*
 * Khung vẽ mặt bằng nhà: sàn, tường bắc, viền, cửa sổ đúng như bản đồ game sẽ có (sinh bằng src/world/houseMap.mjs),
 * tường giữa các phòng và vách trong phòng vẽ phẳng (nhìn thẳng từ trên), cửa, cụm bàn, chỗ chờ, đồ có sẵn của từng phòng.
 * Kéo chuột để vẽ phòng / thêm khúc / khoét / vẽ vách; bấm để đặt cửa, cửa sổ, cụm bàn...; công cụ Chọn thì kéo để dời, kéo mép để đổi cỡ.
 */

const T = 16
const GIDS = Object.fromEntries(MAP_TILESETS.map((t) => [t.key.slice('map:'.length), t.firstgid]))
const LAYERS = ['Floor', 'FloorDecor', 'Walls', 'WallDecor', 'WallTop'] as const
const ACCENT = '#f2b544'
const mx = (c: number) => (c + MAP_DX) * T
const my = (r: number) => (r + MAP_DY) * T

/** Gợi ý theo công cụ (dưới khung vẽ) */
export const TOOL_HINT: Record<Tool, string> = {
  select: 'Bấm để chọn phòng, cửa, cụm bàn, bàn Lead, đồ. Kéo phòng đang chọn để dời, kéo mép để đổi cỡ. Del xoá, R xoay, mũi tên dời 1 ô.',
  room: 'Kéo chuột vẽ phòng mới (ít nhất 4×4 ô). Chừa 1 ô tường giữa hai phòng.',
  add: 'Kéo chuột thêm một khúc vào phòng đang chọn (ghép thành chữ L, chữ T…).',
  cut: 'Kéo chuột khoét bớt: phần trong khung bị bỏ khỏi mọi phòng (cả vách trong đó).',
  wall: 'Kéo chuột vẽ một đoạn vách thẳng trong phòng (chọn tường cao / vách thấp ở cột phải). Vẽ đè lên vách cũ thì thay loại.',
  unwall: 'Kéo chuột qua đoạn vách muốn dỡ.',
  door: 'Bấm ô tường giữa hai phòng, hoặc ô vách trong phòng, để đặt / bỏ cửa. Cửa 2 ô trên tường / vách cao chạy ngang là cửa kính tự mở.',
  entrance: 'Bấm vào hàng cuối (tường nam) của phòng mở sẵn để dời cửa vào.',
  window: 'Bấm trên tường bắc để thêm / bỏ cửa sổ (2 ô).',
  kanban: 'Bấm trên tường bắc của phòng mở sẵn để dời bảng ticket.',
  pod: 'Bấm để thêm cụm bàn (4 bàn). Agent ngồi cụm 1 trước. Kéo bằng công cụ Chọn để dời.',
  lead: 'Bấm để đặt bàn riêng cho Lead (chỗ ngồi ở chuột, nhìn về nam). R xoay hướng ngồi. Chưa có bàn riêng thì Lead ngồi ghế đầu cụm bàn 1.',
  lobby: 'Bấm để thêm chỗ ứng viên đứng chờ (gần cửa vào).',
  kit: 'Chọn món ở bảng bên phải rồi bấm vào phòng đang chọn để đặt. R xoay.',
}

type Drag =
  | { kind: 'rect'; tool: Tool; c: number; r: number }
  | { kind: 'line'; tool: 'wall' | 'unwall'; c: number; r: number }
  | { kind: 'move'; from: string; room: string; c: number; r: number }
  | { kind: 'resize'; from: string; room: string; ri: number; l: boolean; rr: boolean; t: boolean; b: boolean; c: number; r: number }
  | { kind: 'kit'; from: string; room: string; i: number; oc: number; or: number }
  | { kind: 'pt'; from: string; list: 'pods' | 'lobby' | 'leads'; i: number; ox: number; oy: number }

export function HouseView() {
  const file = useH((s) => s.file)
  const tool = useH((s) => s.tool)
  const sel = useH((s) => s.sel)
  const zoom = useH((s) => s.zoom)
  const grid = useH((s) => s.grid)
  const kitItem = useH((s) => s.kitItem)
  const kitRot = useH((s) => s.kitRot)
  const wallPen = useH((s) => s.wallPen)
  const flash = useH((s) => s.flash)
  const cv = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cursor, setCursor] = useState('crosshair')
  const [, redraw] = useState(0)

  useEffect(() => onImage(() => redraw((n) => n + 1)), [])
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => useH.setState({ flash: null }), 1600)
    return () => clearTimeout(t)
  }, [flash])

  const g = useMemo(() => (file ? houseGrid(file) : null), [file])
  const problems = file ? houseProblemsOf(file) : []

  // ───────── Vẽ ─────────
  useEffect(() => {
    const c = cv.current
    if (!c || !file || !g) return
    const [W, H] = file.size
    const MW = W + 2, MH = H + 5
    c.width = Math.round(MW * T * zoom)
    c.height = Math.round(MH * T * zoom)
    const x = c.getContext('2d')!
    x.imageSmoothingEnabled = false
    x.setTransform(zoom, 0, 0, zoom, 0, 0)
    x.fillStyle = '#1c1a26'
    x.fillRect(0, 0, MW * T, MH * T)
    const at = (cc: number, rr: number) => gridAt(file, g, cc, rr)

    // Bản đồ như trong game
    const L = houseLayers(file, GIDS)
    for (const name of LAYERS)
      L[name].forEach((gid, i) => {
        const t = tileAt(gid)
        const im = t && img(MAP_SHEETS[t.key])
        if (t && im) x.drawImage(im, t.sx, t.sy, T, T, (i % MW) * T, Math.floor(i / MW) * T, T, T)
      })

    // Tường giữa các phòng: nắp phẳng, mép sẫm phía nam (chỗ mặt tường trong game)
    const doors = houseDoors(file, g)
    const doorCells = new Set(doors.flatMap((d) => d.cells.map(([cc, rr]) => `${cc},${rr}`)))
    for (let r = 0; r < H; r++)
      for (let cc = 0; cc < W; cc++) {
        if (at(cc, r) !== -1 || doorCells.has(`${cc},${r}`)) continue
        x.fillStyle = '#d6d0e0'
        x.fillRect(mx(cc), my(r), T, T)
        x.fillStyle = '#9a92ad'
        if (at(cc, r + 1) >= 0) x.fillRect(mx(cc), my(r) + T - 4, T, 4)
        x.fillStyle = '#4a4458'
        if (at(cc, r - 1) !== -1) x.fillRect(mx(cc), my(r), T, 1)
        if (at(cc, r + 1) !== -1) x.fillRect(mx(cc), my(r) + T - 1, T, 1)
        if (at(cc - 1, r) !== -1) x.fillRect(mx(cc), my(r), 1, T)
        if (at(cc + 1, r) !== -1) x.fillRect(mx(cc) + T - 1, my(r), 1, T)
      }
    // Cửa giữa hai phòng
    doors.forEach((d, i) => {
      const [c0, r0, c1, r1] = d.rect
      const on = sel?.kind === 'door' && sel.i === i
      x.fillStyle = d.cells.length === 2 && !d.vertical ? 'rgba(120, 190, 235, 0.75)' : 'rgba(170, 140, 100, 0.75)'
      x.fillRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
      x.strokeStyle = on ? ACCENT : '#2b2633'
      x.lineWidth = on ? 2 / zoom : 1 / zoom
      x.strokeRect(mx(c0) + 0.5 / zoom, my(r0) + 0.5 / zoom, (c1 - c0 + 1) * T - 1 / zoom, (r1 - r0 + 1) * T - 1 / zoom)
    })

    // Vách trong phòng: tường cao như tường giữa phòng, vách thấp sáng màu hơn, cửa trên vách như cửa giữa phòng
    const parts = file.partitions ?? []
    const pk = new Map<string, string>()
    for (const [c0, r0, c1, r1, kind] of parts) for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) pk.set(`${cc},${r}`, kind)
    for (const [key, kind] of pk) {
      const [cc, r] = key.split(',').map(Number)
      const same = (dc: number, dr: number) => pk.get(`${cc + dc},${r + dr}`) === kind
      if (kind === 'door') {
        x.fillStyle = 'rgba(170, 140, 100, 0.75)'
        x.fillRect(mx(cc), my(r), T, T)
        continue
      }
      x.fillStyle = kind === 'tall' ? '#d6d0e0' : '#ece2c8'
      x.fillRect(mx(cc), my(r), T, T)
      x.fillStyle = kind === 'tall' ? '#9a92ad' : '#b59f78'
      if (!same(0, 1)) x.fillRect(mx(cc), my(r) + T - (kind === 'tall' ? 4 : 2), T, kind === 'tall' ? 4 : 2)
      x.fillStyle = '#4a4458'
      if (!same(0, -1)) x.fillRect(mx(cc), my(r), T, 1)
      if (!same(0, 1)) x.fillRect(mx(cc), my(r) + T - 1, T, 1)
      if (!same(-1, 0)) x.fillRect(mx(cc), my(r), 1, T)
      if (!same(1, 0)) x.fillRect(mx(cc) + T - 1, my(r), 1, T)
    }
    if (sel?.kind === 'part' && parts[sel.i]) {
      const [c0, r0, c1, r1] = parts[sel.i]
      x.strokeStyle = ACCENT
      x.lineWidth = 2 / zoom
      x.strokeRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
    }

    // Lưới ô
    if (grid) {
      x.fillStyle = 'rgba(255, 255, 255, 0.07)'
      for (let cc = 0; cc <= W; cc++) x.fillRect(mx(cc), my(0), 1 / zoom, H * T)
      for (let r = 0; r <= H; r++) x.fillRect(mx(0), my(r), W * T, 1 / zoom)
    }

    // Đồ có sẵn của các phòng: thảm trước, rồi theo chân từ bắc xuống nam
    const things = file.rooms.flatMap((rm) => (rm.kit ?? []).map((k, i) => ({ rm, k, i })))
      .map((o) => ({ ...o, it: itemById.get(o.k.item) }))
      .filter((o) => o.it)
      .sort((a, b) => Number(b.it!.mount === 'rug') - Number(a.it!.mount === 'rug') || kitBox(a.it!, a.rm, a.k).r - kitBox(b.it!, b.rm, b.k).r)
    for (const { rm, k, i, it } of things) {
      const b = kitBox(it!, rm, k)
      const on = sel?.kind === 'room' && sel.id === rm.id && sel.kit === i
      drawItem(x, it!.id, k.rot ?? 0, b)
      if (on || (sel?.kind === 'room' && sel.id === rm.id)) {
        x.strokeStyle = on ? ACCENT : 'rgba(95, 211, 141, 0.7)'
        x.lineWidth = (on ? 2 : 1) / zoom
        x.strokeRect(mx(b.c), my(b.r), b.w * T, b.d * T)
      }
    }

    // Cụm bàn, chỗ chờ, chỗ xuất hiện, cửa vào, bảng ticket
    file.pods.forEach(([px, pz], i) => {
      const on = sel?.kind === 'pod' && sel.i === i
      const [c0, r0, c1, r1] = podCells([px, pz])
      x.fillStyle = on ? 'rgba(242, 181, 68, 0.16)' : 'rgba(155, 122, 85, 0.12)'
      x.fillRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
      for (const d of POD_DESKS) {
        x.fillStyle = '#9b7a55'
        x.fillRect(mx(px + d.x - 1.4), my(pz + d.z - 0.75), 2.8 * T, 1.5 * T)
        x.fillStyle = '#4f5b73'
        x.beginPath()
        x.arc(mx(px + d.x), my(pz + d.seat), 0.45 * T, 0, Math.PI * 2)
        x.fill()
      }
      x.strokeStyle = on ? ACCENT : 'rgba(255, 255, 255, 0.35)'
      x.lineWidth = (on ? 2 : 1) / zoom
      x.strokeRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
    })
    // Bàn riêng của Lead: vùng chiếm, mặt bàn, ghế (vàng)
    ;(file.leads ?? []).forEach((p, i) => {
      const on = sel?.kind === 'lead' && sel.i === i
      const { top, cells } = leadDesk(p)
      x.fillStyle = on ? 'rgba(242, 181, 68, 0.2)' : 'rgba(155, 122, 85, 0.14)'
      for (const [c, r] of cells) x.fillRect(mx(c), my(r), T, T)
      x.fillStyle = '#9b7a55'
      x.fillRect(mx(top.x), my(top.z), top.w * T, top.d * T)
      x.fillStyle = '#c9a227'
      x.beginPath()
      x.arc(mx(p[0]), my(p[1]), 0.45 * T, 0, Math.PI * 2)
      x.fill()
      if (on) {
        const xs = cells.map(([c]) => c), rs = cells.map(([, r]) => r)
        x.strokeStyle = ACCENT
        x.lineWidth = 2 / zoom
        x.strokeRect(mx(Math.min(...xs)), my(Math.min(...rs)), (Math.max(...xs) - Math.min(...xs) + 1) * T, (Math.max(...rs) - Math.min(...rs) + 1) * T)
      }
    })
    file.lobby.forEach(([lx, lz], i) => {
      const on = sel?.kind === 'lobby' && sel.i === i
      x.fillStyle = on ? ACCENT : '#7fd1ff'
      x.beginPath()
      x.arc(mx(lx), my(lz), 0.45 * T, 0, Math.PI * 2)
      x.fill()
    })
    const [kx, kw] = file.kanban
    x.strokeStyle = '#f7f4ec'
    x.lineWidth = 1 / zoom
    x.strokeRect(mx(kx), T + 3, kw * T, 26)
    x.strokeStyle = ACCENT
    x.lineWidth = 2 / zoom
    x.strokeRect(mx(file.entrance), my(H), 2 * T, T)

    // Chữ (cỡ cố định trên màn hình)
    x.setTransform(1, 0, 0, 1, 0, 0)
    const label = (text: string, sx: number, sy: number, color = '#fff', bg = 'rgba(16, 17, 22, 0.78)') => {
      x.font = '600 12px system-ui, sans-serif'
      const w = x.measureText(text).width
      x.fillStyle = bg
      x.fillRect(Math.round(sx - w / 2 - 4), Math.round(sy - 9), Math.round(w + 8), 18)
      x.fillStyle = color
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      x.fillText(text, Math.round(sx), Math.round(sy))
    }
    file.pods.forEach(([px, pz], i) => label(`${i + 1}`, mx(px) * zoom, my(pz) * zoom, '#fff', 'rgba(60, 45, 30, 0.85)'))
    file.lobby.forEach(([lx, lz], i) => label(`${i + 1}`, mx(lx) * zoom, my(lz - 0.9) * zoom, '#7fd1ff'))
    // Chỗ của Lead: bàn riêng; chưa có thì ghế đầu cụm bàn 1 (hàng bắc, bên trái)
    const leads = file.leads ?? []
    leads.forEach((p, i) => {
      const { top } = leadDesk(p)
      label(leads.length > 1 ? `👔 Lead ${i + 1}` : '👔 Lead', mx(top.x + top.w / 2) * zoom, my(top.z + top.d / 2) * zoom, '#fff', 'rgba(120, 90, 20, 0.9)')
    })
    if (!leads.length && file.pods[0]) {
      const [px, pz] = file.pods[0]
      label('👔 Lead', mx(px - 1.4) * zoom, my(pz - 2.4 - 1) * zoom, '#fff', 'rgba(120, 90, 20, 0.9)')
    }
    const [sx, sz] = spawnOf(file)
    label('★', mx(sx) * zoom, my(sz) * zoom, ACCENT)
    label('Cửa vào', mx(file.entrance + 1) * zoom, my(H + 1.6) * zoom, ACCENT)
    label('Bảng ticket', mx(kx + kw / 2) * zoom, 2 * T * zoom, '#f7f4ec')

    // Phòng: viền phòng đang chọn, nhãn ở khúc lớn nhất
    file.rooms.forEach((rm, k) => {
      const on = sel?.kind === 'room' && sel.id === rm.id
      if (on) {
        x.fillStyle = ACCENT
        const lw = 2
        for (let r = 0; r < H; r++)
          for (let cc = 0; cc < W; cc++) {
            if (at(cc, r) !== k) continue
            const X = mx(cc) * zoom, Y = my(r) * zoom, S = T * zoom
            if (at(cc, r - 1) !== k) x.fillRect(X, Y, S, lw)
            if (at(cc, r + 1) !== k) x.fillRect(X, Y + S - lw, S, lw)
            if (at(cc - 1, r) !== k) x.fillRect(X, Y, lw, S)
            if (at(cc + 1, r) !== k) x.fillRect(X + S - lw, Y, lw, S)
          }
      }
      const big = rm.rects.reduce((a, b) => ((b[2] - b[0] + 1) * (b[3] - b[1] + 1) > (a[2] - a[0] + 1) * (a[3] - a[1] + 1) ? b : a), rm.rects[0])
      if (!big) return
      const cx = mx((big[0] + big[2] + 1) / 2) * zoom, cy = my((big[1] + big[3] + 1) / 2) * zoom
      label(`${rm.icon} ${rm.name}`, cx, cy - 10, on ? ACCENT : '#fff')
      label(rm.start ? 'mở sẵn' : '🔒 mở bằng Xu', cx, cy + 10, rm.start ? '#5fd38d' : '#c9c3d6')
    })

    // Lỗi: khung đỏ ở ô có lỗi; ô đang nhấp nháy (bấm vào lỗi)
    x.setTransform(zoom, 0, 0, zoom, 0, 0)
    x.strokeStyle = '#ff7b6b'
    x.lineWidth = 2 / zoom
    for (const p of problems) if (p.at) x.strokeRect(mx(p.at[0]), my(p.at[1]), T, T)
    if (flash) {
      x.fillStyle = 'rgba(255, 123, 107, 0.45)'
      x.fillRect(mx(flash[0]) - T, my(flash[1]) - T, 3 * T, 3 * T)
    }

    // Đang kéo khung / bóng món sắp đặt / ô dưới chuột
    if (drag?.kind === 'rect' && hover) {
      const [c0, r0, c1, r1] = norm(drag.c, drag.r, Math.floor(hover[0]), Math.floor(hover[1]))
      x.fillStyle = drag.tool === 'cut' ? 'rgba(255, 123, 107, 0.25)' : 'rgba(95, 211, 141, 0.22)'
      x.fillRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
      x.strokeStyle = drag.tool === 'cut' ? '#ff7b6b' : '#5fd38d'
      x.strokeRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
      x.setTransform(1, 0, 0, 1, 0, 0)
      label(`${c1 - c0 + 1}×${r1 - r0 + 1} ô · ${(c1 - c0 + 1) / 2}×${(r1 - r0 + 1) / 2} m`, mx((c0 + c1 + 1) / 2) * zoom, my(r0) * zoom - 12, '#fff')
      x.setTransform(zoom, 0, 0, zoom, 0, 0)
    } else if (drag?.kind === 'line' && hover) {
      const [c0, r0, c1, r1] = lineRect(drag.c, drag.r, Math.floor(hover[0]), Math.floor(hover[1]))
      const er = drag.tool === 'unwall'
      x.fillStyle = er ? 'rgba(255, 123, 107, 0.35)' : wallPen === 'tall' ? 'rgba(214, 208, 224, 0.75)' : 'rgba(236, 226, 200, 0.75)'
      x.fillRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
      x.strokeStyle = er ? '#ff7b6b' : '#5fd38d'
      x.lineWidth = 1 / zoom
      x.strokeRect(mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
      x.setTransform(1, 0, 0, 1, 0, 0)
      const n = (c1 - c0 + 1) * (r1 - r0 + 1)
      label(`${er ? 'Dỡ' : wallPen === 'tall' ? 'Tường cao' : 'Vách thấp'} · ${n} ô · ${n / 2} m`, mx((c0 + c1 + 1) / 2) * zoom, my(r0) * zoom - 12, '#fff')
      x.setTransform(zoom, 0, 0, zoom, 0, 0)
    } else if (tool === 'kit' && hover && kitItem && itemById.get(kitItem)) {
      const it = itemById.get(kitItem)!
      const b = ghostBox(it.id, kitRot, hover)
      x.globalAlpha = 0.6
      drawItem(x, it.id, kitRot, b)
      x.globalAlpha = 1
      x.strokeStyle = '#5fd38d'
      x.lineWidth = 1 / zoom
      x.strokeRect(mx(b.c), my(b.r), b.w * T, b.d * T)
    } else if (hover && tool !== 'select') {
      x.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      x.lineWidth = 1 / zoom
      x.strokeRect(mx(Math.floor(hover[0])), my(Math.floor(hover[1])), T, T)
    }
  })

  if (!file || !g) return <div className="sheet"><p className="hint pad">Đang đọc house.json…</p></div>
  const [W, H] = file.size

  // ───────── Chuột ─────────
  const cellOf = (e: React.MouseEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / zoom / T - MAP_DX, (e.clientY - r.top) / zoom / T - MAP_DY]
  }
  const select = (s: Sel) => useH.setState({ sel: s })
  const toast = useC.getState().toast
  const selRoom = sel?.kind === 'room' ? file.rooms.find((r) => r.id === sel.id) : undefined

  /** Mép khúc của phòng đang chọn dưới chuột (để đổi cỡ) */
  const edgeAt = (fx: number, fy: number) => {
    if (!selRoom) return null
    const th = Math.max(0.3, 4 / zoom / T)
    for (let ri = 0; ri < selRoom.rects.length; ri++) {
      const [c0, r0, c1, r1] = selRoom.rects[ri]
      const inY = fy > r0 - th && fy < r1 + 1 + th, inX = fx > c0 - th && fx < c1 + 1 + th
      const l = inY && Math.abs(fx - c0) < th, rr = inY && Math.abs(fx - c1 - 1) < th
      const t = inX && Math.abs(fy - r0) < th, b = inX && Math.abs(fy - r1 - 1) < th
      if (l || rr || t || b) return { ri, l, rr, t, b }
    }
    return null
  }

  const down = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    cv.current?.focus()
    const [fx, fy] = cellOf(e)
    const c = Math.floor(fx), r = Math.floor(fy)
    const from = JSON.stringify(file)
    const st = useH.getState()
    switch (tool) {
      case 'select': {
        const edge = edgeAt(fx, fy)
        if (edge && selRoom) return setDrag({ kind: 'resize', from, room: selRoom.id, ri: edge.ri, l: edge.l, rr: edge.rr, t: edge.t, b: edge.b, c: fx, r: fy })
        const kit = kitAt(file, fx, fy, selRoom?.id)
        if (kit) {
          const rm = file.rooms.find((x) => x.id === kit[0])!
          const b = kitBox(itemById.get(rm.kit![kit[1]].item)!, rm, rm.kit![kit[1]])
          select({ kind: 'room', id: kit[0], kit: kit[1] })
          return setDrag({ kind: 'kit', from, room: kit[0], i: kit[1], oc: c - b.c, or: r - b.r })
        }
        const lead = (file.leads ?? []).findIndex((p) => leadDesk(p).cells.some(([a, b]) => a === c && b === r))
        if (lead >= 0) {
          select({ kind: 'lead', i: lead })
          const p = file.leads![lead]
          return setDrag({ kind: 'pt', from, list: 'leads', i: lead, ox: fx - p[0], oy: fy - p[1] })
        }
        const pod = file.pods.findIndex(([px, pz]) => Math.abs(fx - px) <= 2.8 && Math.abs(fy - pz) <= 2.9)
        const lob = file.lobby.findIndex(([lx, lz]) => Math.hypot(fx - lx, fy - lz) < 0.7)
        if (lob >= 0) {
          select({ kind: 'lobby', i: lob })
          return setDrag({ kind: 'pt', from, list: 'lobby', i: lob, ox: fx - file.lobby[lob][0], oy: fy - file.lobby[lob][1] })
        }
        if (pod >= 0) {
          select({ kind: 'pod', i: pod })
          return setDrag({ kind: 'pt', from, list: 'pods', i: pod, ox: fx - file.pods[pod][0], oy: fy - file.pods[pod][1] })
        }
        const d = doorAt(file, c, r)
        if (d >= 0) return select({ kind: 'door', i: d })
        const pi = partIndexAt(file, c, r)
        if (pi >= 0) return select({ kind: 'part', i: pi })
        const k = gridAt(file, g, c, r)
        if (k >= 0) {
          const rm = file.rooms[k]
          if (selRoom?.id === rm.id) return setDrag({ kind: 'move', from, room: rm.id, c, r })
          return select({ kind: 'room', id: rm.id })
        }
        return select(null)
      }
      case 'room': case 'cut':
        return setDrag({ kind: 'rect', tool, c, r })
      case 'wall': case 'unwall':
        return setDrag({ kind: 'line', tool, c, r })
      case 'add':
        if (!selRoom) return toast('Chọn một phòng trước (công cụ Chọn), rồi kéo để thêm khúc', true)
        return setDrag({ kind: 'rect', tool, c, r })
      case 'door': {
        const d = doorAt(file, c, r)
        if (d >= 0) return st.edit((h) => void h.doors.splice(d, 1))
        if (partIndexAt(file, c, r) >= 0) return st.edit((h) => void togglePartDoor(h, c, r))
        const rect = newDoor(file, c, r)
        if (!rect) return toast('Bấm vào ô tường nằm giữa hai phòng khác nhau, hoặc ô vách trong phòng', true)
        st.edit((h) => void h.doors.push(rect))
        return select({ kind: 'door', i: file.doors.length })
      }
      case 'entrance':
        return st.edit((h) => void (h.entrance = Math.max(0, Math.min(W - 2, c))))
      case 'window': {
        const w = file.windows.findIndex((x) => c === x || c === x + 1)
        return st.edit((h) => {
          if (w >= 0) h.windows.splice(w, 1)
          else h.windows = [...h.windows, Math.max(0, Math.min(W - 2, c))].sort((a, b) => a - b)
        })
      }
      case 'kanban':
        return st.edit((h) => void (h.kanban[0] = Math.max(0, Math.min(W - h.kanban[1], c - Math.floor(h.kanban[1] / 2)))))
      case 'pod':
        st.edit((h) => void h.pods.push([Math.round(fx * 2) / 2, Math.round(fy * 2) / 2]))
        return select({ kind: 'pod', i: file.pods.length })
      case 'lead':
        st.edit((h) => void (h.leads ??= []).push([c + 0.5, r + 0.5, 's']))
        return select({ kind: 'lead', i: file.leads?.length ?? 0 })
      case 'lobby':
        st.edit((h) => void h.lobby.push([Math.round(fx * 10) / 10, Math.round(fy * 10) / 10]))
        return select({ kind: 'lobby', i: file.lobby.length })
      case 'kit': {
        if (!selRoom) return toast('Chọn phòng để đặt đồ có sẵn trước', true)
        if (!kitItem || !itemById.get(kitItem)) return toast('Chọn món ở bảng bên phải trước', true)
        const b = ghostBox(kitItem, kitRot, [fx, fy])
        const { c0, r0 } = roomBounds(selRoom.rects)
        const n = selRoom.kit?.length ?? 0
        st.edit((h) => {
          const rm = h.rooms.find((x) => x.id === selRoom.id)!
          ;(rm.kit ??= []).push({ item: kitItem, c: b.c - c0, r: b.wall ? 0 : b.r - r0, ...(kitRot ? { rot: kitRot } : {}) })
        })
        return select({ kind: 'room', id: selRoom.id, kit: n })
      }
    }
  }

  const move = (e: React.MouseEvent) => {
    const p = cellOf(e)
    const [fx, fy] = p
    setHover(p)
    if (!drag) {
      if (tool === 'select') {
        const edge = edgeAt(fx, fy)
        setCursor(!edge ? (selRoom && gridAt(file, g, Math.floor(fx), Math.floor(fy)) === file.rooms.indexOf(selRoom) ? 'move' : 'default')
          : (edge.l || edge.rr) && (edge.t || edge.b) ? ((edge.l && edge.t) || (edge.rr && edge.b) ? 'nwse-resize' : 'nesw-resize')
          : edge.l || edge.rr ? 'ew-resize' : 'ns-resize')
      } else setCursor('crosshair')
      return
    }
    const st = useH.getState()
    if (drag.kind === 'move') {
      const dc = Math.floor(fx) - drag.c, dr = Math.floor(fy) - drag.r
      st.drag(drag.from, (h) => {
        const k = h.rooms.findIndex((x) => x.id === drag.room)
        if (k < 0) return
        // Vách trong phòng đi theo phòng
        shiftParts(h, partsInRoom(h, k), dc, dr)
        h.rooms[k].rects = h.rooms[k].rects.map(([a, b, c, d]) => [a + dc, b + dr, c + dc, d + dr])
      })
    } else if (drag.kind === 'resize') {
      const dc = Math.round(fx - drag.c), dr = Math.round(fy - drag.r)
      st.drag(drag.from, (h) => {
        const rm = h.rooms.find((x) => x.id === drag.room)
        if (!rm) return
        const [a, b, c, d] = rm.rects[drag.ri]
        const next: CellRect = [
          drag.l ? Math.min(a + dc, c - 3) : a, drag.t ? Math.min(b + dr, d - 3) : b,
          drag.rr ? Math.max(c + dc, a + 3) : c, drag.b ? Math.max(d + dr, b + 3) : d,
        ]
        setRects(rm, rm.rects.map((x, i) => (i === drag.ri ? next : x)))
      })
    } else if (drag.kind === 'kit') {
      st.drag(drag.from, (h) => {
        const rm = h.rooms.find((x) => x.id === drag.room)
        const k = rm?.kit?.[drag.i]
        if (!rm || !k) return
        const { c0, r0 } = roomBounds(rm.rects)
        k.c = Math.floor(fx) - drag.oc - c0
        if (itemById.get(k.item)?.mount !== 'wall') k.r = Math.floor(fy) - drag.or - r0
      })
    } else if (drag.kind === 'pt') {
      st.drag(drag.from, (h) => {
        if (drag.list === 'leads') {
          // Chỗ ngồi ở giữa ô (như bàn dời trong game)
          const p = h.leads?.[drag.i]
          if (p) [p[0], p[1]] = [Math.floor(fx - drag.ox) + 0.5, Math.floor(fy - drag.oy) + 0.5]
          return
        }
        const step = drag.list === 'pods' ? 2 : 10
        h[drag.list][drag.i] = [Math.round((fx - drag.ox) * step) / step, Math.round((fy - drag.oy) * step) / step]
      })
    }
  }

  const up = (e: React.MouseEvent) => {
    const d = drag
    setDrag(null)
    if (!d) return
    const st = useH.getState()
    if (d.kind === 'line') {
      const [fx, fy] = cellOf(e)
      const L = lineRect(d.c, d.r, Math.floor(fx), Math.floor(fy))
      if (d.tool === 'unwall') return st.edit((h) => paintParts(h, L, null))
      const bad = (() => { for (let r = L[1]; r <= L[3]; r++) for (let c = L[0]; c <= L[2]; c++) if (gridAt(file, g, c, r) < 0) return true; return false })()
      if (bad) return toast('Vách chỉ nằm trong phòng (không lên tường, ngoài nhà)', true)
      st.edit((h) => paintParts(h, L, wallPen))
      return
    }
    if (d.kind !== 'rect') return st.dragEnd(d.from)
    const [fx, fy] = cellOf(e)
    const S = norm(d.c, d.r, Math.max(0, Math.min(W - 1, Math.floor(fx))), Math.max(0, Math.min(H - 1, Math.floor(fy))))
    const [c0, r0, c1, r1] = S
    if (d.tool === 'cut') {
      const gone: string[] = []
      st.edit((h) => {
        for (const rm of h.rooms) {
          const rest = rm.rects.flatMap((R) => subtract(R, S))
          if (!rest.length) gone.push(rm.id)
          else if (JSON.stringify(rest) !== JSON.stringify(rm.rects)) setRects(rm, rest)
        }
        h.rooms = h.rooms.filter((rm) => !gone.includes(rm.id))
        paintParts(h, S, null)
        // Cửa nằm trong vùng khoét thì bỏ (tường chỗ đó đã đổi)
        h.doors = h.doors.filter(([a, b, c, dd]) => a > c1 || c < c0 || b > r1 || dd < r0)
      })
      if (sel?.kind === 'room' && gone.includes(sel.id)) select(null)
      if (gone.length) toast(`Đã xoá ${gone.length} phòng nằm trọn trong vùng khoét`)
      return
    }
    if (c1 - c0 < 3 || r1 - r0 < 3) return toast('Khúc phòng ít nhất 4×4 ô (2×2 m)', true)
    if (d.tool === 'add' && selRoom) {
      st.edit((h) => {
        const rm = h.rooms.find((x) => x.id === selRoom.id)
        if (rm) setRects(rm, [...rm.rects, S])
      })
      return
    }
    const id = freeRoomId(file)
    st.edit((h) => {
      h.rooms.push({
        id, name: `Phòng mới ${h.rooms.length + 1}`, icon: '🏷️', blurb: '', rects: [S],
        floor: h.rooms[h.rooms.length - 1]?.floor ? JSON.parse(JSON.stringify(h.rooms[h.rooms.length - 1].floor)) : { fill: [1, 25], top: [1, 24] }, kit: [],
      })
    })
    useH.setState({ sel: { kind: 'room', id }, tool: 'select' })
  }

  const here = hover ? [Math.floor(hover[0]), Math.floor(hover[1])] : null
  const hereRoom = here && g ? gridAt(file, g, here[0], here[1]) : -3
  return (
    <div className="sheet">
      <div className="house-box" tabIndex={-1}>
        <canvas ref={cv} className="pix" style={{ cursor }} tabIndex={0}
          onMouseDown={down} onMouseMove={move} onMouseUp={up}
          onMouseLeave={() => { setHover(null); if (drag) { if (drag.kind !== 'rect' && drag.kind !== 'line') useH.getState().dragEnd(drag.from); setDrag(null) } }} />
      </div>
      <div className="bar small">
        <span className="grow dim">{TOOL_HINT[tool]}</span>
        {here && <span className="dim">ô ({here[0]}, {here[1]}){hereRoom >= 0 ? ` · ${file.rooms[hereRoom].name}` : hereRoom === -1 ? ' · tường' : ''}{partIndexAt(file, here[0], here[1]) >= 0 ? ' · vách' : ''}</span>}
      </div>
    </div>
  )
}

/** Khung (ô) của món sắp đặt, giữa món nằm ở chuột */
function ghostBox(id: string, rot: number, [fx, fy]: [number, number]) {
  const it = itemById.get(id)!
  if (it.mount === 'wall') return { c: Math.round(fx - it.w / 2), r: -2, w: it.w, d: 2, wall: true }
  const { w, d } = footprint(it, rot)
  return { c: Math.round(fx - w / 2), r: Math.round(fy - d / 2), w, d, wall: false }
}

/** Vẽ một món tại khung ô `b` (đồ treo tường: neo ở mép trên tường bắc) */
function drawItem(x: CanvasRenderingContext2D, id: string, rot: number, b: { c: number; r: number; w: number; d: number; wall: boolean }) {
  const it = itemById.get(id)
  const v = it && viewOf(it, rot)
  if (!it || !v) {
    x.fillStyle = 'rgba(125, 138, 166, 0.8)'
    x.fillRect(mx(b.c), my(b.r), b.w * T, b.d * T)
    return
  }
  x.save()
  if (b.wall) x.translate(mx(b.c) + (b.w * T) / 2, T)
  else x.translate(mx(b.c) + (b.w * T) / 2, my(b.r + b.d))
  drawView(x, v.view, v.flip, b.w * T, b.d * T)
  x.restore()
}

/** Xoay món đang chọn / món sắp đặt / bàn Lead đang chọn (phím R) */
export function rotateKit() {
  const { sel, kitItem, kitRot, tool, edit } = useH.getState()
  if (sel?.kind === 'lead') {
    return edit((h) => {
      const p = h.leads?.[sel.i]
      if (p) p[2] = FACES[(FACES.indexOf(p[2]) + 1) % FACES.length]
    })
  }
  if (tool === 'kit' && kitItem) {
    const it = itemById.get(kitItem)
    if (it) useH.setState({ kitRot: nextRot(it, kitRot) })
    return
  }
  if (sel?.kind !== 'room' || sel.kit === undefined) return
  edit((h) => {
    const k = h.rooms.find((r) => r.id === sel.id)?.kit?.[sel.kit!]
    const it = k && itemById.get(k.item)
    if (k && it) k.rot = nextRot(it, k.rot ?? 0)
  })
}

/** Xoá thứ đang chọn (phím Delete) */
export function deleteSel() {
  const { sel, edit } = useH.getState()
  if (!sel) return
  edit((h) => {
    if (sel.kind === 'door') h.doors.splice(sel.i, 1)
    else if (sel.kind === 'part') h.partitions?.splice(sel.i, 1)
    else if (sel.kind === 'pod') h.pods.splice(sel.i, 1)
    else if (sel.kind === 'lead') h.leads?.splice(sel.i, 1)
    else if (sel.kind === 'lobby') h.lobby.splice(sel.i, 1)
    else if (sel.kit !== undefined) h.rooms.find((r) => r.id === sel.id)?.kit?.splice(sel.kit, 1)
  })
  useH.setState({ sel: sel.kind === 'room' ? (sel.kit !== undefined ? { kind: 'room', id: sel.id } : sel) : null })
}

/** Dời thứ đang chọn 1 ô (phím mũi tên) */
export function nudgeSel(dc: number, dr: number) {
  const { sel, edit } = useH.getState()
  if (!sel) return
  edit((h) => {
    if (sel.kind === 'part') shiftParts(h, [sel.i], dc, dr)
    else if (sel.kind === 'lead') {
      const p = h.leads?.[sel.i]
      if (p) [p[0], p[1]] = [p[0] + dc, p[1] + dr]
    }
    else if (sel.kind === 'pod' || sel.kind === 'lobby') {
      const list = sel.kind === 'pod' ? h.pods : h.lobby
      const p = list[sel.i]
      if (p) list[sel.i] = [p[0] + dc, p[1] + dr]
    } else if (sel.kind === 'room') {
      const k = h.rooms.findIndex((r) => r.id === sel.id)
      const rm = h.rooms[k]
      if (!rm) return
      if (sel.kit !== undefined) {
        const k = rm.kit?.[sel.kit]
        if (k) {
          k.c += dc
          if (itemById.get(k.item)?.mount !== 'wall') k.r += dr
        }
      } else {
        shiftParts(h, partsInRoom(h, k), dc, dr)
        rm.rects = rm.rects.map(([a, b, c, d]) => [a + dc, b + dr, c + dc, d + dr])
      }
    }
  })
}

export const toolKeys: Record<string, Tool> = { v: 'select', n: 'room', a: 'add', x: 'cut', b: 'wall', u: 'unwall', d: 'door', e: 'entrance', w: 'window', k: 'kanban', p: 'pod', m: 'lead', l: 'lobby', o: 'kit' }
