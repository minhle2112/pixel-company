// Sinh src/world/mapMarkers.ts từ layer "Markers" và "Collision" của maps/office.tmj.
// room.ts lấy vị trí cửa sổ, bảng ticket, cửa, chỗ xuất hiện, sảnh chờ, cụm bàn, vùng chặn từ file sinh ra này, nên trang lẫn server
// (Node, không đọc được .tmj) dùng chung một nguồn. Vite tự chạy lại khi map đổi (vite.config.ts); tay: `npm run map`.
// Mốc (Markers) do trang thiết kế nhà sinh từ src/data/house.json (src/world/houseMap.mjs); vùng chặn (Collision) vẽ trong Tiled.
// `--check`: chỉ kiểm file sinh ra có khớp map không (thoát 1 nếu lệch), dùng khi build.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(root, 'maps', 'office.tmj')
const OUT = path.join(root, 'src', 'world', 'mapMarkers.ts')

/** Nội dung mapMarkers.ts sinh từ map hiện tại */
export function render() {
  const map = JSON.parse(readFileSync(MAP, 'utf8'))
  const layer = map.layers.find((l) => l.name === 'Markers' && l.type === 'objectgroup')
  if (!layer) throw new Error('maps/office.tmj: thiếu layer Markers')
  const objs = layer.objects
  const one = (name) => {
    const o = objs.find((x) => x.name === name)
    if (!o) throw new Error(`maps/office.tmj: thiếu mốc "${name}"`)
    return o
  }
  // Đánh số theo tên (window1, window2, ...), không theo thứ tự vẽ trong Tiled
  const many = (prefix) => {
    const list = objs
      .filter((x) => new RegExp(`^${prefix}\\d+$`).test(x.name))
      .sort((a, b) => Number(a.name.slice(prefix.length)) - Number(b.name.slice(prefix.length)))
    if (!list.length) throw new Error(`maps/office.tmj: thiếu mốc "${prefix}1"`)
    return list
  }
  const rect = (o) => {
    if (o.point || !o.width || !o.height) throw new Error(`maps/office.tmj: mốc "${o.name}" phải là hình chữ nhật`)
    return { x: o.x, y: o.y, w: o.width, h: o.height }
  }
  // Vùng chặn: hình chữ nhật trong layer Collision (không có layer = không chặn gì).
  // Thuộc tính tuỳ chọn "height" (số, mét): cao bao nhiêu; không ghi = cao như tường (chặn cả camera)
  const coll = map.layers.find((l) => l.name === 'Collision')
  if (coll && coll.type !== 'objectgroup') throw new Error('maps/office.tmj: layer Collision phải là layer object')
  const block = (o) => {
    if (o.rotation) throw new Error(`maps/office.tmj: vùng chặn "${o.name || o.id}" không được xoay`)
    if (o.point || o.ellipse || o.polygon || o.polyline || o.gid || !o.width || !o.height)
      throw new Error(`maps/office.tmj: vùng chặn "${o.name || o.id}" phải là hình chữ nhật`)
    const height = o.properties?.find((p) => p.name === 'height')?.value
    if (height !== undefined && !(typeof height === 'number' && height > 0)) throw new Error(`maps/office.tmj: vùng chặn "${o.name || o.id}": height phải là số mét > 0`)
    return { x: o.x, y: o.y, w: o.width, h: o.height, ...(height !== undefined ? { height } : {}) }
  }
  const point = (o) => {
    if (!o.point) throw new Error(`maps/office.tmj: mốc "${o.name}" phải là điểm`)
    return { x: o.x, y: o.y }
  }
  const data = {
    tile: map.tilewidth,
    room: rect(one('room')),
    windows: many('window').map(rect),
    kanban: rect(one('kanban')),
    door: rect(one('door')),
    spawn: point(one('spawn')),
    lobby: many('lobby').map(point),
    pods: many('pod').map(point),
    // Bàn riêng của Lead (tuỳ chọn): điểm = chỗ ngồi, thuộc tính face = hướng nhìn n / s / e / w
    leads: objs
      .filter((x) => /^lead\d+$/.test(x.name))
      .sort((a, b) => Number(a.name.slice(4)) - Number(b.name.slice(4)))
      .map((o) => {
        const face = o.properties?.find((p) => p.name === 'face')?.value ?? 's'
        if (!['n', 's', 'e', 'w'].includes(face)) throw new Error(`maps/office.tmj: mốc "${o.name}": face phải là n / s / e / w`)
        return { ...point(o), face }
      }),
    blocks: (coll?.objects ?? []).map(block),
  }
  const r = (v) => Math.round(v * 1000) / 1000
  const fmt = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : r(v)}`).join(', ')} }`
  const list = (key, xs) => xs.length ? [`  ${key}: [`, ...xs.map((b) => `    ${fmt(b)},`), '  ],'].join('\n') : `  ${key}: [],`
  return [
    '// FILE SINH TỰ ĐỘNG từ layer "Markers" và "Collision" của maps/office.tmj (scripts/map-markers.mjs). Đừng sửa tay.',
    '// Đơn vị: pixel của map, gốc ở góc tây bắc map.',
    '',
    'export interface MapRect { x: number; y: number; w: number; h: number }',
    'export interface MapPoint { x: number; y: number }',
    '/** Vùng chặn (layer Collision): height = cao bao nhiêu mét, không ghi = cao như tường */',
    'export interface MapBlock extends MapRect { height?: number }',
    '',
    'export const MAP_MARKERS: {',
    '  tile: number; room: MapRect; windows: MapRect[]; kanban: MapRect; door: MapRect; spawn: MapPoint; lobby: MapPoint[]; pods: MapPoint[]',
    "  leads: (MapPoint & { face: 'n' | 's' | 'e' | 'w' })[]",
    '  blocks: MapBlock[]',
    '} = {',
    `  tile: ${data.tile},`,
    `  room: ${fmt(data.room)},`,
    `  windows: [${data.windows.map(fmt).join(', ')}],`,
    `  kanban: ${fmt(data.kanban)},`,
    `  door: ${fmt(data.door)},`,
    `  spawn: ${fmt(data.spawn)},`,
    `  lobby: [${data.lobby.map(fmt).join(', ')}],`,
    `  pods: [${data.pods.map(fmt).join(', ')}],`,
    `  leads: [${data.leads.map(fmt).join(', ')}],`,
    list('blocks', data.blocks),
    '}',
    '',
  ].join('\n')
}

/** Ghi lại file nếu nội dung đổi; trả true nếu có ghi */
export function writeMarkers() {
  const next = render()
  let prev = ''
  try { prev = readFileSync(OUT, 'utf8') } catch { /* chưa có */ }
  if (prev.replace(/\r\n/g, '\n') === next) return false
  writeFileSync(OUT, next)
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const prev = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n')
    if (prev !== render()) {
      console.error('src/world/mapMarkers.ts lệch với maps/office.tmj: chạy `npm run map`')
      process.exit(1)
    }
  } else {
    console.log(writeMarkers() ? 'map: đã cập nhật src/world/mapMarkers.ts' : 'map: src/world/mapMarkers.ts đã khớp')
  }
}
