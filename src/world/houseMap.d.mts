/** Hình chữ nhật ô: [c0, r0, c1, r1], tính cả hai đầu (ô 0,5 m, gốc ở góc tây bắc trong nhà) */
export type CellRect = [number, number, number, number]
/** Điểm theo ô (số thực): [cột, hàng] tính từ góc tây bắc trong nhà */
export type CellPt = [number, number]

/** Sàn một phòng: mẫu ô [cột, hàng, rộng?, cao?] trong Room_Builder_Floors, lặp khắp phòng; `top` = ô hàng sát tường bắc */
export interface HouseFloor { fill: [number, number] | [number, number, number, number]; top?: [number, number] | null }

/** Một món có sẵn khi mở phòng: ô tính từ góc tây bắc của khung bao phòng */
export interface HouseKit { item: string; c: number; r: number; rot?: number }

/** Loại vách trong phòng (hình LimeZu ở `walls`): thấp, cao; door = cửa trên vách */
export type PartKind = 'low' | 'tall' | 'door'
/** Một đoạn vách trong phòng: [c0, r0, c1, r1, loại] */
export type Partition = [number, number, number, number, PartKind]
/** Phòng dành cho agent rảnh: rest = phòng nghỉ, sleep = phòng ngủ (agent tạm dừng cũng về đây ngủ) */
export type RoomUse = 'rest' | 'sleep'
/** Hướng nhìn: bắc, nam, đông, tây */
export type Face = 'n' | 's' | 'e' | 'w'
/** Bàn riêng của Lead: [cột, hàng] chỗ ngồi (số thực, bước 0,5 ô) + hướng Lead nhìn (bàn nằm phía đó) */
export type LeadDesk = [number, number, Face]

export interface HouseRoom {
  id: string
  name: string
  icon: string
  /** Mở sẵn từ đầu */
  start?: boolean
  blurb: string
  /** Các khúc chữ nhật ghép thành phòng (phòng chữ L, chữ T...) */
  rects: CellRect[]
  floor: HouseFloor
  kit?: HouseKit[]
  /** Có thì agent rảnh chỉ chơi trong các phòng này (không ngồi chơi ở bàn, không ra phòng khác) */
  use?: RoomUse
}

export interface HouseFile {
  /** Số ô trong nhà: ngang × dọc */
  size: [number, number]
  /** Giá mở phòng theo thứ tự mở (phòng thứ nhất, thứ hai...) */
  prices: number[]
  /** Kiểu tường, ô trong Room_Builder_Walls (mỗi viên cao 2 ô): north = tường bắc [cột, hàng, 1 hoặc 3 ô ngang];
   *  tall = tường giữa các phòng và vách cao; low = vách thấp (dải dưới viên tường) */
  walls: { north: [number, number] | [number, number, number]; tall: [number, number]; low: [number, number] }
  /** Cửa vào (2 ô trên tường nam): cột ô bên trái */
  entrance: number
  /** Cửa sổ trên tường bắc (2 ô): cột ô bên trái */
  windows: number[]
  /** Bảng ticket trên tường bắc: [cột đầu, số ô] */
  kanban: [number, number]
  /** Tâm các cụm bàn (4 bàn), lấp theo thứ tự */
  pods: CellPt[]
  /** Bàn riêng cho Lead (agent gốc, không báo cáo cho ai), theo thứ tự; Lead không có bàn riêng thì ngồi cụm bàn */
  leads?: LeadDesk[]
  /** Chỗ ứng viên đứng chờ ở sảnh */
  lobby: CellPt[]
  rooms: HouseRoom[]
  /** Cửa giữa hai phòng, nằm trên tường */
  doors: CellRect[]
  /** Vách trong phòng (đoạn sau đè đoạn trước); cửa trên vách là đoạn loại door, 2 ô */
  partitions?: Partition[]
}

export interface HouseDoor { id: string; rect: CellRect; cells: [number, number][]; vertical: boolean; rooms: [string | null, string | null] }

export const MAP_DX: number
export const MAP_DY: number
/** Mỗi ô: chỉ số phòng (≥ 0), -1 = tường, -2 = ngoài nhà */
export function houseGrid(h: HouseFile): Int16Array
/** Như houseGrid, ngoài lưới = -3 */
export function gridAt(h: HouseFile, g: Int16Array, c: number, r: number): number
/** Vách trong phòng: ô "c,r" → loại */
export function housePartitions(h: HouseFile): Map<string, PartKind>
export function houseDoors(h: HouseFile, g: Int16Array): HouseDoor[]
export const tsName: (source: string) => string
export function tilesetGids(tmj: { tilesets: { firstgid: number; source: string }[] }, nameOf: (source: string) => string): Record<string, number>
export function spawnOf(h: HouseFile): CellPt
export interface HouseLayers {
  width: number
  height: number
  Floor: number[]
  FloorDecor: number[]
  Walls: number[]
  WallDecor: number[]
  WallTop: number[]
}
export function houseLayers(h: HouseFile, gids: Record<string, number>): HouseLayers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function houseTmj(old: any, h: HouseFile): any
