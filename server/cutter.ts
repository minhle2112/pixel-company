import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { writeHouseMap } from '../scripts/house-map.mjs'
import type { Item } from '../src/data/catalog'
import { houseProblems, type HouseFile } from '../src/world/house'

/**
 * Trang cắt hình (cutter.html, chỉ chạy ở bản dev): cắt hình LimeZu, ghép thành đồ trang trí / bàn ghế làm việc,
 * rồi lưu thẳng vào src/data/items.json (game và server cùng đọc file này).
 *
 * - `GET  /__cutter/sheets`: các ảnh PNG cỡ 16x16 trong thư mục gói hình (đường dẫn tương đối, dấu /), trừ bộ phận nhân vật
 *   và ảnh mẫu cả căn phòng
 * - `GET  /__cutter/items`: nội dung items.json hiện tại
 * - `POST /__cutter/items`: ghi items.json (trang gửi cả file). File này nằm trong cây import của vite.config.ts
 *   (server/coopData kiểm giá, chỗ đặt theo danh sách món), nên Vite tự khởi động lại server và tải lại các trang đang mở
 * - `GET  /__cutter/house`, `POST /__cutter/house`: bố cục nhà src/data/house.json (mục 🏠 Thiết kế nhà). Lưu thì kiểm lỗi,
 *   ghi file rồi sinh lại maps/office.tmj + src/world/mapMarkers.ts (scripts/house-map.mjs); Vite cũng khởi động lại server
 */

export const ITEMS_FILE = path.resolve('src/data/items.json')
export const HOUSE_FILE = path.resolve('src/data/house.json')

/** JSON dễ đọc, dễ so khác biệt: mảng số / chuỗi và object nhỏ (mảnh hình, công dụng) nằm gọn một dòng */
export function formatItems(data: unknown): string {
  return (
    JSON.stringify(data, null, 2)
      .replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`)
      .replace(/\{\s+((?:[^{}\[\]]|\[[^\[\]{}]*\])*?)\s+\}/g, (_, inner: string) => `{ ${inner.replace(/\s*\n\s*/g, ' ')} }`) + '\n'
  )
}

function listSheets(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(r)
      else if (/\.png$/i.test(e.name) && /16x16/i.test(r) && !/^(2_Characters|6_Home_Designs)\//.test(r)) out.push(r)
    }
  }
  walk('')
  return out.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  let s = ''
  for await (const c of req) {
    s += c
    if (s.length > 4_000_000) throw new Error('quá lớn')
  }
  return s
}

/** Kiểm sơ bộ hình dạng file (trang đã kiểm kỹ từng ô) */
/** Mã món / đồ để bàn: không trùng, chỉ chữ không dấu, số, gạch dưới */
function uniqueIds(list: unknown): boolean {
  if (!Array.isArray(list)) return false
  const ids = new Set<string>()
  for (const i of list as { id?: unknown }[]) {
    if (typeof i?.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(i.id) || ids.has(i.id)) return false
    ids.add(i.id)
  }
  return true
}

function valid(d: unknown): d is { desk: unknown; items: { id: string }[] } {
  if (!d || typeof d !== 'object') return false
  const o = d as { desk?: { things?: unknown }; items?: unknown }
  return !!o.desk && uniqueIds(o.items) && uniqueIds(o.desk.things)
}

export function cutter(assetDir: string): Plugin {
  return {
    name: 'coopverse-cutter',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/__cutter/')) return next()
        // Chỉ trang trên chính máy này
        const origin = req.headers.origin
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):5179$/.test(origin)) return send(res, 403, { error: 'origin' })
        try {
          if (url === '/__cutter/sheets' && req.method === 'GET') return send(res, 200, listSheets(assetDir))
          if (url === '/__cutter/items' && req.method === 'GET') return send(res, 200, JSON.parse(readFileSync(ITEMS_FILE, 'utf8')))
          if (url === '/__cutter/items' && req.method === 'POST') {
            if (req.headers['x-coopverse'] !== '1') return send(res, 403, { error: 'thiếu header' })
            const data = JSON.parse(await readBody(req))
            if (!valid(data)) return send(res, 400, { error: 'File không đúng dạng (id trùng hoặc sai?)' })
            writeFileSync(ITEMS_FILE, formatItems(data))
            return send(res, 200, { ok: true })
          }
          if (url === '/__cutter/house' && req.method === 'GET') return send(res, 200, JSON.parse(readFileSync(HOUSE_FILE, 'utf8')))
          if (url === '/__cutter/house' && req.method === 'POST') {
            if (req.headers['x-coopverse'] !== '1') return send(res, 403, { error: 'thiếu header' })
            const data = JSON.parse(await readBody(req)) as HouseFile
            // Kiểm theo danh sách món đang có trên đĩa (có thể vừa lưu ở trang cắt hình)
            const items = (JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) as { items: Item[] }).items
            const bad = houseProblems(data, new Map(items.map((i) => [i.id, i])))
            if (bad.length) return send(res, 400, { error: bad[0].msg })
            writeFileSync(HOUSE_FILE, formatItems(data))
            writeHouseMap(data)
            return send(res, 200, { ok: true })
          }
          send(res, 404, { error: 'không có' })
        } catch (e) {
          send(res, 500, { error: String(e) })
        }
      })
    },
  }
}
