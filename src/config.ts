/**
 * Cấu hình dùng chung cho app và vite.config (proxy).
 *
 * Pixel Company không gắn cứng công ty nào: nó đọc danh sách công ty từ Paperclip của máy đang chạy
 * (xem src/data/sync.ts). Địa chỉ Paperclip mặc định là 127.0.0.1:3100; máy nào khác thì đặt
 * `VITE_PAPERCLIP_URL` trong file `.env` (xem `.env.example`).
 */
export const DEFAULT_PAPERCLIP_URL = 'http://127.0.0.1:3100'

/** Bỏ dấu / ở cuối để ghép đường dẫn cho gọn. */
export const paperclipUrl = (v: string | undefined) => (v?.trim() || DEFAULT_PAPERCLIP_URL).replace(/\/+$/, '')
