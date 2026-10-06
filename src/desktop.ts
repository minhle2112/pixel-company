/**
 * Khi chạy trong app desktop (Electron), preload gắn `window.coopDesktop` (desktop/preload.ts).
 * Chạy bằng trình duyệt (npm run dev) thì không có, mọi chỗ dùng phải kiểm `desktop` trước.
 */
export interface CoopDesktop {
  version: string
  /** Địa chỉ Paperclip app đang dùng (đặt trong màn hình kết nối, thay cho VITE_PAPERCLIP_URL) */
  paperclipUrl: string
  /** Mở màn hình kết nối Paperclip */
  openSetup: () => Promise<void>
  pickAssets: () => Promise<{ ok: boolean; dir?: string; picked?: string; canceled?: boolean }>
  importExp: () => Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }>
  checkUpdate: () => Promise<{ status: 'new' | 'latest' | 'none' | 'error'; current: string; latest?: string; url?: string }>
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window { coopDesktop?: CoopDesktop }
}

export const desktop: CoopDesktop | undefined = typeof window === 'undefined' ? undefined : window.coopDesktop
