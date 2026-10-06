import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { writeMarkers } from './scripts/map-markers.mjs'
import { paperclipUrl } from './src/config'
import { coopData } from './server/coopData'
import { cutter } from './server/cutter'
import { paperclipGuard, wsAllowed } from './server/guard'
import { assetDir, limezu } from './server/limezu'

/** Trang của chính Pixel Company bản pixel (dev 5179, preview 5180; bản 3D dùng 5177/5178 nên chạy song song được). */
const isOwnOrigin = (o: unknown) => typeof o === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):(5179|5180)$/.test(o)

/** Bộ lọc /api (server/guard.ts), gắn trực tiếp (không return) để chạy trước middleware proxy của Vite */
function guardPlugin(): Plugin {
  const guard = paperclipGuard(isOwnOrigin)
  return {
    name: 'coopverse-paperclip-guard',
    configureServer(server) { server.middlewares.use(guard) },
    configurePreviewServer(server) { server.middlewares.use(guard) },
  }
}

/** Lưu maps/office.tmj trong Tiled → sinh lại src/world/mapMarkers.ts (vị trí cửa sổ, bảng, cửa...), trang tự tải lại */
function mapMarkers(): Plugin {
  const MAP = path.resolve('maps/office.tmj')
  const run = (log: (m: string) => void, warn: (m: string) => void) => {
    try { if (writeMarkers()) log('map: đã cập nhật src/world/mapMarkers.ts (server dùng vị trí mới sau khi chạy lại dev)') } catch (e) { warn(String(e)) }
  }
  return {
    name: 'coopverse-map-markers',
    buildStart() { run(console.log, (m) => this.warn(m)) },
    configureServer(server) {
      const { logger } = server.config
      server.watcher.add(MAP)
      server.watcher.on('change', (f) => { if (path.resolve(f) === MAP) run((m) => logger.info(m), (m) => logger.error(m)) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'COOPVERSE_'])
  const target = paperclipUrl(env.VITE_PAPERCLIP_URL)

  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target,
      changeOrigin: true,
      ws: true,
      configure(p) {
        // WebSocket không đi qua middleware ở trên nên kiểm riêng ở đây
        p.on('proxyReqWs', (proxyReq, req, socket) => {
          if (!wsAllowed(req.url, req.headers.origin, isOwnOrigin)) {
            proxyReq.destroy()
            socket.destroy()
          }
        })
      },
    },
  }

  // Chỉ mở trên máy này (127.0.0.1)
  return {
    plugins: [react(), mapMarkers(), guardPlugin(), coopData({ target, isOwnOrigin }), limezu(assetDir(env)),
      // Trang cắt hình (chỉ dev). items.json nằm trong cây import của file này nên lưu xong Vite tự khởi động lại server
      cutter(assetDir(env))],
    server: { host: '127.0.0.1', port: 5179, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 5180, strictPort: true, proxy },
    build: {
      // three.js tự nó đã ~740 kB và không chia nhỏ được; app chỉ chạy localhost nên chấp nhận
      chunkSizeWarningLimit: 800,
      rolldownOptions: {
        output: {
          // Tách thư viện ra file riêng: trình duyệt giữ cache khi chỉ code Pixel Company đổi
          codeSplitting: {
            groups: [
              { name: 'three', test: /node_modules[\/]three[\/]/ },
              { name: 'r3f', test: /node_modules[\/](@react-three|three-stdlib|troika|maath|zustand|suspend-react|its-fine)/ },
              { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            ],
          },
        },
      },
    },
  }
})
