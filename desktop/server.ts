import { createReadStream, existsSync, statSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import type { Duplex } from 'node:stream'
import path from 'node:path'
import { coopDataHandler } from '../server/coopData'
import { paperclipGuard, wsAllowed, type Handler } from '../server/guard'
import { limezuHandler } from '../server/limezu'

/**
 * Máy chủ nhỏ của app desktop, chỉ nghe trên 127.0.0.1. Làm đúng những việc máy chủ dev của Vite làm:
 * phục vụ bản build (dist/), chuyển /api sang Paperclip qua cùng bộ lọc (server/guard.ts), sổ EXP (/coop),
 * hình LimeZu (/limezu). Thêm /__desktop/ cho màn hình kết nối Paperclip.
 *
 * Cổng cố định (5181, bận thì 5182…): localStorage gắn với địa chỉ trang, đổi cổng là mất cài đặt đã lưu.
 */

const PORTS = [5181, 5182, 5183, 5184, 5185, 5186, 5187, 5188, 5189]

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

export interface ServerOpts {
  /** Bản build của trang (dist/) */
  webDir: string
  /** Màn hình kết nối Paperclip */
  setupDir: string
  /** Thư mục sổ EXP */
  dataDir: string
  target: () => string
  assets: () => string
}

function sendFile(res: ServerResponse, file: string, cache: string) {
  res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('cache-control', cache)
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

/** File tĩnh trong `root`. Không có file thì `fallback` (trang một trang: mọi đường dẫn khác trả index.html). */
function statics(prefix: string, root: string, fallback: string | null): Handler {
  const base = path.resolve(root)
  return (req, res, next) => {
    const url = req.url ?? '/'
    if (!url.startsWith(prefix) || !['GET', 'HEAD'].includes(req.method ?? 'GET')) return next()
    let rel: string
    try {
      rel = decodeURIComponent(url.slice(prefix.length).split('?')[0])
    } catch {
      return next()
    }
    const file = path.resolve(base, rel || 'index.html')
    if (file.startsWith(base + path.sep) && existsSync(file) && statSync(file).isFile()) {
      // File trong assets/ có mã băm trong tên: giữ cache lâu. index.html luôn đọc lại.
      return sendFile(res, file, /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-store')
    }
    if (fallback && !path.extname(rel)) return sendFile(res, path.join(base, fallback), 'no-store')
    next()
  }
}

const client = (url: URL) => (url.protocol === 'https:' ? https : http)

function proxyHttp(target: string): Handler {
  return (req, res, next) => {
    if (!(req.url ?? '').startsWith('/api')) return next()
    const t = new URL(target)
    const u = new URL(req.url!, t)
    const p = client(u).request(
      u,
      { method: req.method, headers: { ...req.headers, host: u.host } },
      (pr) => {
        res.writeHead(pr.statusCode ?? 502, pr.headers)
        pr.pipe(res)
      },
    )
    p.on('error', () => {
      if (res.headersSent) return res.destroy()
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'coopverse: không kết nối được Paperclip' }))
    })
    req.pipe(p)
  }
}

/** Nối WebSocket (kênh sự kiện của công ty) sang Paperclip */
function proxyWs(target: string, req: IncomingMessage, socket: Duplex, head: Buffer) {
  const u = new URL(req.url!, new URL(target))
  const p = client(u).request(u, { method: 'GET', headers: { ...req.headers, host: u.host } })
  const fail = () => socket.destroy()
  p.on('error', fail)
  p.on('response', (r) => {
    // Paperclip không nhận nâng cấp: trả lại mã lỗi rồi đóng
    socket.end(`HTTP/1.1 ${r.statusCode ?? 502} ${r.statusMessage ?? ''}\r\n\r\n`)
    r.resume()
  })
  p.on('upgrade', (pr, ps, phead) => {
    const lines = [`HTTP/1.1 101 ${pr.statusMessage ?? 'Switching Protocols'}`]
    for (let i = 0; i < pr.rawHeaders.length; i += 2) lines.push(`${pr.rawHeaders[i]}: ${pr.rawHeaders[i + 1]}`)
    socket.write(lines.join('\r\n') + '\r\n\r\n')
    if (phead.length) socket.write(phead)
    if (head.length) ps.write(head)
    ps.on('error', fail)
    socket.on('error', () => ps.destroy())
    ps.on('close', fail)
    socket.on('close', () => ps.destroy())
    ps.pipe(socket).pipe(ps)
  })
  p.end()
}

export interface Server { port: number; origin: string; close: () => void }

export async function startServer(opts: ServerOpts): Promise<Server> {
  let port = 0
  const isOwnOrigin = (o: unknown) => o === `http://127.0.0.1:${port}`
  // Chống DNS rebinding: chỉ nhận yêu cầu gửi tới đúng địa chỉ của app
  const hostOk = (h: string | undefined) => h === `127.0.0.1:${port}` || h === `localhost:${port}`

  const chain: Handler[] = [
    paperclipGuard(isOwnOrigin),
    (req, res, next) => proxyHttp(opts.target())(req, res, next),
    coopDataHandler({ target: opts.target, isOwnOrigin, dir: opts.dataDir }),
    limezuHandler(opts.assets),
    statics('/__desktop/', opts.setupDir, null),
    statics('/', opts.webDir, 'index.html'),
  ]

  const server = http.createServer((req, res) => {
    if (!hostOk(req.headers.host)) {
      res.statusCode = 421
      return res.end()
    }
    let i = 0
    const next = () => {
      const h = chain[i++]
      if (!h) {
        res.statusCode = 404
        return res.end()
      }
      try {
        h(req, res, next)
      } catch {
        if (!res.headersSent) res.statusCode = 500
        res.end()
      }
    }
    next()
  })

  server.on('upgrade', (req, socket, head) => {
    if (!hostOk(req.headers.host) || !wsAllowed(req.url, req.headers.origin, isOwnOrigin)) return socket.destroy()
    proxyWs(opts.target(), req, socket, head)
  })

  for (const p of PORTS) {
    const ok = await new Promise<boolean>((resolve) => {
      const onErr = () => resolve(false)
      server.once('error', onErr)
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onErr)
        resolve(true)
      })
    })
    if (ok) {
      port = p
      break
    }
  }
  if (!port) throw new Error(`Các cổng ${PORTS[0]}–${PORTS[PORTS.length - 1]} đều đang bận`)
  return { port, origin: `http://127.0.0.1:${port}`, close: () => server.close() }
}
