import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { Handler } from './guard'

/**
 * Bản pixel vẽ bằng 2 gói hình của LimeZu: "Modern Interiors" (limezu.itch.io/moderninteriors) và "Modern Office"
 * (limezu.itch.io/modernoffice, giải nén vào thư mục con `Modern_Office`). Các gói có bản quyền: được dùng trong dự án
 * nhưng KHÔNG được phát tán lại, nên hình không nằm trong repo. Mỗi máy tự mua gói, giải nén ra một thư mục, rồi đặt `COOPVERSE_ASSETS` trong `.env` trỏ tới thư mục đó (mặc định: `../coopverse-assets/limezu`,
 * tức thư mục `coopverse-assets/limezu` nằm cạnh thư mục dự án).
 *
 * Plugin này phục vụ các file hình đó ở `/limezu/...` khi chạy dev / preview, chỉ cho máy này (127.0.0.1).
 * App desktop dùng chung `limezuHandler`, với thư mục người dùng chọn trong app.
 * `GET /limezu/__status` trả `{ ok }` để trang biết đã có gói hình chưa.
 */

const ALLOWED = /\.(png|gif)$/i

export function assetDir(env: Record<string, string>) {
  const raw = env.COOPVERSE_ASSETS?.trim() || '../coopverse-assets/limezu'
  return path.resolve(process.cwd(), raw)
}

/** Thư mục này có đủ 2 gói hình chưa */
export const assetsOk = (dir: string) => !!dir && existsSync(path.join(dir, '1_Interiors')) &&
  existsSync(path.join(dir, '2_Characters')) && existsSync(path.join(dir, 'Modern_Office', 'Modern_Office_16x16.png'))

/** `getDir`: hàm, vì app desktop đổi được thư mục trong lúc chạy */
export function limezuHandler(getDir: () => string): Handler {
  return (req, res, next) => {
    const dir = getDir()
    const url = req.url ?? ''
    if (!url.startsWith('/limezu/')) return next()
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      res.statusCode = 405
      return res.end()
    }
    const rel = decodeURIComponent(url.slice('/limezu/'.length).split('?')[0])
    if (rel === '__status') {
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      return res.end(JSON.stringify({ ok: assetsOk(dir) }))
    }
    const file = path.resolve(dir, rel)
    // Chỉ file hình, và chỉ bên trong thư mục gói hình
    if (!dir || !ALLOWED.test(file) || !file.startsWith(path.resolve(dir) + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('content-type', file.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/png')
    res.setHeader('cache-control', 'public, max-age=3600')
    createReadStream(file).pipe(res)
  }
}

export function limezu(dir: string): Plugin {
  const serve = limezuHandler(() => dir)
  return {
    name: 'coopverse-limezu-assets',
    configureServer(server) { server.middlewares.use(serve) },
    configurePreviewServer(server) { server.middlewares.use(serve) },
  }
}
