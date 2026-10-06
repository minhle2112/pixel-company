import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assetsOk } from '../server/limezu'

/**
 * Cấu hình của app desktop, lưu ở `%APPDATA%/Pixel Company/config.json`.
 * Pixel Company không chứa dữ liệu của Paperclip: chỉ nhớ Paperclip nằm ở đâu và bật nó bằng cách nào.
 */

/**
 * Cách bật Paperclip khi nó chưa chạy:
 * - auto:   lệnh `paperclipai` cài bằng `npm install -g`
 * - folder: một thư mục cài riêng (có `node_modules/paperclipai`), vd khi mỗi đội có một bản Paperclip
 * - wsl:    Paperclip trong WSL (Linux trên Windows)
 * - none:   không tự bật, chỉ kết nối
 */
export type Launch = 'auto' | 'folder' | 'wsl' | 'none'

export interface Bounds { x: number; y: number; width: number; height: number; max: boolean }

export interface DesktopConfig {
  paperclipUrl: string
  launch: Launch
  /** Thư mục cài Paperclip (cách `folder`) */
  paperclipDir: string
  /** Thư mục dữ liệu Paperclip (`-d`). Trống = mặc định của Paperclip (~/.paperclip) */
  dataDir: string
  wslDistro: string
  /** Thư mục gói hình LimeZu */
  assetsDir: string
  /** Bản mới người dùng bấm "Bỏ qua bản này" */
  skipVersion: string
  bounds: Bounds | null
  /** Đã qua màn hình kết nối lần đầu chưa */
  setupDone: boolean
}

const DEFAULTS: DesktopConfig = {
  paperclipUrl: 'http://127.0.0.1:3100',
  launch: 'auto',
  paperclipDir: '',
  dataDir: '',
  wslDistro: '',
  assetsDir: '',
  skipVersion: '',
  bounds: null,
  setupDone: false,
}

const file = () => path.join(app.getPath('userData'), 'config.json')

/** Thư mục dữ liệu riêng của Pixel Company (sổ EXP, nhật ký Paperclip do app bật) */
export const dataDir = () => path.join(app.getPath('userData'), 'data')
export const logDir = () => path.join(app.getPath('userData'), 'logs')

let cfg: DesktopConfig | null = null

export function config(): DesktopConfig {
  if (cfg) return cfg
  let saved: Partial<DesktopConfig> = {}
  try {
    saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<DesktopConfig>
  } catch { /* lần đầu */ }
  cfg = { ...DEFAULTS, ...saved }
  if (!cfg.assetsDir) cfg.assetsDir = findAssets()
  return cfg
}

export function saveConfig(patch: Partial<DesktopConfig>): DesktopConfig {
  cfg = { ...config(), ...patch }
  mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, file())
  return cfg
}

/** Bỏ dấu / cuối, thêm http:// nếu thiếu */
export function normUrl(v: string) {
  const s = v.trim().replace(/\/+$/, '')
  if (!s) return DEFAULTS.paperclipUrl
  return /^https?:\/\//i.test(s) ? s : `http://${s}`
}

/**
 * Tìm gói hình: chính thư mục được chọn, thư mục con `limezu`, hoặc một thư mục con bất kỳ có đủ hình.
 * Trả về '' nếu không thấy.
 */
export function resolveAssets(dir: string): string {
  if (!dir) return ''
  const tries = [dir, path.join(dir, 'limezu')]
  for (const d of tries) if (assetsOk(d)) return d
  try {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory() && assetsOk(path.join(dir, name.name))) return path.join(dir, name.name)
    }
  } catch { /* không đọc được */ }
  return ''
}

/** Lần đầu: thử vài chỗ hay để gói hình (cạnh thư mục dự án như hướng dẫn trong README) */
function findAssets(): string {
  const home = os.homedir()
  const roots = [path.parse(home).root, home, path.join(home, 'Documents'), path.join(home, 'Downloads')]
  for (const r of roots) {
    const d = path.join(r, 'coopverse-assets', 'limezu')
    if (existsSync(d) && assetsOk(d)) return d
  }
  return ''
}
