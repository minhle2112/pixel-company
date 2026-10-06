import { AnimatedSprite, Container, Graphics, NineSliceSprite, Sprite, TilingSprite, type Texture } from 'pixi.js'
import { DESK_ART, deskItemById, deskPlace, itemById, type DeskKind, type DeskTop, type View } from '../data/catalog'
import type { AgentStatus } from '../data/types'
import {
  BOARD, DESK_D, DESK_W, FURNITURE, OFFICE, WINDOWS, deskCenter, forward,
  type DeskSlot, type Furniture, type World,
} from '../world/layout'
import atlas from './atlas.json'
import { frames, region, sprite, stitch, stitchSrc, type SpriteName } from './assets'
import { MAP_H, MAP_W, PPM, TILE, WALL_FACE, px, py } from './geom'
import { MAP_BG, MAP_COLS, mapLayer, marker, tileAt } from './tilemap'
import { FAME_INNER, itemView, viewNode } from './catalogArt'
import { buildWalls, type WallView } from './walls'
import { ROOMS, building, isOpen, roomOfCell, type Room } from '../world/rooms'
import { HOUSE } from '../world/house'
import { cellX, cellZ, type OfficeState } from '../data/officeState'

/*
 * Dựng văn phòng pixel từ bố cục ở world/layout.ts: các phòng (tường giữa phòng, vách trong phòng: walls.ts), cửa sổ và
 * bảng ticket trên tường bắc, bàn của agent, đồ đã mua. Phòng còn khoá phủ tối (nhãn và giá: RoomMode.tsx).
 * - `floor`: sàn, tường bắc và mọi thứ treo trên đó (luôn nằm dưới nhân vật)
 * - `sorted`: đồ đạc đứng trên sàn, xếp lớp theo cạnh dưới (zIndex = y pixel của chân) cùng với nhân vật
 * - `top`: viền tường nam (luôn nằm trên cùng)
 */

export const OUTLINE = 0x2b2633
const GOLD = 0xf2c14e
/** Màu mặt bần của bảng LimeZu */
const CORK = 0xbe7149
export const CAP_FILL = 0xece8f1
export const CAP_SHADE = 0xc5bfd2

/** Viên tường LimeZu (16×32 trong Room_Builder_Walls) của tường giữa các phòng và vách cao (house.json walls.tall) */
export const WALL: [number, number, number, number] = [HOUSE.walls.tall[0] * 16, HOUSE.walls.tall[1] * 16, 16, 32]
/** Viên tường mà vách thấp lấy dải dưới làm mặt (house.json walls.low) */
export const LOW_WALL: [number, number, number, number] = [HOUSE.walls.low[0] * 16, HOUSE.walls.low[1] * 16, 16, 32]

/** Bàn cao bao nhiêu pixel (mặt trước bàn) */
const DESK_LIFT = 9

export interface Screen {
  slotId: string
  g: Graphics
  /** Vẽ lại màn hình theo trạng thái và thời gian */
  draw: (status: AgentStatus | null, t: number) => void
}

export interface OfficeView {
  floor: Container
  sorted: Container[]
  top: Container
  screens: Screen[]
  /** Vẽ lại bảng ticket trên tường (đếm ticket theo cột) */
  kanban: Graphics
  /** Vệt nắng qua cửa sổ (mờ đi khi trời tối) */
  sun: Graphics
  /** Kính cửa sổ (màu trời) và sao, đổi theo giờ */
  panes: Graphics
  stars: Graphics
  /** Nguồn sáng ban đêm (pixel gốc) */
  lights: Light[]
  /** Khung bảng ticket trên tường (pixel gốc), để bấm chuột */
  boards: { kanban: Rect }
  /** Tường, vách, cửa (làm mờ / mở cửa mỗi khung hình) */
  walls: WallView
  /** uid đồ đã mua → khung bấm chuột (pixel gốc), để chọn khi trang trí */
  itemHits: Map<string, Rect>
  /** Bảng vinh danh (nếu đã mua): nội dung vẽ lại khi EXP đổi, khung để bấm / đứng gần bấm E */
  fame: { g: Graphics; rect: Rect; x: number } | null
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Một nguồn sáng: đèn bàn / đèn cây (ấm), đèn trần (rộng, nhạt), màn hình (xanh, nhỏ) */
export interface Light {
  x: number
  y: number
  /** Bán kính (pixel gốc) */
  r: number
  kind: 'lamp' | 'ceiling' | 'screen'
  /** Màn hình máy ở bàn này (id chỗ ngồi): chỉ hắt sáng khi máy đang bật (xem Lighting.setScreens) */
  slot?: string
  /** Kẹp quầng sáng trong phòng (pixel gốc), để không tràn qua tường */
  clip?: { x: number; y: number; w: number; h: number }
}

export const sortAt = <T extends Container>(o: T, baseY: number): T => {
  o.zIndex = Math.round(baseY)
  return o
}

export function tiled(tex: Texture, x: number, y: number, w: number, h: number) {
  const t = new TilingSprite({ texture: tex, width: Math.round(w), height: Math.round(h) })
  t.position.set(Math.round(x), Math.round(y))
  return t
}

export function spr(name: SpriteName, cx: number, bottom: number, flip = false) {
  const s = new Sprite(sprite(name))
  s.anchor.set(0.5, 1)
  s.position.set(Math.round(cx), Math.round(bottom))
  if (flip) s.scale.x = -1
  return s
}

/** Hộp có viền tối kiểu LimeZu */
export function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, outline = OUTLINE) {
  g.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).fill(outline)
  g.rect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2).fill(fill)
}

// ───────────────────────── Sàn, tường (bản đồ Tiled) ─────────────────────────

/** Mép trên mặt tường bắc (pixel gốc) */
export const wallTop = () => py(OFFICE.minZ) - WALL_FACE

/** Các layer ô của maps/office.tmj, vẽ theo thứ tự từ dưới lên */
const MAP_LAYERS = ['Floor', 'FloorDecor', 'Walls', 'WallDecor', 'WallTop'] as const

/**
 * Vẽ bản đồ: mọi layer nằm dưới nhân vật (`floor`), trừ viền tường nam nằm trên cùng (`top`).
 * Hình giữ chỗ của bảng ticket trong bản đồ bị bỏ qua: game tự vẽ bảng có ticket thật ở mốc "kanban".
 */
function buildMap(floor: Container, top: Container) {
  floor.addChild(new Graphics().rect(0, 0, MAP_W, MAP_H).fill(MAP_BG))
  const kb = marker('kanban')
  const underBoard = (x: number, y: number) => x + TILE > kb.x && x < kb.x + kb.width && y + TILE > kb.y && y < kb.y + kb.height
  const south = py(OFFICE.maxZ)
  const tex = new Map<number, Texture>()
  for (const name of MAP_LAYERS) {
    const data = mapLayer(name)
    const below = new Container()
    const above = new Container()
    data.forEach((gid, i) => {
      const t = tileAt(gid)
      if (!t) return
      const x = (i % MAP_COLS) * TILE, y = Math.floor(i / MAP_COLS) * TILE
      if (name === 'WallDecor' && underBoard(x, y)) return
      let tx = tex.get(gid)
      if (!tx) tex.set(gid, (tx = region(t.key, t.sx, t.sy, TILE, TILE)))
      const s = new Sprite(tx)
      s.position.set(x, y)
      ;(name === 'WallTop' && y >= south ? above : below).addChild(s)
    })
    floor.addChild(below)
    if (above.children.length) top.addChild(above)
  }
}

/**
 * Phần màn hình của một phòng (pixel gốc, các khung không chồng nhau): sàn, cộng mặt tường bắc phía trên (cao WALL_FACE,
 * nằm trên hàng ô đầu), trừ hàng ô cuối khi phía nam là tường (mặt tường đó nhìn từ phòng phía nam, che mất hàng ô này).
 * Phòng chữ L, chữ T: mỗi cột ô một dải, gộp các cột liền nhau cùng dải.
 */
export function roomShade(rm: Room): Rect[] {
  const strips: Rect[] = []
  for (let c = rm.c0; c <= rm.c1; c++) {
    let r = rm.r0
    while (r <= rm.r1) {
      if (roomOfCell(c, r) !== rm) { r++; continue }
      const ra = r
      while (r + 1 <= rm.r1 && roomOfCell(c, r + 1) === rm) r++
      const y = Math.round(py(cellZ(ra))) - WALL_FACE
      // Phía nam là tường (không phải mép nhà): mặt tường che hàng cuối
      const south = roomOfCell(c, r + 1) !== rm && r + 1 < HOUSE.size[1]
      const bottom = Math.round(py(cellZ(r + 1))) - (south ? TILE : 0)
      const x = Math.round(px(cellX(c)))
      const last = strips[strips.length - 1]
      if (last && last.x + last.w === x && last.y === y && last.h === bottom - y) last.w += TILE
      else strips.push({ x, y, w: TILE, h: bottom - y })
      r++
    }
  }
  return strips
}

// ───────────────────────── Đồ treo tường bắc ─────────────────────────

/** Hai ô kính trong hình cửa sổ LimeZu (25×20): x 2–10 và 14–22, y 3–15 */
export const PANES = [[2, 3, 9, 13], [14, 3, 9, 13]] as const

/**
 * Khung hình cửa sổ ở toạ độ x (mét) trên tường bắc (pixel gốc). Bản đồ đặt mỗi cửa sổ thành 2×2 ô, mép trái ở
 * px(x) − 1 ô, mép trên ở mép trên tường; hình nằm lệch trong ô đúng như trong sheet LimeZu.
 */
export function windowBox(x: number): Rect {
  const [, sx, sy, w, h] = atlas.sprites.window as [string, number, number, number, number]
  return { x: Math.round(px(x)) - TILE + (sx % TILE), y: wallTop() + (sy % TILE), w, h }
}

function buildWallDecor(floor: Container) {
  // Nắng xiên qua cửa sổ: vệt sáng nhạt trên sàn
  const sun = new Graphics()
  const y0 = py(OFFICE.minZ)
  for (const x of WINDOWS) {
    const cx = px(x)
    sun.poly([cx - 12, y0, cx + 12, y0, cx + 22, y0 + 44, cx - 2, y0 + 44]).fill({ color: 0xfff1c9, alpha: 0.2 })
  }
  floor.addChild(sun)
  // Hình cửa sổ có sẵn trong bản đồ; ở đây chỉ phủ màu trời (trong suốt ban ngày) và vài ngôi sao ban đêm lên ô kính
  const panes = new Graphics()
  const stars = new Graphics()
  for (const x of WINDOWS) {
    const { x: left, y: top } = windowBox(x)
    for (const [dx, dy, pw, ph] of PANES) panes.rect(left + dx, top + dy, pw, ph).fill(0xffffff)
    for (const [dx, dy] of [[4, 5], [8, 11], [16, 7], [20, 13], [18, 4]]) stars.rect(left + dx, top + dy, 1, 1).fill(0xfff6d0)
  }
  floor.addChild(panes, stars)
  return { sun, panes, stars }
}

/** Khung bảng ticket trên tường bắc (pixel gốc, chưa tính bóng đổ) */
export function boardBox(): Rect {
  const w = Math.round(BOARD.w * PPM), h = 26
  return { x: Math.round(px(BOARD.x) - w / 2), y: wallTop() + 3, w, h }
}

/** Khung bảng treo tường bắc, trả về Graphics để vẽ nội dung */
function wallBoard(floor: Container, frame: 'corkboard' | 'chalkWall', inner?: number) {
  const { x, y, w, h } = boardBox()
  const g = new Graphics()
  g.rect(x + 1, y + h, w - 2, 2).fill({ color: 0x000000, alpha: 0.22 })
  floor.addChild(g)
  const bd = new Sprite(stitch(frame, w, h, 4, 4, 4, 5))
  bd.position.set(x, y)
  floor.addChild(bd)
  // Bảng ticket: phủ lại mặt bần trơn để các mẩu giấy là dữ liệu thật
  if (inner !== undefined) floor.addChild(new Graphics().rect(x + 3, y + 3, w - 6, h - 7).fill(inner))
  const content = new Graphics()
  content.position.set(x + 4, y + 4)
  floor.addChild(content)
  return { content, w: w - 8, h: h - 9, rect: { x, y, w, h: h + 2 } }
}

let kanbanBox = { w: 0, h: 0 }

const MEDAL = [0xf2c14e, 0xc9ced8, 0xd08a4e]

/** Bảng vinh danh: 3 agent nhiều EXP nhất, mỗi người một dòng (huy chương, thanh EXP theo màu áo) */
export function drawFame(g: Graphics, top: { color: number; exp: number }[]) {
  g.clear()
  const max = Math.max(1, ...top.map((t) => t.exp))
  const { w } = FAME_INNER
  top.slice(0, 3).forEach((t, k) => {
    const y = k * 5
    g.rect(0, y, 3, 3).fill(MEDAL[k])
    g.rect(5, y, 3, 3).fill(t.color)
    g.rect(10, y + 1, Math.max(2, Math.round(((w - 12) * t.exp) / max)), 1).fill({ color: 0xf4f1e8, alpha: 0.85 })
  })
}

/** Bảng ticket: 5 cột, mỗi ticket một mẩu giấy màu (tối đa 8 mẩu mỗi cột) */
export function drawKanban(g: Graphics, counts: { color: string; n: number }[]) {
  g.clear()
  const { w, h } = kanbanBox
  const cw = w / counts.length
  counts.forEach((c, i) => {
    const x = Math.round(i * cw)
    g.rect(x + 1, 0, Math.round(cw) - 2, 2).fill(c.color)
    const n = Math.min(c.n, 8)
    for (let k = 0; k < n; k++) {
      const col = k % 2, row = Math.floor(k / 2)
      g.rect(x + 2 + col * Math.floor((cw - 3) / 2), 4 + row * 3, Math.floor((cw - 6) / 2), 2).fill(c.color)
    }
    if (i) g.rect(x, 3, 1, h - 4).fill({ color: 0x000000, alpha: 0.12 })
  })
}

// ───────────────────────── Bàn làm việc ─────────────────────────

/**
 * Mặt bàn: hình bàn trong items.json (mặc định bàn văn phòng LimeZu Modern Office), giữ mép và chân bàn,
 * lặp phần giữa cho đủ kích thước. `gold`: nẹp vàng mặt trước bàn (agent đã mua cúp vàng để bàn).
 */
function deskTop(art: DeskTop, x: number, y: number, w: number, d: number, gold: boolean) {
  const X = Math.round(x), Y = Math.round(y), W = Math.round(w), D = Math.round(d)
  const c = new Container()
  c.addChild(new Graphics().rect(X + 2, Y + D + DESK_LIFT - 2, W - 1, 3).fill({ color: 0x000000, alpha: 0.2 }))
  const t = new Sprite(stitchSrc(art.src, W, D + DESK_LIFT, art.l, art.r, art.t, art.b))
  t.position.set(X, Y)
  c.addChild(t)
  if (gold) {
    // Nẹp vàng chạy dọc mặt trước bàn (dưới mép mặt bàn), có viền tối bên dưới cho ra khối
    const g = new Graphics()
    g.rect(X + 2, Y + D + 1, W - 4, 2).fill(GOLD)
    g.rect(X + 2, Y + D + 1, W - 4, 1).fill(0xffe9a8)
    g.rect(X + 2, Y + D + 3, W - 4, 1).fill(0x9a6b14)
    c.addChild(g)
  }
  return c
}

const SCREEN_BG: Record<AgentStatus, number> = {
  running: 0x0f1d17, idle: 0x14203a, paused: 0x07090d, error: 0x3a0d0d, terminated: 0x050608,
}

/** Màn hình sống: đang chạy thì chữ chạy, rảnh thì màn chờ, lỗi thì nháy đỏ */
function liveScreen(slotId: string, r: { x: number; y: number; w: number; h: number }, phase: number): Screen {
  const g = new Graphics()
  const draw = (st: AgentStatus | null, t: number) => {
    g.clear()
    if (r.w < 3 || r.h < 3) {
      // Mặt sau / nhìn ngang: chỉ một vệt sáng hắt ra
      const col = !st || st === 'paused' || st === 'terminated' ? 0x1a1e26 : st === 'error' ? 0xef5a4c : st === 'running' ? 0x3ccf6e : 0x6c8ed8
      g.rect(r.x, r.y, r.w, r.h).fill(col)
      return
    }
    g.rect(r.x, r.y, r.w, r.h).fill(st ? SCREEN_BG[st] : 0x07090d)
    if (st === 'running') {
      const shift = Math.floor(t * 3 + phase) % 4
      for (let row = 0; row < r.h; row += 2) {
        const len = 2 + ((row * 7 + shift * 5 + Math.floor(phase)) % (r.w - 2))
        g.rect(r.x + 1, r.y + row + (shift % 2), Math.min(len, r.w - 2), 1).fill(row % 4 ? 0x3ccf6e : 0x9be7b4)
      }
    } else if (st === 'idle') {
      const k = Math.floor(t * 0.8 + phase) % (r.w - 2)
      g.rect(r.x + 1 + k, r.y + 1 + (k % (r.h - 2)), 2, 1).fill(0x6c8ed8)
    } else if (st === 'error') {
      if (Math.floor(t * 2 + phase) % 2) g.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2).fill(0xb3261e)
      g.rect(r.x + Math.floor(r.w / 2) - 1, r.y + 1, 2, r.h - 3).fill(0xffd6d1)
    }
  }
  return { slotId, g, draw }
}

/** Ghế da (đồ để bàn): ghế hội nghị LimeZu nhuộm nâu da */
const LEATHER = 0xb07a5a

/**
 * Bàn của một chỗ ngồi + ghế, kèm đồ trên bàn: máy tính, bàn phím, cốc và đồ để bàn agent ngồi đây đã mua
 * (cây, khung ảnh, màn hình thứ hai, đèn bàn, ghế da, cúp + viền vàng). Hình và chỗ đặt từng món theo kiểu bàn
 * ở `desk.things` trong items.json (trang cắt hình). Bàn trống / agent chưa mua gì: bàn cơ bản miễn phí.
 * Bàn quay về nam (người ngồi phía bắc, nhìn về camera), về bắc (người ngồi quay lưng), hoặc về đông / tây.
 */
function buildDesk(s: DeskSlot, own: ReadonlySet<string>, sorted: Container[], screens: Screen[], lights: Light[], phase: number) {
  // Đồ để bàn đã bị bỏ khỏi items.json (trang cắt hình): agent có mua rồi cũng không còn
  const has = (id: string) => own.has(id) && deskItemById.has(id)
  const c = deskCenter(s)
  const f = forward(s.yaw)
  const side = Math.abs(f.x) > 0.5
  const kind: DeskKind = side ? 'side' : f.z > 0 ? 'front' : 'back'
  // Khung mặt bàn (pixel): bàn quay ngang thì đổi chiều rộng / sâu
  const [mw, md] = side ? [DESK_D, DESK_W] : [DESK_W, DESK_D]
  const x = px(c.x - mw / 2), y = py(c.z - md / 2) - DESK_LIFT
  const base = py(c.z + md / 2)
  const desk = new Container()
  desk.addChild(deskTop(side ? DESK_ART.side ?? DESK_ART.top : DESK_ART.top, x, y, mw * PPM, md * PPM, has('trophy')))

  // Bàn quay ngang phía tây người ngồi (bạn đã xoay bàn): lật gương cả bàn quanh tâm bàn
  const west = side && f.x < 0
  const mid = Math.round(px(c.x))
  const mirror = (v: number) => (west ? 2 * mid - v : v)
  // Món ở hàng xa (chân cao hơn trên màn hình) vẽ trước, hàng gần vẽ đè lên; màn hình sáng nằm trên cùng
  const X = Math.round(x), Y = Math.round(y)
  const shown = DESK_ART.things.flatMap((t, k) => {
    const p = deskPlace(t, kind, has)
    return p ? [{ t, k, ...p }] : []
  })
  shown.sort((a, b) => a.at.y - b.at.y || a.k - b.k)
  const lit: Rect[] = []
  for (const { t, view, at } of shown) {
    const n = viewNode(view, !!view.flip)
    n.position.set(X + at.x, Y + at.y)
    desk.addChild(n)
    const [sx, sy, sw, sh] = view.screen ?? [0, 0, 0, 0]
    if (view.screen) lit.push({ x: X + at.x + sx, y: Y + at.y + sy, w: sw, h: sh })
    if (t.light) lights.push({ x: mirror(X + at.x + t.light[0]), y: Y + at.y + t.light[1], r: 30, kind: 'lamp' })
  }
  if (west) {
    desk.scale.x = -1
    desk.x = 2 * mid
  }
  // Màn hình đầu tiên (máy tính) hắt sáng khi máy bật; màn thứ hai chạy lệch nhịp
  lit.forEach((r, k) => {
    if (k === 0) lights.push({ x: mirror(r.x + r.w / 2), y: r.y + r.h / 2, r: 14, kind: 'screen', slot: s.id })
    const live = liveScreen(s.id, r, phase + 2.3 * k)
    desk.addChild(live.g)
    screens.push(live)
  })
  sorted.push(sortAt(desk, base))

  // Ghế (hình trong items.json, điểm neo ở chỗ ngồi); ghế da: bản da nếu có, không thì nhuộm nâu bản thường
  const seatX = Math.round(px(s.seat.x)), seatY = Math.round(py(s.seat.z))
  const chair = (plain: View, leather: View | undefined, flip: boolean, z: number) => {
    const v = has('chair') && leather ? leather : plain
    const n = viewNode(v, flip)
    if (has('chair') && !leather) for (const p of n.children) (p as Sprite).tint = LEATHER
    n.position.set(seatX, seatY)
    sorted.push(sortAt(n, z))
  }
  const ch = DESK_ART.chair
  if (side) chair(ch.side, ch.sideLeather, f.x < 0, seatY - 2)
  // Người ngồi nhìn về camera: ghế sau lưng; ngồi quay lưng: lưng ghế che hông người ngồi
  else if (f.z > 0) chair(ch.front, ch.frontLeather, false, seatY - 1)
  else chair(ch.back, ch.backLeather, false, seatY + 1)
}

// ───────────────────────── Đồ cố định của phòng (FURNITURE trong layout.ts; đồ mua ở cửa hàng vẽ ở catalogArt.ts) ─────────────────────────

export function rug(f: Furniture) {
  const blue = f.color === '#7a8fb8' || f.color === '#4f9d94'
  const tex = sprite(blue ? 'rugBlue' : 'rugRed')
  const r = new NineSliceSprite({ texture: tex, leftWidth: 14, rightWidth: 14, topHeight: 12, bottomHeight: 12 })
  r.width = Math.round((f.w ?? 2) * PPM)
  r.height = Math.round((f.d ?? 2) * PPM)
  r.position.set(Math.round(px(f.x) - r.width / 2), Math.round(py(f.z) - r.height / 2))
  return r
}

/** Bàn họp: bàn hội nghị LimeZu (13_Conference_Hall), lặp phần giữa cho đủ 3,2 m; laptop trên bàn */
function meetingTable(f: Furniture) {
  const w = Math.round((f.w ?? 3.2) * PPM), d = Math.round((f.d ?? 1.4) * PPM)
  const c = new Container()
  const t = new Sprite(stitch('meetingTable', w, d + DESK_LIFT, 10, 12, 6, 12))
  t.position.set(Math.round(px(f.x) - w / 2), Math.round(py(f.z) - d / 2 - DESK_LIFT))
  c.addChild(t)
  if (!f.w) c.addChild(spr('laptopBack', px(f.x) + 22, py(f.z) - DESK_LIFT + 4))
  return sortAt(c, py(f.z + (f.d ?? 1.4) / 2))
}

/**
 * Dãy bếp LimeZu (12_Kitchen) nhìn chính diện, từ tây sang đông: tủ bếp có máy pha cà phê (vẽ riêng),
 * bồn rửa, bếp nấu, tủ bếp có lò vi sóng, tủ lạnh đứng. Chân các món thẳng hàng ở mép nam.
 */
function kitchen(f: Furniture) {
  const c = new Container()
  const base = py(f.z + (f.d ?? 0.7) / 2)
  let x = Math.round(px(f.x - (f.w ?? 3.4) / 2))
  for (const name of ['kitCounter2', 'kitSink', 'kitStove', 'kitCounter', 'kitCounter2', 'kitFridge', 'kitFridge'] as const) {
    const t = sprite(name)
    const s = new Sprite(t)
    s.position.set(x, base - t.height)
    c.addChild(s)
    if (name === 'kitCounter') c.addChild(spr('microwave', x + 15, base - t.height + 3))
    x += t.width
  }
  return sortAt(c, base)
}

/** Nhiều mảnh ghép sát nhau theo chiều ngang, căn giữa tại cx, chân ở bottom */
function row(names: SpriteName[], cx: number, bottom: number) {
  const c = new Container()
  const total = names.reduce((w, n) => w + sprite(n).width, 0)
  let x = Math.round(cx - total / 2)
  for (const n of names) {
    const t = sprite(n)
    const s = new Sprite(t)
    s.position.set(x, Math.round(bottom - t.height))
    c.addChild(s)
    x += t.width
  }
  return c
}

/** Bóng đổ nhạt sát chân đồ đạc (hình LimeZu không kèm bóng) */
export function withShadow(o: Container) {
  const b = o.getBounds()
  const g = new Graphics()
  g.ellipse(Math.round(b.x + b.width / 2), Math.round(b.y + b.height - 1), Math.max(4, Math.round(b.width * 0.46)), 3).fill({ color: 0x000000, alpha: 0.2 })
  const c = new Container()
  c.addChild(g, o)
  c.zIndex = o.zIndex
  return c
}

export function furniture(f: Furniture): Container | null {
  const bottom = (dz: number) => py(f.z + dz)
  switch (f.kind) {
    case 'plant': {
      const kind = f.color === 'palm' ? 'plantPalm' : f.color === 'tree' ? 'plantTree' : 'plantBig'
      return sortAt(spr(kind, px(f.x), bottom(0.25)), bottom(0.25))
    }
    case 'arcade': return sortAt(spr(f.color === '2' ? 'arcade2' : 'arcade1', px(f.x), bottom(0.25)), bottom(0.25))
    case 'plantSmall': return sortAt(spr('plantSmall', px(f.x), bottom(0.2)), bottom(0.2))
    case 'bookshelf': return sortAt(spr('bookshelf', px(f.x), bottom(0.25)), bottom(0.25))
    case 'sofa': return sortAt(spr('sofaV', px(f.x), bottom(0.95), true), bottom(0.95))
    case 'coffeeTable': return sortAt(spr('coffeeTable', px(f.x), bottom(0.3)), bottom(0.3))
    case 'foosball': return sortAt(spr('pingpongBig', px(f.x), bottom(0.8)), bottom(0.8))
    case 'kitchen': return kitchen(f)
    case 'tvStand': return sortAt(row(['tvStand', 'tvStand2'], px(f.x), bottom(0.3)), bottom(0.3))
    case 'sofaBack': return sortAt(row(['sofaBackL', 'sofaBackM', 'sofaBackR'], px(f.x), bottom(0.4)), bottom(0.4))
    case 'floorLamp': return sortAt(spr('floorLamp', px(f.x), bottom(0.15)), bottom(0.15))
    case 'chalkboard': return sortAt(spr('chalkboard', px(f.x), bottom(0.15)), bottom(0.15))
    case 'bench': return sortAt(spr('bench', px(f.x), bottom(0.25)), bottom(0.25))
    case 'bookshelfWide': return sortAt(spr('bookshelfWide', px(f.x), bottom(0.2)), bottom(0.2))
    // Đĩa trái cây đặt trên bàn cao: vẽ sau bàn
    case 'fruitBowl': return sortAt(spr('fruitBowl', px(f.x), bottom(0) - 6), bottom(0.6) + 1)
    case 'coffeeMachine': {
      const a = new AnimatedSprite(frames('coffee', 16, 32))
      a.anchor.set(0.5, 1)
      a.position.set(Math.round(px(f.x)), Math.round(bottom(0.35) - 4))
      a.animationSpeed = 0.08
      a.play()
      // Đặt trên mặt tủ bếp: vẽ sau dãy bếp
      return sortAt(a, bottom(0.35) + 1)
    }
    case 'fridge': {
      const s = spr('fridge', px(f.x) - 4, bottom(0.35))
      return sortAt(s, bottom(0.35))
    }
    case 'highTable': return sortAt(spr('highTable', px(f.x), bottom(0.3)), bottom(0.3))
    case 'stool': return sortAt(spr('stool', px(f.x), bottom(0.15)), bottom(0.15))
    case 'meetingTable': return meetingTable(f)
    case 'meetingChair': {
      const turned = Math.abs(Math.sin(f.yaw ?? 0)) > 0.5
      if (!turned && Math.cos(f.yaw ?? 0) < 0) {
        const c = new Container()
        c.addChild(spr('chairFront', px(f.x), bottom(0.05)), spr('chairBack', px(f.x), bottom(0.2)))
        return sortAt(c, bottom(0.2))
      }
      return sortAt(spr('chairFront', px(f.x), bottom(0.15)), bottom(-0.1))
    }
    case 'waterCooler': return sortAt(spr(f.color === 'jug' ? 'moCooler' : 'vending', px(f.x), bottom(0.25)), bottom(0.25))
    // Máy in đặt trên tủ hồ sơ (cùng toạ độ với tủ): vẽ sau tủ
    case 'printer': return sortAt(spr('moPrinter', px(f.x), bottom(0.3) - 18), bottom(0.3) + 1)
    case 'cabinet': return sortAt(spr('cabinet', px(f.x), bottom(0.3)), bottom(0.3))
    case 'whiteboard': return sortAt(spr('whiteboard', px(f.x), bottom(0.15)), bottom(0.15))
    case 'beanbag': return sortAt(spr('armchair', px(f.x), bottom(0.35)), bottom(0.35))
    // TV treo tường, thảm, cửa: vẽ riêng
    default: return null
  }
}

export function buildOffice(world: World, office: OfficeState): OfficeView {
  const floor = new Container()
  const top = new Container()
  const sorted: Container[] = []
  const screens: Screen[] = []

  buildMap(floor, top)
  const { sun, panes, stars } = buildWallDecor(floor)
  const kb = wallBoard(floor, 'corkboard', CORK)
  kanbanBox = { w: kb.w, h: kb.h }

  for (const f of FURNITURE) {
    const o = furniture(f)
    if (o) sorted.push(f.kind === 'fruitBowl' || f.kind === 'coffeeMachine' || f.kind === 'printer' ? o : withShadow(o))
  }
  const lights: Light[] = []
  // Bàn cơ bản miễn phí cho mỗi agent, kèm đồ để bàn agent ngồi đó đã mua
  const ownerOf = new Map([...world.seatOf].map(([id, sl]) => [sl.id, id]))
  const none = new Set<string>()
  world.slots.forEach((s, i) => {
    const who = ownerOf.get(s.id)
    buildDesk(s, who ? new Set(office.deskItems[who] ?? []) : none, sorted, screens, lights, i * 1.7)
  })
  // Đèn trần trên mỗi cụm bàn (ánh sáng tràn nhẹ ra ngoài), đèn cửa vào.
  // Chỗ khác sáng nhờ đèn có thật: màn hình, đèn cây, đèn bàn mua ở cửa hàng.
  for (const p of world.pods) lights.push({ x: px(p.x), y: py(p.z), r: 3.3 * PPM, kind: 'ceiling' })
  for (const f of FURNITURE) {
    if (f.kind === 'door') lights.push({ x: px(f.x), y: py(f.z) - 12, r: 1.5 * PPM, kind: 'lamp' })
  }

  // Đồ mua ở cửa hàng: thảm nằm dưới cùng (ngay trên sàn), đồ treo trên tường bắc, đồ đứng xếp lớp cùng người
  const rugs = new Container()
  const hung = new Container()
  floor.addChild(rugs, hung)
  const itemHits = new Map<string, Rect>()
  let fame: OfficeView['fame'] = null
  for (const p of office.items) {
    const i = itemById.get(p.item)
    if (!i || p.stored) continue
    const fg = i.id === 'fame' ? new Graphics() : undefined
    const v = itemView(i, p.c, p.r, p.rot, fg)
    if (v.layer === 'floor') (i.mount === 'rug' ? rugs : hung).addChild(v.node)
    else sorted.push(v.node)
    if (v.front) sorted.push(v.front)
    if (v.light) lights.push(v.light)
    itemHits.set(p.uid, v.hit)
    if (fg) fame = { g: fg, rect: v.hit, x: v.hit.x + v.hit.w / 2 }
  }
  const walls = buildWalls(building(office))
  sorted.push(...walls.sorted)
  // Phòng còn khoá: phủ tối cả sàn lẫn mặt tường bắc của phòng (trên mọi thứ, dưới ngày/đêm)
  const locked = new Graphics()
  for (const rm of ROOMS) {
    if (isOpen(office, rm.id)) continue
    for (const { x, y, w, h } of roomShade(rm)) {
      locked.rect(x, y, w, h).fill({ color: 0x0b0a12, alpha: 0.78 })
      // Sọc chéo thưa cho ra "chưa dùng tới" (theo toạ độ màn hình, để các dải nối liền nhau)
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x + ((((x + yy - 8) % 12) + 12) % 12 ? 12 - ((((x + yy - 8) % 12) + 12) % 12) : 0); xx < x + w; xx += 12)
          if ((xx & 1) === 0) locked.rect(xx, yy - 1, 1, 1).fill({ color: 0xffffff, alpha: 0.05 })
    }
  }
  top.addChild(locked)
  // Mỗi phòng đã mở (trừ phòng có cụm bàn, đã có đèn trên bàn) một đèn trần giữa khúc lớn nhất
  for (const rm of ROOMS) {
    if (rm.desks || !isOpen(office, rm.id)) continue
    const m = rm.main
    const clip = { x: px(m.minX), y: py(m.minZ) - WALL_FACE, w: (m.maxX - m.minX) * PPM, h: (m.maxZ - m.minZ) * PPM + WALL_FACE }
    lights.push({ x: px((m.minX + m.maxX) / 2), y: py((m.minZ + m.maxZ) / 2), r: 3.6 * PPM, kind: 'ceiling', clip })
  }

  return { floor, sorted, top, screens, kanban: kb.content, sun, panes, stars, lights, boards: { kanban: kb.rect }, walls, itemHits, fame }
}
