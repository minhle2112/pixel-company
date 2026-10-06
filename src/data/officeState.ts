import { OFFICE } from '../world/room'

/**
 * Trạng thái văn phòng của một công ty (riêng của Pixel Company, không phải của Paperclip): phòng nào đã mở,
 * đã tiêu bao nhiêu Xu vào việc gì. Lưu thành file cạnh sổ EXP (server/coopData.ts); bản demo lưu trong trình duyệt.
 * Không phụ thuộc React: server dùng chung để kiểm giá và số dư.
 *
 * Văn phòng lúc đầu: văn phòng chung (bàn agent, bảng ticket) và sảnh, sạch sẵn. Các phòng khác khoá,
 * trả Xu để mở (src/world/rooms.ts). Rồi mua đồ (src/data/catalog.ts), dời bàn (luật ở src/data/decor.ts).
 * Tường, vách, cửa là của toà nhà (src/data/house.json, trang thiết kế nhà), người chơi không xây.
 */

export interface Spend {
  id: string
  at: number
  /**
   * room: mở phòng · buy: mua đồ · sell: bán lại (xu âm)
   * · wall / unwall: xây / dỡ vách (xu âm), chỉ còn trong sổ cũ: nay vách vẽ ở trang thiết kế nhà
   * · deskBuy / deskSell: đồ để bàn của một agent (ref = "agentId:món")
   * · gift: Xu thêm để thử, chỉ có ở bản demo (xu âm; server không bao giờ tạo khoản này)
   */
  kind: 'room' | 'buy' | 'sell' | 'wall' | 'unwall' | 'deskBuy' | 'deskSell' | 'gift'
  /** Phòng (id trong rooms.ts), món đồ (id trong ITEMS), hoặc "agentId:món" (đồ để bàn) */
  ref: string
  xu: number
}

/** Một món đã mua: đang đặt trong phòng, hoặc cất trong kho */
export interface Placed {
  uid: string
  item: string
  /** Ô góc trên-trái (lưới 0,5 m). Đồ treo tường: c = cột trên tường bắc, r = 0 */
  c: number
  r: number
  /** Hướng (xem Turn trong catalog.ts) */
  rot: number
  at: number
  stored?: boolean
  /** Đồ có sẵn khi mở phòng (không mua): bán không được Xu */
  kit?: boolean
}

/** Chỗ ngồi đã dời: vị trí ghế (mét) và hướng nhìn */
export interface DeskPos { x: number; z: number; yaw: number }

export interface OfficeState {
  v: 2
  /** id phòng đã mở bằng Xu → lúc mở (phòng có sẵn từ đầu không nằm ở đây) */
  rooms: Record<string, number>
  spent: Spend[]
  items: Placed[]
  /** id chỗ ngồi (DeskSlot.id) → chỗ mới */
  desks: Record<string, DeskPos>
  /** agentId → đồ để bàn đã mua (id trong DESK_ITEMS): đi theo agent khi đổi chỗ */
  deskItems: Record<string, string[]>
  /** Đồ có sẵn (kit) của phòng mở sẵn đã đặt vào rồi, khoá "phòng:món:cột:hàng": bán / cất đi thì không tự đặt lại */
  kits?: string[]
}

export const emptyOffice = (): OfficeState => ({ v: 2, rooms: {}, spent: [], items: [], desks: {}, deskItems: {} })

/** Giá vách tự xây và cửa kính lắp trên vách (đợt trước, nay đã bỏ): để trả lại Xu */
const OLD_WALL_XU: Record<string, number> = { low: 4, glass: 7, tall: 10 }
const OLD_DOOR_XU = 100

/**
 * Đọc từ file / bộ nhớ trình duyệt: thiếu trường (file của đợt trước) thì lấy mặc định.
 * File bản 1 (một phòng lớn phủ bụi, lưới ô khác hẳn): trả lại Xu đã dọn bụi và đã xây vách, đồ cất hết vào kho
 * (lấy ra đặt lại miễn phí), bàn về chỗ cũ. Đồ để bàn giữ nguyên.
 * File có vách / cửa kính người chơi tự xây (đợt trước): dỡ hết, trả lại đủ Xu đã trả.
 */
export function normOffice(raw: (Partial<Omit<OfficeState, 'v'>> & { v?: number; walls?: Record<string, string> }) | null | undefined): OfficeState {
  const o: OfficeState & { walls?: unknown; cleaned?: unknown } = { ...emptyOffice(), ...(raw ?? {}), v: 2 }
  if (raw && raw.v !== 2) {
    o.spent = (raw.spent ?? []).filter((x) => !['clean', 'wall', 'unwall'].includes(x.kind))
    o.items = (raw.items ?? []).map((p) => ({ ...p, stored: true }))
    o.desks = {}
    o.rooms = {}
  } else {
    const at = Date.now()
    const wallXu = Object.values(raw?.walls ?? {}).reduce((s, k) => s + (OLD_WALL_XU[k] ?? 0), 0)
    if (wallXu) o.spent = [...o.spent, { id: `old-walls-${at}`, at, kind: 'unwall', ref: 'wall', xu: -wallXu }]
    const doors = o.items.filter((p) => p.item === 'door')
    if (doors.length) {
      o.items = o.items.filter((p) => p.item !== 'door')
      o.spent = [...o.spent, { id: `old-doors-${at}`, at, kind: 'sell', ref: 'door', xu: -doors.length * OLD_DOOR_XU }]
    }
  }
  delete o.walls
  delete o.cleaned
  return o
}

export const spentXu = (o: OfficeState) => o.spent.reduce((s, x) => s + x.xu, 0)

// ───────────────────────── Lưới đặt đồ ─────────────────────────

/** Ô 0,5 m = một ô 16 px của LimeZu */
export const CELL = 0.5
export const COLS = Math.round((OFFICE.maxX - OFFICE.minX) / CELL)
export const ROWS = Math.round((OFFICE.maxZ - OFFICE.minZ) / CELL)
export const cellKey = (c: number, r: number) => `${c},${r}`
/** Mép trái / trên của ô (mét) */
export const cellX = (c: number) => OFFICE.minX + c * CELL
export const cellZ = (r: number) => OFFICE.minZ + r * CELL
export const colOf = (x: number) => Math.floor((x - OFFICE.minX) / CELL)
export const rowOf = (z: number) => Math.floor((z - OFFICE.minZ) / CELL)
