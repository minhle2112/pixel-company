import raw from '../../maps/office.tmj?raw'

/*
 * Bản đồ văn phòng vẽ bằng Tiled: maps/office.tmj (ô 16 px, 1 m = 2 ô).
 * File này chỉ đọc dữ liệu (không vẽ): các layer ô, tileset, và các mốc trong layer Markers.
 * Ảnh của tileset trỏ tới maps/art/... (bản chép gói LimeZu để mở bằng Tiled); trong game, cùng đường dẫn
 * sau "art/" được nạp từ /limezu/... (gói hình gốc, xem server/limezu.ts).
 */

interface TmjTileLayer { type: 'tilelayer'; name: string; width: number; height: number; data: number[] }
interface TmjObject { name: string; type: string; x: number; y: number; width: number; height: number; point?: boolean }
interface TmjObjectLayer { type: 'objectgroup'; name: string; objects: TmjObject[] }
interface Tmj {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  backgroundcolor?: string
  layers: (TmjTileLayer | TmjObjectLayer | { type: 'imagelayer' | 'group'; name: string })[]
  tilesets: { firstgid: number; source: string }[]
}
interface Tsj { name: string; image: string; columns: number; tilecount: number; tilewidth: number; tileheight: number; margin: number; spacing: number }

const map = JSON.parse(raw) as Tmj
const tsjs = import.meta.glob('../../maps/tilesets/*.tsj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const MAP_TILE = map.tilewidth
export const MAP_COLS = map.width
export const MAP_ROWS = map.height
export const MAP_BG = map.backgroundcolor ? parseInt(map.backgroundcolor.slice(1), 16) : 0x1c1a26

export interface MapTileset { firstgid: number; key: string; columns: number; tilecount: number }

/** Đường dẫn tương đối kiểu POSIX, bỏ "." và ".." */
const join = (base: string, rel: string) => {
  const out: string[] = []
  for (const p of [...base.split('/'), ...rel.split('/')]) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

/** Sheet ảnh cần nạp cho bản đồ: khoá → đường dẫn trong gói LimeZu */
export const MAP_SHEETS: Record<string, string> = {}

export const MAP_TILESETS: MapTileset[] = map.tilesets
  .map(({ firstgid, source }) => {
    const path = join('maps', source)
    const text = tsjs[`../../${path}`]
    if (!text) throw new Error(`Bản đồ: thiếu tileset ${path}`)
    const ts = JSON.parse(text) as Tsj
    if (ts.tilewidth !== MAP_TILE || ts.tileheight !== MAP_TILE || ts.margin || ts.spacing) throw new Error(`Tileset ${ts.name}: chỉ hỗ trợ ô ${MAP_TILE} px, không lề`)
    const image = join(path.slice(0, path.lastIndexOf('/')), ts.image)
    if (!image.startsWith('maps/art/')) throw new Error(`Tileset ${ts.name}: ảnh phải nằm trong maps/art/`)
    const key = `map:${ts.name}`
    MAP_SHEETS[key] = image.slice('maps/art/'.length)
    return { firstgid, key, columns: ts.columns, tilecount: ts.tilecount }
  })
  .sort((a, b) => a.firstgid - b.firstgid)

/** Cờ lật ô của Tiled (3 bit cao). Bản đồ này không lật ô nào, nên chỉ cần bỏ chúng đi khi tra */
const FLIPS = 0xe0000000

/** Ô gid → sheet và toạ độ trong ảnh (pixel); null = ô trống */
export function tileAt(gid: number): { key: string; sx: number; sy: number } | null {
  const id = gid & ~FLIPS
  if (!id) return null
  for (let i = MAP_TILESETS.length - 1; i >= 0; i--) {
    const ts = MAP_TILESETS[i]
    if (id >= ts.firstgid) {
      const local = id - ts.firstgid
      if (local >= ts.tilecount) return null
      return { key: ts.key, sx: (local % ts.columns) * MAP_TILE, sy: Math.floor(local / ts.columns) * MAP_TILE }
    }
  }
  return null
}

/** Dữ liệu một layer ô (hàng trước, cột sau), theo tên trong Tiled */
export function mapLayer(name: string): number[] {
  const l = map.layers.find((x) => x.name === name)
  if (!l || l.type !== 'tilelayer') throw new Error(`Bản đồ: thiếu layer ô "${name}"`)
  if (l.width !== map.width || l.height !== map.height) throw new Error(`Layer "${name}" phải phủ cả bản đồ`)
  return l.data
}

/** Một mốc (object) trong layer Markers, theo tên */
export function marker(name: string): TmjObject {
  const l = map.layers.find((x) => x.name === 'Markers')
  const o = l && l.type === 'objectgroup' ? l.objects.find((x) => x.name === name) : undefined
  if (!o) throw new Error(`Bản đồ: thiếu mốc "${name}" trong layer Markers`)
  return o
}
