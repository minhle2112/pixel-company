/** Trạng thái camera bản pixel (đổi mỗi khung hình, để ngoài React) */
export const view = {
  /** Cộng thêm vào mức phóng to tự động, theo Cài đặt: -1 (gần) hoặc -2 (xa nhất) */
  zoomBias: -1,
  /** Mức phóng to hiện tại (pixel màn hình thật mỗi pixel gốc) */
  zoom: 3,
  /** Tâm camera (pixel gốc) */
  x: 0,
  y: 0,
}
