import type { Application, Container } from 'pixi.js'

/**
 * Sân khấu pixel dùng chung giữa Scene (tạo Pixi, vòng lặp khung hình) và các nhân vật (agent, ứng viên):
 * lớp xếp theo chiều sâu để thêm sprite, lớp DOM cho bảng tên, và danh sách hàm chạy mỗi khung hình.
 */
export const stage: {
  app: Application | null
  root: Container | null
  /** Lớp đồ đạc + người, xếp theo chân (zIndex = y) */
  sorted: Container | null
  /** Lớp trên cùng (mũi tên đánh dấu...) */
  top: Container | null
  /** Lớp trên cả ngày/đêm: bong bóng trạng thái, mũi tên, hiệu ứng lên cấp */
  fx: Container | null
  /** Lớp DOM phủ lên canvas, cho bảng tên / bong bóng thoại */
  overlay: HTMLDivElement | null
  /** Người đang được rê chuột lên (id agent) */
  hover: string | null
} = { app: null, root: null, sorted: null, top: null, fx: null, overlay: null, hover: null }

export type Tick = (dt: number, t: number) => void

/** Hàm chạy mỗi khung hình, sau khi camera đã cập nhật */
export const ticks = new Set<Tick>()

/** Pixel gốc của bản đồ → toạ độ CSS trên lớp phủ */
export function toScreen(x: number, y: number): { x: number; y: number } {
  const r = stage.root
  if (!r) return { x: -9999, y: -9999 }
  return { x: r.position.x + x * r.scale.x, y: r.position.y + y * r.scale.y }
}
