// Nhà (src/data/house.json, sửa ở trang thiết kế nhà cutter.html) → lưới phòng / tường và các layer của maps/office.tmj.
// Không dùng gì của Node hay trình duyệt: game (src/world/rooms.ts), trang thiết kế nhà (xem trước) và server (ghi file)
// dùng chung. Kiểu dữ liệu: houseMap.d.mts.

/** Ô 16 px */
const T = 16
/** Ô (c, r) của nhà nằm ở ô (c + 1, r + 3) của bản đồ: viền tây 1 ô, phía bắc 1 hàng trống + 2 hàng tường */
export const MAP_DX = 1
export const MAP_DY = 3

/** Mã ô trong từng tileset (số thứ tự ô, chưa cộng firstgid) */
const BORDER = { nw: 51, ne: 53, w: 2, e: 3, sw: 141, s: 142, se: 143 }
const MAT = [[736, 738], [752, 754]]
const WINDOW = [[696, 697], [712, 713]]
const BOARD = [[93, 94], [109, 110]]
const WALLS_COLS = 32
const FLOORS_COLS = 15

/** Mỗi ô của nhà: chỉ số phòng (≥ 0), -1 = tường (sát một phòng, kể cả chéo), -2 = ngoài nhà */
export function houseGrid(h) {
  const [W, H] = h.size
  const g = new Int16Array(W * H).fill(-2)
  h.rooms.forEach((rm, k) => {
    for (const [c0, r0, c1, r1] of rm.rects)
      for (let r = Math.max(0, r0); r <= Math.min(H - 1, r1); r++)
        for (let c = Math.max(0, c0); c <= Math.min(W - 1, c1); c++) if (g[r * W + c] === -2) g[r * W + c] = k
  })
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      if (g[r * W + c] !== -2) continue
      near: for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc, rr = r + dr
          if (cc >= 0 && rr >= 0 && cc < W && rr < H && g[rr * W + cc] >= 0) {
            g[r * W + c] = -1
            break near
          }
        }
    }
  return g
}

/** Ô (c, r) → chỉ số phòng / -1 / -2; ngoài lưới = -3 */
export const gridAt = (h, g, c, r) => (c >= 0 && r >= 0 && c < h.size[0] && r < h.size[1] ? g[r * h.size[0] + c] : -3)

/**
 * Các cửa giữa hai phòng: ô, nằm trên tường dọc hay ngang, hai phòng hai bên (null = không có phòng).
 * Tên cửa = "phòngA-phòngB" (trùng thì thêm -2, -3...).
 */
export function houseDoors(h, g) {
  const room = (c, r) => {
    const k = gridAt(h, g, c, r)
    return k >= 0 ? h.rooms[k].id : null
  }
  const used = new Map()
  return h.doors.map((rect) => {
    const [c0, r0, c1, r1] = rect
    const cells = []
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push([c, r])
    const vertical = r1 - r0 > c1 - c0 || (r1 === r0 && c1 === c0 && !!room(c0 - 1, r0))
    const a = vertical ? room(c0 - 1, r0) : room(c0, r0 - 1)
    const b = vertical ? room(c1 + 1, r0) : room(c0, r1 + 1)
    const base = `${a ?? 'ngoài'}-${b ?? 'ngoài'}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return { id: n > 1 ? `${base}-${n}` : base, rect, cells, vertical, rooms: [a, b] }
  })
}

/** Vách trong phòng (h.partitions: [c0, r0, c1, r1, loại]): ô "c,r" → loại ('low' | 'tall' | 'door'). Đoạn sau đè đoạn trước */
export function housePartitions(h) {
  const out = new Map()
  for (const [c0, r0, c1, r1, kind] of h.partitions ?? [])
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.set(`${c},${r}`, kind)
  return out
}

/** firstgid của các tileset bản đồ cần dùng, theo tên tileset (floors, walls, borders, generic, classroom) */
export function tilesetGids(tmj, nameOf) {
  const out = {}
  for (const ts of tmj.tilesets) out[nameOf(ts.source)] = ts.firstgid
  for (const k of ['floors', 'walls', 'borders', 'generic', 'classroom'])
    if (!out[k]) throw new Error(`maps/office.tmj: thiếu tileset ${k}`)
  return out
}

/** Tên tileset theo đường dẫn file .tsj ("tilesets/floors.tsj" → "floors") */
export const tsName = (source) => source.slice(source.lastIndexOf('/') + 1).replace(/\.tsj$/, '')

/**
 * Các layer ô của bản đồ (mảng gid, hàng trước cột sau, cỡ (W + 2) × (H + 5)): sàn theo từng phòng, tường bắc
 * (chỉ phía trên cột có phòng ở hàng đầu), viền toà nhà, thảm cửa vào, cửa sổ, hình giữ chỗ bảng ticket.
 * Tường giữa các phòng và vách trong phòng không nằm trong bản đồ: game tự vẽ (src/pixel/walls.ts).
 */
export function houseLayers(h, gids) {
  const [W, H] = h.size
  const MW = W + 2, MH = H + 5
  const g = houseGrid(h)
  const grid = () => new Array(MW * MH).fill(0)
  const set = (layer, col, row, v) => {
    if (col >= 0 && row >= 0 && col < MW && row < MH) layer[row * MW + col] = v
  }
  const Floor = grid(), FloorDecor = grid(), Walls = grid(), WallDecor = grid(), WallTop = grid()
  const at = (c, r) => gridAt(h, g, c, r)
  const floorTile = (k, c, r, wall) => {
    const f = h.rooms[k].floor
    const [fc, fr, fw = 1, fh = 1] = f.fill
    // Hàng sát tường bắc của phòng: ô "top" (có bóng tường), cùng cột trong mẫu
    const top = !wall && f.top && at(c, r - 1) !== k
    const dc = ((c % fw) + fw) % fw
    const tc = top ? f.top[0] + dc : fc + dc
    const tr = top ? f.top[1] : fr + (((r % fh) + fh) % fh)
    return gids.floors + tr * FLOORS_COLS + tc
  }
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      let k = at(c, r)
      const wall = k === -1
      if (wall) {
        // Ô tường: sàn của phòng phía nam (tường ngang) hoặc hai bên (tường dọc); mặt tường che gần hết
        for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const n = at(c + dc, r + dr)
          if (n >= 0) {
            k = n
            break
          }
        }
      }
      if (k >= 0) set(Floor, c + MAP_DX, r + MAP_DY, floorTile(k, c, r, wall))
    }
  // Tường bắc: trên các cột có phòng (hoặc tường của phòng) ở hàng đầu
  const [nc, nr, nw = 1] = h.walls.north
  const wallTile = (c, row) => {
    const left = at(c - 1, 0) < -1, right = at(c + 1, 0) < -1
    const dc = nw >= 3 ? (left ? 0 : right ? 2 : 1) : 0
    return gids.walls + (nr + row) * WALLS_COLS + nc + dc
  }
  for (let c = 0; c < W; c++) {
    if (at(c, 0) < -1) continue
    set(Walls, c + MAP_DX, 1, wallTile(c, 0))
    set(Walls, c + MAP_DX, 2, wallTile(c, 1))
  }
  // Viền: hai bên và phía nam (chừa cửa vào 2 ô)
  const b = (id) => gids.borders + id
  set(WallTop, 0, 1, b(BORDER.nw))
  set(WallTop, MW - 1, 1, b(BORDER.ne))
  for (let row = 2; row <= H + 2; row++) {
    set(WallTop, 0, row, b(BORDER.w))
    set(WallTop, MW - 1, row, b(BORDER.e))
  }
  set(WallTop, 0, H + 3, b(BORDER.sw))
  set(WallTop, MW - 1, H + 3, b(BORDER.se))
  for (let c = 0; c < W; c++) if (c !== h.entrance && c !== h.entrance + 1) set(WallTop, c + MAP_DX, H + 3, b(BORDER.s))
  // Thảm cửa vào
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) set(FloorDecor, h.entrance + MAP_DX + j, H + 1 + i, gids.generic + MAT[i][j])
  // Cửa sổ (2 ô) và hình giữ chỗ bảng ticket (game vẽ bảng thật ở mốc kanban)
  for (const c of h.windows) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) set(WallDecor, c + MAP_DX + j, 1 + i, gids.generic + WINDOW[i][j])
  const [k0, kw] = h.kanban
  const km = k0 + Math.floor(kw / 2) - 1
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) set(WallDecor, km + MAP_DX + j, 1 + i, gids.classroom + BOARD[i][j])
  return { width: MW, height: MH, Floor, FloorDecor, Walls, WallDecor, WallTop }
}

/** Toạ độ ô (số thực) → pixel bản đồ */
const mx = (c) => Math.round((c + MAP_DX) * T * 10) / 10
const my = (r) => Math.round((r + MAP_DY) * T * 10) / 10

/** Chỗ bạn xuất hiện: ngay trong cửa vào (ô, số thực) */
export const spawnOf = (h) => [h.entrance + 1, h.size[1] - 3.6]

/**
 * Bản đồ mới từ nhà: giữ tileset, layer Collision và các layer lạ của bản cũ; sinh lại layer ô, Rooms (chỉ để xem
 * trong Tiled, khoá) và Markers (mốc cho game, xem scripts/map-markers.mjs).
 */
export function houseTmj(old, h) {
  const gids = tilesetGids(old, tsName)
  const L = houseLayers(h, gids)
  const [W, H] = h.size
  const MADE = ['Floor', 'FloorDecor', 'Walls', 'WallDecor', 'WallTop', 'Rooms', 'Markers']
  const keep = old.layers.filter((l) => !MADE.includes(l.name))
  let oid = Math.max(0, ...keep.flatMap((l) => (l.objects ?? []).map((o) => o.id))) + 1
  let lid = Math.max(0, ...keep.map((l) => l.id)) + 1
  const obj = (name, type, x, y, w, hh, extra = {}) => ({ id: oid++, name, type, x, y, rotation: 0, visible: true, width: w, height: hh, ...extra })
  const pt = (name, type, [c, r], extra = {}) => obj(name, type, mx(c), my(r), 0, 0, { point: true, ...extra })
  const cellRect = (name, type, [c0, r0, c1, r1]) => obj(name, type, mx(c0), my(r0), (c1 - c0 + 1) * T, (r1 - r0 + 1) * T)
  const g = houseGrid(h)
  const rooms = [
    ...h.rooms.flatMap((rm) => rm.rects.map((r) => cellRect(rm.id, 'room', r))),
    ...houseDoors(h, g).map((d) => cellRect(d.id, 'door', d.rect)),
  ]
  const markers = [
    obj('room', 'room', mx(0), my(0), W * T, H * T),
    ...h.windows.map((c, i) => obj(`window${i + 1}`, 'window', mx(c) - 8, T, 48, 32)),
    obj('kanban', 'kanban', mx(h.kanban[0]), T, h.kanban[1] * T, 32),
    obj('door', 'door', mx(h.entrance), (H + MAP_DY) * T, 32, 16),
    pt('spawn', 'spawn', spawnOf(h)),
    ...h.lobby.map((p, i) => pt(`lobby${i + 1}`, 'lobby', p)),
    ...h.pods.map((p, i) => pt(`pod${i + 1}`, 'pod', p)),
    ...(h.leads ?? []).map(([c, r, face], i) => pt(`lead${i + 1}`, 'lead', [c, r], { properties: [{ name: 'face', type: 'string', value: face }] })),
  ]
  const old1 = (name) => old.layers.find((l) => l.name === name) ?? {}
  const tl = (name) => ({
    id: old1(name).id ?? lid++, name, type: 'tilelayer', x: 0, y: 0, width: L.width, height: L.height, opacity: 1, visible: true, data: L[name],
  })
  const og = (name, color, objects, extra = {}) => ({
    draworder: 'topdown', color, opacity: 1, ...old1(name), id: old1(name).id ?? lid++, name, type: 'objectgroup', visible: true, x: 0, y: 0, objects, ...extra,
  })
  const layers = [
    tl('Floor'), tl('FloorDecor'), tl('Walls'), tl('WallDecor'), tl('WallTop'),
    og('Rooms', '#3fb07a', rooms, { locked: true, opacity: 0.8 }),
    ...keep,
    og('Markers', '#ff5c5c', markers),
  ]
  return { ...old, width: L.width, height: L.height, layers, nextlayerid: Math.max(lid, ...layers.map((l) => l.id + 1)), nextobjectid: oid }
}
