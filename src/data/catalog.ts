/**
 * Cửa hàng đồ trang trí: mọi món bán được, giá, chỗ chiếm trên lưới, công dụng, hình (vùng cắt từ ảnh LimeZu).
 * Dữ liệu ở items.json; không phụ thuộc React hay PixiJS: server dùng chung để kiểm giá. Vẽ hình: src/pixel/catalogArt.ts.
 *
 * Lưới đặt đồ: ô 0,5 m (= một ô 16 px của LimeZu). Đồ treo tường chỉ treo trên tường bắc, theo cột ô.
 *
 * Giá theo tốc độ kiếm Xu thật: một công ty bình thường được khoảng 150 Xu mỗi ngày có việc.
 * Đồ nhỏ mua được ngay ngày đầu; món đắt nhất (mèo văn phòng) cần dành dụm khoảng một tuần.
 */

import data from './items.json'
import type { Activity } from '../world/room'

export type Group = 'plant' | 'wall' | 'lounge' | 'fun' | 'bed'

/** floor: đứng trên sàn, chặn đường · rug: trải sàn, đi qua được, đồ khác đặt lên được · wall: treo tường bắc */
export type Mount = 'floor' | 'rug' | 'wall'

/**
 * Xoay: four = 4 hướng (LimeZu có đủ hình) · two = quay mặt / quay lưng · flip = lật gương trái/phải · none = không xoay.
 * Hướng (rot): 0 nhìn xuống (về camera), 1 nhìn trái, 2 nhìn lên, 3 nhìn phải. Món `flip`: 0 thường, 1 lật.
 */
export type Turn = 'four' | 'two' | 'flip' | 'none'

export interface Item {
  id: string
  name: string
  group: Group
  price: number
  /** Số ô chiếm ở hướng 0: ngang (w) × dọc (d). Đồ treo tường: chỉ w (số cột trên tường) */
  w: number
  d: number
  mount: Mount
  turn: Turn
  /** Chiều cao (m), để biết món chặn đường; 0 = đi qua được */
  h: number
  /** Toả sáng ban đêm */
  light?: 'lamp' | 'screen'
  /** Agent và bạn dùng món này thế nào (không có = chỉ để trang trí) */
  use?: Use
  art: Art
}

/**
 * Công dụng của món:
 * - seat: ngồi được, `n` chỗ cách nhau `gap` mét ở hàng ghế phía trước; `back` = bước vào từ phía sau (ghế kê sát bàn),
 *   `sink` = lùi chỗ ngồi về phía lưng ghế bao nhiêu mét
 * - stand: đứng trước mặt món dùng, `n` chỗ cạnh nhau, cách mép trước `dist` mét (mặc định 0,4)
 * - pair: hai người hai đầu món (bóng bàn, bi-a) · pet: ngồi vuốt ve (mèo) · watch: đứng xem từ xa (TV treo tường)
 * - bed: giường một người (đầu giường phía bắc): agent nằm ngủ, đầu trên gối, chăn (`front` của hình) đắp đè lên
 */
export type Use =
  | { kind: 'seat'; act: Activity; n: number; gap: number; back?: boolean; sink?: number }
  | { kind: 'stand'; act: Activity; n?: number; dist?: number }
  | { kind: 'pair' | 'pet' | 'watch' | 'bed'; act: Activity }

/** Một vùng cắt từ ảnh LimeZu: [đường dẫn trong gói hình, x, y, rộng, cao] (pixel) */
export type Src = [string, number, number, number, number]

/**
 * Một mảnh hình của món. (x, y): góc trên trái so với điểm neo, pixel. Điểm neo: giữa mép dưới khung chân món
 * (đồ treo tường: giữa mép trên mặt tường; ghế làm việc: chỗ ngồi; đồ trên bàn làm việc: chỗ đặt món).
 * Hình động: `frames` khung xếp ngang liền nhau trong ảnh, khung đầu là `src`; `speed` khung mỗi nhịp (0,05–0,1).
 * Không có `src` thì là khối màu `box` = [rộng, cao, màu "#rrggbb"] (bàn phím, màn hình nhìn ngang).
 */
export interface Part { src?: Src; box?: [number, number, string]; x: number; y: number; frames?: number; speed?: number }

/** Cỡ một mảnh (khung đầu nếu là hình động) */
export const partWH = (p: Part): [number, number] => (p.src ? [p.src[3], p.src[4]] : p.box ? [p.box[0], p.box[1]] : [0, 0])

/**
 * Hình một hướng: các mảnh vẽ theo thứ tự (mảnh sau đè mảnh trước).
 * - flip: lật gương quanh điểm neo
 * - fit: kéo mảnh đầu tiên cho vừa khung chân (rộng + dw, cao + dh pixel), giữ nguyên 4 mép l/r/t/b;
 *   `repeat` lặp lại phần giữa (bàn họp), `stretch` giãn phần giữa (thảm). (x, y) của mảnh là độ lệch thêm.
 * - front: số hàng pixel dưới cùng vẽ đè lên người đang ngồi (tay ghế phía camera)
 */
export interface View {
  parts: Part[]
  flip?: boolean
  fit?: { mode: 'repeat' | 'stretch'; l: number; r: number; t: number; b: number; dw?: number; dh?: number }
  front?: number
}

/**
 * Hình của món. `views[rot]` theo hướng (0 xuống, 1 trái, 2 lên, 3 phải); hướng thiếu dùng `views[0]`
 * (món lật: hướng 1 tự lật gương `views[0]`). `shadow`: bóng đổ dưới chân (mặc định: món cao từ 0,5 m; đồ treo tường có).
 * `code`: hình vẽ bằng code, không sửa ở trang cắt hình (bảng vinh danh).
 */
export interface Art { views?: (View | null)[]; shadow?: boolean; code?: 'fame' }

/** Bàn làm việc: mặt bàn kéo cho vừa cỡ bàn (giữ 4 mép, lặp phần giữa); `side` = hình riêng khi bàn quay ngang */
export interface DeskTop { src: Src; l: number; r: number; t: number; b: number }
/**
 * Ghế làm việc, điểm neo ở chỗ ngồi: front = ghế sau lưng người ngồi nhìn về camera, back = ghế nhìn từ sau
 * (lưng ghế che hông người ngồi), side = ghế bàn quay ngang (vẽ cho người nhìn sang phải, tự lật khi nhìn sang trái).
 * Bản "Leather" dùng khi agent đã mua ghế da; thiếu thì nhuộm nâu bản thường.
 */
export interface DeskArt {
  top: DeskTop
  side?: DeskTop
  chair: { front: View; back: View; side: View; frontLeather?: View; backLeather?: View; sideLeather?: View }
  things: DeskThing[]
}

/** Kiểu bàn: front = agent ngồi phía bắc nhìn về camera, back = agent quay lưng về camera, side = bàn quay ngang */
export type DeskKind = 'front' | 'back' | 'side'
export const DESK_KINDS: DeskKind[] = ['front', 'back', 'side']

/**
 * Chỗ đặt một món trên bàn: điểm neo của món, pixel so với góc trên trái hình mặt bàn.
 * `if`: chỉ dùng khi agent có đủ các đồ để bàn này (chỗ dùng được mà nhiều `if` nhất thắng, bằng nhau thì chỗ ghi trước);
 * `hide`: không vẽ món (bàn chật).
 */
export interface DeskAt { x: number; y: number; if?: string[]; hide?: boolean }

/** Hình một món ở một kiểu bàn + chỗ đặt; `screen` = mặt màn hình sáng [x, y, rộng, cao] so với điểm neo */
export interface DeskThingView extends View { at: DeskAt[]; screen?: [number, number, number, number] }

/**
 * Một món trên bàn làm việc. Có `price` = đồ để bàn agent mua (mở khoá ở cấp `level`), không có = luôn có trên bàn
 * (máy tính, bàn phím, cốc). Kiểu bàn thiếu hình thì không vẽ món ở kiểu đó. `light`: đèn bàn, quầng sáng ấm
 * ban đêm tại [x, y] so với điểm neo. Ghế da (`chair`) không vẽ trên bàn: hình ở `chair.*Leather`.
 */
export interface DeskThing {
  id: string
  name: string
  icon?: string
  price?: number
  level?: number
  light?: [number, number]
  views: Partial<Record<DeskKind, DeskThingView>>
}

/** Món này ở kiểu bàn `kind` của một agent có các đồ `has`: hình + chỗ đặt, hoặc null (không vẽ) */
export function deskPlace(t: DeskThing, kind: DeskKind, has: (id: string) => boolean): { view: DeskThingView; at: DeskAt } | null {
  if (t.price !== undefined && !has(t.id)) return null
  const view = t.views[kind]
  if (!view?.parts.length) return null
  let best: DeskAt | null = null
  for (const a of view.at) if ((a.if ?? []).every(has) && (!best || (a.if?.length ?? 0) > (best.if?.length ?? 0))) best = a
  return best && !best.hide ? { view, at: best } : null
}

export interface ItemsFile { desk: DeskArt; items: Item[] }

export const GROUPS: { id: Group; name: string; icon: string }[] = [
  { id: 'plant', name: 'Cây & đồ nhỏ', icon: '🪴' },
  { id: 'wall', name: 'Treo tường', icon: '🖼️' },
  { id: 'lounge', name: 'Nghỉ ngơi & bếp', icon: '🛋️' },
  { id: 'fun', name: 'Giải trí', icon: '🎮' },
  { id: 'bed', name: 'Phòng ngủ', icon: '🛏️' },
]

/** Mọi món và hình bàn ghế làm việc nằm trong items.json (sửa bằng trang cắt hình cutter.html khi chạy dev) */
const FILE = data as unknown as ItemsFile

/** Danh sách món theo thứ tự hiện trong cửa hàng */
export const ITEMS: Item[] = FILE.items
/** Hình bàn + ghế làm việc của agent */
export const DESK_ART: DeskArt = FILE.desk

export const itemById = new Map(ITEMS.map((i) => [i.id, i]))

/** Vách (tường giữa các phòng, vách trong phòng vẽ ở trang thiết kế nhà): thấp ngang hông, hoặc cao đầy đủ (che người phía sau, tự mờ đi) */
export type WallKind = 'low' | 'tall'

/**
 * Đồ để bàn: của riêng từng agent (đi theo agent khi đổi chỗ), mở khoá khi agent đạt cấp `level`, rồi mới mua bằng Xu.
 * Là các món có giá trong `desk.things` của items.json (hình, chỗ đặt trên bàn ở đó). Thứ tự = thứ tự hiện trong bảng chọn.
 */
export interface DeskItem { id: string; name: string; icon: string; price: number; level: number }
export const DESK_ITEMS: DeskItem[] = DESK_ART.things.flatMap((t) =>
  t.price === undefined ? [] : [{ id: t.id, name: t.name, icon: t.icon ?? '🎁', price: t.price, level: t.level ?? 1 }])
export const deskItemById = new Map(DESK_ITEMS.map((d) => [d.id, d]))

/** Tên món giữa câu ("Đã mua sofa xám"), giữ nguyên chữ viết tắt ("TV treo tường") */
export const lowerName = (name: string) => (name.length > 1 && name[1] === name[1].toUpperCase() && /\p{L}/u.test(name[1]) ? name : name[0].toLowerCase() + name.slice(1))

/** Bán lại được nửa giá */
export const resale = (price: number) => Math.floor(price / 2)

/** Các hướng xoay của một món, theo thứ tự bấm R */
export function rotations(i: Item): number[] {
  if (i.turn === 'four') return [0, 1, 2, 3]
  if (i.turn === 'two') return [0, 2]
  if (i.turn === 'flip') return [0, 1]
  return [0]
}

export const nextRot = (i: Item, rot: number) => {
  const r = rotations(i)
  return r[(r.indexOf(rot) + 1) % r.length] ?? 0
}

/** Chỗ chiếm trên lưới ở hướng `rot` (món 4 hướng quay ngang thì đổi rộng / dọc) */
export function footprint(i: Item, rot: number): { w: number; d: number } {
  return i.turn === 'four' && rot % 2 === 1 ? { w: i.d, d: i.w } : { w: i.w, d: i.d }
}
