import type { AABB, Vec2 } from './layout'

/**
 * Tìm đường cho agent trên lưới ô 25 cm phủ cả văn phòng. Ô bị chặn = tâm ô nằm trong (hoặc sát hơn bán kính người)
 * một hộp va chạm: tường, bàn, đồ đạc. Dựng lại mỗi khi bố cục đổi (bàn mới, đồ, phòng mới mở).
 * Đường đi: A* 8 hướng (không cắt góc), rồi nắn thẳng những đoạn nhìn thấy nhau để agent không đi zíc zắc.
 */

export interface Nav {
  x0: number
  z0: number
  cell: number
  cols: number
  rows: number
  /** 1 = đi được */
  free: Uint8Array
}

const CELL = 0.25
/** Bán kính người khi tính chỗ đi được (rộng hơn bán kính va chạm một chút, để không sượt qua góc bàn) */
const BODY = 0.3

export function buildNav(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, boxes: AABB[], r = BODY): Nav {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / CELL)
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL)
  const free = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    const z = bounds.minZ + (j + 0.5) * CELL
    for (let i = 0; i < cols; i++) {
      const x = bounds.minX + (i + 0.5) * CELL
      let ok = true
      for (const b of boxes) {
        const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ)
        if (dx * dx + dz * dz < r * r) { ok = false; break }
      }
      free[j * cols + i] = ok ? 1 : 0
    }
  }
  return { x0: bounds.minX, z0: bounds.minZ, cell: CELL, cols, rows, free }
}

/** Bản đồ đường đi đang dùng (App dựng lại khi bố cục đổi) */
export const navRef: { current: Nav | null } = { current: null }

export const cellIndex = (n: Nav, p: Vec2) => cellOf(n, p)

/** Những ô đi tới được từ điểm `from` (loang 4 hướng): 1 = tới được */
export function flood(n: Nav, from: Vec2): Uint8Array {
  const seen = new Uint8Array(n.cols * n.rows)
  const s = nearestFree(n, cellOf(n, from))
  if (s < 0) return seen
  const q = [s]
  seen[s] = 1
  while (q.length) {
    const k = q.pop()!
    const i = k % n.cols, j = Math.floor(k / n.cols)
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= n.cols || nj >= n.rows) continue
      const nk = nj * n.cols + ni
      if (n.free[nk] && !seen[nk]) { seen[nk] = 1; q.push(nk) }
    }
  }
  return seen
}

function cellOf(n: Nav, p: Vec2) {
  const i = Math.min(n.cols - 1, Math.max(0, Math.floor((p.x - n.x0) / n.cell)))
  const j = Math.min(n.rows - 1, Math.max(0, Math.floor((p.z - n.z0) / n.cell)))
  return j * n.cols + i
}
const centerOf = (n: Nav, k: number): Vec2 => ({ x: n.x0 + ((k % n.cols) + 0.5) * n.cell, z: n.z0 + (Math.floor(k / n.cols) + 0.5) * n.cell })

export const walkable = (n: Nav, p: Vec2) => n.free[cellOf(n, p)] === 1

/** Ô đi được gần nhất (loang dần ra), -1 nếu không có */
function nearestFree(n: Nav, k: number): number {
  if (n.free[k]) return k
  const ci = k % n.cols, cj = Math.floor(k / n.cols)
  for (let rad = 1; rad < 12; rad++) {
    let best = -1, bd = Infinity
    for (let dj = -rad; dj <= rad; dj++) {
      for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue
        const i = ci + di, j = cj + dj
        if (i < 0 || j < 0 || i >= n.cols || j >= n.rows || !n.free[j * n.cols + i]) continue
        const d = di * di + dj * dj
        if (d < bd) { bd = d; best = j * n.cols + i }
      }
    }
    if (best >= 0) return best
  }
  return -1
}

/** Điểm đi được gần (x, z) nhất: để đặt chỗ đứng (cửa sổ, chỗ bụi...) không lọt vào trong đồ đạc */
export function snapFree(n: Nav, p: Vec2): Vec2 {
  const k = nearestFree(n, cellOf(n, p))
  return k < 0 || k === cellOf(n, p) ? { ...p } : centerOf(n, k)
}

/** Đoạn thẳng a → b chỉ đi qua ô đi được */
function clear(n: Nav, a: Vec2, b: Vec2) {
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.ceil(d / (n.cell * 0.4))
  for (let s = 1; s < steps; s++) {
    const t = s / steps
    if (!n.free[cellOf(n, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })]) return false
  }
  return true
}

/** Hàng đợi ưu tiên nhỏ (đống nhị phân) cho A* */
class Heap {
  private k: number[] = []
  private p: number[] = []
  get size() { return this.k.length }
  push(key: number, pri: number) {
    const { k, p } = this
    k.push(key); p.push(pri)
    let i = k.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (p[up] <= p[i]) break
      ;[k[up], k[i]] = [k[i], k[up]]; [p[up], p[i]] = [p[i], p[up]]
      i = up
    }
  }
  pop(): number {
    const { k, p } = this
    const top = k[0]
    const lk = k.pop()!, lp = p.pop()!
    if (k.length) {
      k[0] = lk; p[0] = lp
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < k.length && p[l] < p[m]) m = l
        if (r < k.length && p[r] < p[m]) m = r
        if (m === i) break
        ;[k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]]
        i = m
      }
    }
    return top
  }
}

const SQ2 = Math.SQRT2
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]] as const

/**
 * Đường từ `from` tới `to`: danh sách điểm (không gồm điểm đầu), điểm cuối đúng bằng `to`.
 * Không tìm được đường (bị vây kín) thì đi thẳng.
 */
export function route(n: Nav | null, from: Vec2, to: Vec2): Vec2[] {
  if (!n) return [{ ...to }]
  const s = nearestFree(n, cellOf(n, from))
  const g = nearestFree(n, cellOf(n, to))
  if (s < 0 || g < 0) return [{ ...to }]
  if (s === g || clear(n, from, to)) return [{ ...to }]

  const N = n.cols * n.rows
  const cost = new Float32Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const gi = g % n.cols, gj = Math.floor(g / n.cols)
  const h = (k: number) => {
    const dx = Math.abs((k % n.cols) - gi), dz = Math.abs(Math.floor(k / n.cols) - gj)
    return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz)
  }
  const open = new Heap()
  cost[s] = 0
  open.push(s, h(s))
  let found = false
  while (open.size) {
    const k = open.pop()
    if (k === g) { found = true; break }
    const i = k % n.cols, j = Math.floor(k / n.cols)
    for (const [di, dj, w] of DIRS) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= n.cols || nj >= n.rows) continue
      const nk = nj * n.cols + ni
      if (!n.free[nk]) continue
      // Đi chéo: hai ô bên cạnh cũng phải trống (không lách qua góc)
      if (di && dj && (!n.free[j * n.cols + ni] || !n.free[nj * n.cols + i])) continue
      const c = cost[k] + w
      if (c < cost[nk]) {
        cost[nk] = c
        prev[nk] = k
        open.push(nk, c + h(nk))
      }
    }
  }
  if (!found) return [{ ...to }]

  const cells: Vec2[] = []
  for (let k = g; k !== s && k >= 0; k = prev[k]) cells.unshift(centerOf(n, k))
  cells.push({ ...to })
  // Nắn thẳng: từ mỗi điểm, nhảy tới điểm xa nhất còn nhìn thấy
  const out: Vec2[] = []
  let at = from
  let i = 0
  while (i < cells.length) {
    let far = i
    for (let k = cells.length - 1; k > i; k--) if (clear(n, at, cells[k])) { far = k; break }
    out.push(cells[far])
    at = cells[far]
    i = far + 1
  }
  return out
}
