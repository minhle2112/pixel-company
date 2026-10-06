// Đóng gói plugin vào dist/ (dist đã commit sẵn nên người dùng không phải build).
// Bundles the plugin into dist/ (dist is committed, so users do not need to build).
import { build } from 'esbuild'

const common = { bundle: true, format: 'esm', logLevel: 'info', legalComments: 'none' }

await build({ ...common, entryPoints: ['src/manifest.ts'], outfile: 'dist/manifest.js', platform: 'node', target: 'node22' })
// Worker chạy trong Node của Paperclip: gói luôn SDK vào để lúc chạy không cần node_modules.
await build({ ...common, entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js', platform: 'node', target: 'node22', minify: true })
// UI chạy trong trang Paperclip: React và SDK UI do Paperclip cung cấp.
await build({
  ...common,
  entryPoints: ['src/ui/index.tsx'],
  outfile: 'dist/ui/index.js',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@paperclipai/plugin-sdk/ui', '@paperclipai/plugin-sdk/ui/hooks'],
})
