import raw from '../data/house.json'
import { footprint, type Item } from '../data/catalog'
import { gridAt, houseDoors, houseGrid, housePartitions, spawnOf, type CellPt, type HouseFile, type LeadDesk } from './houseMap.mjs'

export type { CellPt, CellRect, Face, HouseDoor, HouseFile, HouseFloor, HouseKit, HouseRoom, LeadDesk, PartKind, Partition, RoomUse } from './houseMap.mjs'

/*
 * Bố cục nhà: src/data/house.json (sửa ở trang thiết kế nhà cutter.html, mục 🏠). Lưu xong server sinh lại
 * maps/office.tmj (sàn, tường bắc, viền, mốc) từ file này (src/world/houseMap.mjs).
 * File này: dữ liệu nhà của game + kiểm lỗi một bản nhà (trang thiết kế dùng trước khi lưu, server kiểm lại khi ghi).
 */

export const HOUSE = raw as unknown as HouseFile

export const ROOM_ID_RE = /^[a-z][A-Za-z0-9_]*$/

/** Cỡ nhà cho phép (ô 0,5 m) */
export const HOUSE_MIN: [number, number] = [16, 12]
export const HOUSE_MAX: [number, number] = [120, 90]

/** Một lỗi trong bản nhà: `at` = ô để trang thiết kế đánh dấu, `room` = phòng liên quan */
export interface HouseProblem { msg: string; at?: [number, number]; room?: string }

/**
 * Các ô một cụm bàn chiếm quanh tâm (ô, số thực): 2 hàng × 2 bàn 1,4 × 0,75 m, ghế hai phía.
 * Tâm (x, z) → ô [c0, r0, c1, r1].
 */
export const podCells = ([x, z]: CellPt): [number, number, number, number] => [Math.floor(x - 2.8), Math.floor(z - 2.9), Math.ceil(x + 2.8) - 1, Math.ceil(z + 2.9) - 1]

/** Hướng nhìn → bước (ô) */
export const FACE_DIR = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] } as const
export const FACES = ['s', 'w', 'n', 'e'] as const

/**
 * Bàn riêng của Lead (ô, số thực): bàn 1,4 × 0,75 m nằm trước chỗ ngồi theo hướng nhìn, ghế quanh chỗ ngồi
 * (như deskCells của game, tính theo ô 0,5 m). Trả khung bàn (để vẽ) và các ô bàn + ghế chiếm.
 */
export function leadDesk([x, z, face]: LeadDesk) {
  const [fx, fz] = FACE_DIR[face] ?? FACE_DIR.s
  const cx = x + fx * 1.66, cz = z + fz * 1.66
  const [w, d] = fx ? [1.5, 2.8] : [2.8, 1.5]
  const minX = Math.min(cx - w / 2, x - 0.5), maxX = Math.max(cx + w / 2, x + 0.5)
  const minZ = Math.min(cz - d / 2, z - 0.5), maxZ = Math.max(cz + d / 2, z + 0.5)
  const cells: [number, number][] = []
  for (let r = Math.floor(minZ + 0.04); r <= Math.floor(maxZ - 0.04); r++) for (let c = Math.floor(minX + 0.04); c <= Math.floor(maxX - 0.04); c++) cells.push([c, r])
  return { top: { x: cx - w / 2, z: cz - d / 2, w, d }, cells }
}

/** Ô một món có sẵn chiếm trong phòng (khung bao phòng bắt đầu ở c0, r0); đồ treo tường: các cột trên tường bắc */
export function kitCells(i: Item, c0: number, r0: number, k: { c: number; r: number; rot?: number }): [number, number][] {
  const c = c0 + k.c, r = r0 + k.r
  if (i.mount === 'wall') return Array.from({ length: i.w }, (_, j) => [c + j, r0] as [number, number])
  const { w, d } = footprint(i, k.rot ?? 0)
  const out: [number, number][] = []
  for (let dr = 0; dr < d; dr++) for (let dc = 0; dc < w; dc++) out.push([c + dc, r + dr])
  return out
}

/** Khung bao các khúc của phòng */
export const roomBounds = (rects: [number, number, number, number][]) => ({
  c0: Math.min(...rects.map((r) => r[0])), r0: Math.min(...rects.map((r) => r[1])),
  c1: Math.max(...rects.map((r) => r[2])), r1: Math.max(...rects.map((r) => r[3])),
})

/** Mọi lỗi của một bản nhà (rỗng = lưu được). `items`: các món đồ, để kiểm đồ có sẵn trong phòng */
export function houseProblems(h: HouseFile, items: Map<string, Item>): HouseProblem[] {
  const out: HouseProblem[] = []
  const bad = (msg: string, at?: [number, number], room?: string) => void out.push({ msg, at, room })
  const [W, H] = h.size
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < HOUSE_MIN[0] || H < HOUSE_MIN[1] || W > HOUSE_MAX[0] || H > HOUSE_MAX[1]) {
    bad(`Cỡ nhà phải từ ${HOUSE_MIN[0]}×${HOUSE_MIN[1]} tới ${HOUSE_MAX[0]}×${HOUSE_MAX[1]} ô`)
    return out
  }
  if (!h.prices.length || h.prices.some((p) => !Number.isInteger(p) || p < 0)) bad('Giá mở phòng phải là các số nguyên ≥ 0')
  if (!h.rooms.length) {
    bad('Chưa có phòng nào')
    return out
  }
  const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H

  // Phòng: mã, tên, các khúc nằm trong nhà, không đè phòng khác, liền một khối, không sát phòng khác (phải có tường)
  const ids = new Set<string>()
  const owner = new Int16Array(W * H).fill(-1)
  h.rooms.forEach((rm, k) => {
    const name = rm.name.trim() || rm.id
    if (!ROOM_ID_RE.test(rm.id)) bad(`Mã phòng "${rm.id}" chỉ gồm chữ không dấu, số, gạch dưới, bắt đầu bằng chữ thường`, undefined, rm.id)
    if (ids.has(rm.id)) bad(`Hai phòng trùng mã "${rm.id}"`, undefined, rm.id)
    ids.add(rm.id)
    if (!rm.name.trim()) bad(`Phòng "${rm.id}" chưa có tên`, undefined, rm.id)
    if (!rm.rects.length) bad(`${name}: chưa có khúc nào`, undefined, rm.id)
    for (const [c0, r0, c1, r1] of rm.rects) {
      if (c1 < c0 || r1 < r0 || !inGrid(c0, r0) || !inGrid(c1, r1)) {
        bad(`${name}: có khúc nằm ngoài nhà`, [Math.max(0, Math.min(W - 1, c0)), Math.max(0, Math.min(H - 1, r0))], rm.id)
        continue
      }
      if (c1 - c0 < 3 || r1 - r0 < 3) bad(`${name}: khúc ${c1 - c0 + 1}×${r1 - r0 + 1} ô hẹp quá (ít nhất 4×4)`, [c0, r0], rm.id)
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const o = owner[r * W + c]
          if (o >= 0 && o !== k) bad(`${name} đè lên ${h.rooms[o].name}`, [c, r], rm.id)
          else owner[r * W + c] = k
        }
    }
  })
  if (out.length) return dedupe(out)

  const g = houseGrid(h)
  const at = (c: number, r: number) => gridAt(h, g, c, r)
  h.rooms.forEach((rm, k) => {
    // Liền một khối (4 hướng)
    const cells: number[] = []
    for (let i = 0; i < W * H; i++) if (g[i] === k) cells.push(i)
    const seen = new Set([cells[0]])
    const q = [cells[0]]
    for (let n = 0; n < q.length; n++) {
      const c = q[n] % W, r = (q[n] - c) / W
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = (r + dr) * W + c + dc
        if (at(c + dc, r + dr) === k && !seen.has(i)) { seen.add(i); q.push(i) }
      }
    }
    if (seen.size < cells.length) {
      const i = cells.find((x) => !seen.has(x))!
      bad(`${rm.name}: các khúc phải liền nhau thành một phòng`, [i % W, Math.floor(i / W)], rm.id)
    }
    // Sát phòng khác không có tường ở giữa
    for (const i of cells) {
      const c = i % W, r = (i - c) / W
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        const o = at(c + dc, r + dr)
        if (o >= 0 && o !== k) {
          bad(`${rm.name} sát ${h.rooms[o].name}: chừa 1 ô tường ở giữa`, [c, r], rm.id)
          return
        }
      }
    }
  })
  const starts = h.rooms.filter((r) => r.start)
  if (!starts.length) bad('Cần ít nhất một phòng mở sẵn từ đầu')
  const isStart = (c: number, r: number) => {
    const k = at(c, r)
    return k >= 0 && !!h.rooms[k].start
  }

  // Cửa giữa hai phòng: nằm trọn trên tường, nối đúng hai phòng khác nhau, không chồng cửa khác
  const doors = houseDoors(h, g)
  const doorCell = new Set<string>()
  for (const d of doors) {
    const [c0, r0, c1, r1] = d.rect
    if (c1 < c0 || r1 < r0 || (c1 > c0 && r1 > r0)) { bad('Cửa phải là một dải ô thẳng', [c0, r0]); continue }
    if (d.cells.some(([c, r]) => at(c, r) !== -1)) { bad('Cửa phải nằm trên tường giữa hai phòng', [c0, r0]); continue }
    const [a, b] = d.rooms
    if (!a || !b || a === b) bad('Cửa phải nối hai phòng khác nhau', [c0, r0])
    for (const [c, r] of d.cells) {
      if (doorCell.has(`${c},${r}`)) bad('Hai cửa chồng lên nhau', [c, r])
      doorCell.add(`${c},${r}`)
    }
  }
  // Phòng nào cũng phải tới được từ phòng mở sẵn (qua cửa), không thì không bao giờ mở được
  const reach = new Set(starts.map((r) => r.id))
  for (let grew = true; grew; ) {
    grew = false
    for (const d of doors) {
      const [a, b] = d.rooms
      if (!a || !b) continue
      if (reach.has(a) !== reach.has(b)) { reach.add(a); reach.add(b); grew = true }
    }
  }
  for (const rm of h.rooms) if (!reach.has(rm.id)) bad(`${rm.name}: chưa có cửa thông tới phòng mở sẵn`, [rm.rects[0][0], rm.rects[0][1]], rm.id)

  // Cửa vào: 2 ô ở hàng cuối, trong phòng mở sẵn
  const e = h.entrance
  if (!Number.isInteger(e) || !isStart(e, H - 1) || !isStart(e + 1, H - 1)) bad('Cửa vào phải nằm ở tường nam của một phòng mở sẵn', [Math.max(0, Math.min(W - 1, e)), H - 1])
  const [sx, sz] = spawnOf(h)
  if (!isStart(Math.floor(sx), Math.floor(sz))) bad('Ngay trong cửa vào phải là sàn phòng mở sẵn', [Math.floor(sx), Math.floor(sz)])

  // Tường bắc: cửa sổ, bảng ticket nằm trên tường bắc của phòng (bảng: phòng mở sẵn), không chồng nhau
  const wallCols = new Map<number, string>()
  const onNorth = (c: number) => at(c, 0) >= 0
  for (const c of h.windows) {
    if (!onNorth(c) || !onNorth(c + 1)) bad('Cửa sổ phải nằm trên tường bắc của một phòng', [Math.max(0, Math.min(W - 1, c)), 0])
    for (const x of [c, c + 1]) {
      if (wallCols.has(x)) bad('Hai cửa sổ chồng nhau', [x, 0])
      wallCols.set(x, 'window')
    }
  }
  const [k0, kw] = h.kanban
  if (!Number.isInteger(kw) || kw < 4 || kw > 12) bad('Bảng ticket rộng từ 4 tới 12 ô')
  for (let c = k0; c < k0 + kw; c++) {
    if (!isStart(c, 0)) { bad('Bảng ticket phải nằm trên tường bắc của phòng mở sẵn', [Math.max(0, Math.min(W - 1, c)), 0]); break }
    if (wallCols.has(c)) { bad('Bảng ticket đè lên cửa sổ', [c, 0]); break }
    wallCols.set(c, 'kanban')
  }

  // Cụm bàn, chỗ chờ: trong phòng mở sẵn
  if (!h.pods.length) bad('Cần ít nhất một cụm bàn cho agent')
  const podTaken = new Set<string>()
  h.pods.forEach((p, i) => {
    const [c0, r0, c1, r1] = podCells(p)
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (!isStart(c, r)) return bad(`Cụm bàn ${i + 1} phải nằm trọn trong phòng mở sẵn`, [Math.floor(p[0]), Math.floor(p[1])])
        if (podTaken.has(`${c},${r}`)) return bad(`Cụm bàn ${i + 1} đè lên cụm bàn khác`, [Math.floor(p[0]), Math.floor(p[1])])
      }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) podTaken.add(`${c},${r}`)
  })
  if (!h.lobby.length) bad('Cần ít nhất một chỗ chờ cho ứng viên')
  h.lobby.forEach((p, i) => {
    if (!isStart(Math.floor(p[0]), Math.floor(p[1]))) bad(`Chỗ chờ ${i + 1} phải nằm trong phòng mở sẵn`, [Math.floor(p[0]), Math.floor(p[1])])
  })

  // Đồ có sẵn: món có thật, nằm trong phòng, không đè nhau / cửa / cửa sổ
  const kitFloor = new Set<string>()
  for (const rm of h.rooms) {
    const k = h.rooms.indexOf(rm)
    const { c0, r0 } = roomBounds(rm.rects)
    const floor = new Set<string>(), rug = new Set<string>()
    for (const kit of rm.kit ?? []) {
      const i = items.get(kit.item)
      if (!i) { bad(`${rm.name}: không có món "${kit.item}"`, undefined, rm.id); continue }
      const cells = kitCells(i, c0, r0, kit)
      if (i.mount === 'wall') {
        if (r0 !== 0 || cells.some(([c]) => at(c, 0) !== k)) bad(`${rm.name}: ${i.name} treo trên tường bắc của phòng (phòng phải chạm tường bắc nhà)`, cells[0], rm.id)
        else if (cells.some(([c]) => wallCols.has(c))) bad(`${rm.name}: ${i.name} đè lên cửa sổ / bảng ticket`, cells[0], rm.id)
        continue
      }
      if (cells.some(([c, r]) => at(c, r) !== k)) { bad(`${rm.name}: ${i.name} ra ngoài phòng`, cells[0], rm.id); continue }
      const mine = i.mount === 'rug' ? rug : floor
      if (cells.some(([c, r]) => mine.has(`${c},${r}`))) bad(`${rm.name}: ${i.name} đè lên món khác`, cells[0], rm.id)
      if (i.mount !== 'rug' && cells.some(([c, r]) => podTaken.has(`${c},${r}`))) bad(`${rm.name}: ${i.name} đè lên cụm bàn`, cells[0], rm.id)
      cells.forEach(([c, r]) => mine.add(`${c},${r}`))
      if (i.mount !== 'rug') cells.forEach(([c, r]) => kitFloor.add(`${c},${r}`))
    }
  }

  // Vách trong phòng: đúng dạng, nằm trong phòng, không chắn lối vào / sảnh chờ / cụm bàn / đồ có sẵn
  const PART_KINDS = ['low', 'tall', 'door']
  for (const p of h.partitions ?? []) {
    const [c0, r0, c1, r1, kind] = p
    if (p.length !== 5 || ![c0, r0, c1, r1].every(Number.isInteger) || c1 < c0 || r1 < r0 || !PART_KINDS.includes(kind)) { bad('Có đoạn vách sai dạng'); continue }
    if (kind === 'door' && (c1 > c0 && r1 > r0 || c1 - c0 > 1 || r1 - r0 > 1)) bad('Cửa trên vách rộng 1–2 ô, nằm thẳng theo vách', [c0, r0])
  }
  const parts = housePartitions(h)
  const wallAt = (c: number, r: number) => { const k = parts.get(`${c},${r}`); return !!k && k !== 'door' }
  const zones: { msg: string; c0: number; r0: number; c1: number; r1: number }[] = [
    { msg: 'Vách chắn lối cửa vào', c0: e - 2, r0: Math.floor(sz - 1.4), c1: e + 3, r1: H - 1 },
  ]
  if (h.lobby.length) {
    const xs = h.lobby.map((p) => p[0]), zs = h.lobby.map((p) => p[1])
    zones.push({ msg: 'Vách chắn chỗ chờ của ứng viên', c0: Math.floor(Math.min(...xs) - 1), r0: Math.floor(Math.min(...zs) - 1), c1: Math.ceil(Math.max(...xs) + 1) - 1, r1: H - 1 })
  }
  h.pods.forEach((p, i) => {
    const [c0, r0, c1, r1] = podCells(p)
    zones.push({ msg: `Vách đè lên cụm bàn ${i + 1}`, c0, r0, c1, r1 })
  })
  // Bàn riêng của Lead: đúng dạng, trong phòng mở sẵn, không đè cụm bàn / bàn Lead khác / đồ có sẵn, không chắn lối vào / chỗ chờ
  const leadTaken = new Set<string>()
  const doorZones = zones.filter((z) => !z.msg.includes('cụm bàn'))
  ;(h.leads ?? []).forEach((p, i) => {
    const name = `Bàn Lead ${i + 1}`
    if (p.length !== 3 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !(p[2] in FACE_DIR)) return bad(`${name} sai dạng`)
    const { cells } = leadDesk(p)
    const pin: [number, number] = [Math.floor(p[0]), Math.floor(p[1])]
    const hit = (f: (c: number, r: number) => boolean) => cells.some(([c, r]) => f(c, r))
    if (hit((c, r) => !isStart(c, r))) return bad(`${name} phải nằm trọn trong phòng mở sẵn`, pin)
    if (hit((c, r) => podTaken.has(`${c},${r}`))) bad(`${name} đè lên cụm bàn`, pin)
    if (hit((c, r) => leadTaken.has(`${c},${r}`))) bad(`${name} đè lên bàn Lead khác`, pin)
    if (hit((c, r) => kitFloor.has(`${c},${r}`))) bad(`${name} đè lên đồ có sẵn`, pin)
    const z = doorZones.find((z) => hit((c, r) => c >= z.c0 && c <= z.c1 && r >= z.r0 && r <= z.r1))
    if (z) bad(z.msg.replace('Vách', name), pin)
    cells.forEach(([c, r]) => leadTaken.add(`${c},${r}`))
    for (const [c, r] of cells) zones.push({ msg: `Vách đè lên ${name.replace('Bàn', 'bàn')}`, c0: c, r0: r, c1: c, r1: r })
  })
  for (const rm of h.rooms) {
    const { c0, r0 } = roomBounds(rm.rects)
    for (const kit of rm.kit ?? []) {
      const i = items.get(kit.item)
      if (!i || i.mount === 'wall') continue
      const cells = kitCells(i, c0, r0, kit)
      if (cells.some(([c, r]) => parts.has(`${c},${r}`))) bad(`${rm.name}: ${i.name} đè lên vách`, cells[0], rm.id)
    }
  }
  for (const [key] of parts) {
    const [c, r] = key.split(',').map(Number)
    if (at(c, r) < 0) { bad('Vách phải nằm trong phòng (không lên tường, ngoài nhà)', [c, r]); continue }
    const z = zones.find((z) => c >= z.c0 && c <= z.c1 && r >= z.r0 && r <= z.r1)
    if (z) bad(z.msg, [c, r])
  }
  // Agent tới được mọi chỗ sàn: người rộng ~0,6 m nên lối đi (cửa, khe giữa vách) phải rộng ít nhất 2 ô.
  // Loang theo khung 2×2 ô đi được, bắt đầu từ chỗ xuất hiện; ô sàn không nằm trong khung nào tới được là bị chặn.
  if (!out.length) {
    const walk = (c: number, r: number) => (at(c, r) >= 0 && !wallAt(c, r)) || doorCell.has(`${c},${r}`)
    const free = (c: number, r: number) => walk(c, r) && walk(c + 1, r) && walk(c, r + 1) && walk(c + 1, r + 1)
    const seen = new Uint8Array(W * H)
    const q: number[] = []
    const fx = Math.floor(sx), fz = Math.floor(sz)
    for (const [c, r] of [[fx, fz], [fx - 1, fz], [fx, fz - 1], [fx - 1, fz - 1]])
      if (c >= 0 && r >= 0 && free(c, r) && !seen[r * W + c]) { seen[r * W + c] = 1; q.push(r * W + c) }
    for (let n = 0; n < q.length; n++) {
      const c = q[n] % W, r = (q[n] - c) / W
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr
        if (cc < 0 || rr < 0 || cc >= W - 1 || rr >= H - 1 || seen[rr * W + cc] || !free(cc, rr)) continue
        seen[rr * W + cc] = 1
        q.push(rr * W + cc)
      }
    }
    const covered = (c: number, r: number) => [[c, r], [c - 1, r], [c, r - 1], [c - 1, r - 1]].some(([a, b]) => a >= 0 && b >= 0 && seen[b * W + a] === 1)
    // Ô sàn chưa tới được, gom theo vùng liền nhau: vùng đủ chỗ đứng (có khung 2×2) mới báo; khe hẹp 1 ô sát vách thì thôi
    const done = new Uint8Array(W * H)
    const told = new Set<number>()
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        const k = at(c, r)
        if (k < 0 || wallAt(c, r) || done[r * W + c] || covered(c, r)) continue
        const zone = [r * W + c]
        done[r * W + c] = 1
        let roomy = false
        for (let n = 0; n < zone.length; n++) {
          const zc = zone[n] % W, zr = (zone[n] - zc) / W
          if (free(zc, zr)) roomy = true
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const cc = zc + dc, rr = zr + dr
            if (cc < 0 || rr < 0 || cc >= W || rr >= H || done[rr * W + cc] || at(cc, rr) < 0 || wallAt(cc, rr) || covered(cc, rr)) continue
            done[rr * W + cc] = 1
            zone.push(rr * W + cc)
          }
        }
        if (!roomy || told.has(k)) continue
        told.add(k)
        bad(`${h.rooms[k].name}: có chỗ sàn agent không tới được (vách quây kín, hoặc lối đi / cửa hẹp dưới 2 ô)`, [c, r], h.rooms[k].id)
      }
  }
  return dedupe(out)
}

const dedupe = (ps: HouseProblem[]) => {
  const seen = new Set<string>()
  return ps.filter((p) => !seen.has(p.msg) && !!seen.add(p.msg))
}
