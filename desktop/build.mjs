// Gom app desktop vào build/app (thư mục electron-builder đóng gói):
//   main.cjs, preload.cjs (esbuild), web/ (bản build Vite), setup/ (màn hình kết nối), pc-hook.cjs, icon.png, package.json.
// Chạy sau `vite build`: npm run desktop:build
//
// `--with-art`: đóng kèm hình LimeZu vào app (chỉ những file app dùng), lấy từ COOPVERSE_ASSETS hoặc
// ../coopverse-assets/limezu. Hình chỉ nằm trong file build trên máy, không bao giờ vào repo.
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'build', 'app')
const at = (...p) => path.join(root, ...p)

if (!existsSync(at('dist', 'index.html'))) throw new Error('Chưa có dist/: chạy "npm run build" trước')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'warning' }
await build({ ...common, entryPoints: [at('desktop', 'main.ts')], outfile: path.join(out, 'main.cjs') })
await build({ ...common, entryPoints: [at('desktop', 'preload.ts')], outfile: path.join(out, 'preload.cjs') })

cpSync(at('dist'), path.join(out, 'web'), { recursive: true })
cpSync(at('desktop', 'setup'), path.join(out, 'setup'), { recursive: true })
cpSync(at('desktop', 'pc-hook.cjs'), path.join(out, 'pc-hook.cjs'))
cpSync(at('desktop', 'icon', 'icon.png'), path.join(out, 'icon.png'))
cpSync(at('desktop', 'icon', 'icon.png'), path.join(out, 'setup', 'icon.png'))
// Phông VT323 (giấy phép OFL, phát tán lại được) cho màn hình kết nối
const require = createRequire(import.meta.url)
const fonts = path.join(path.dirname(require.resolve('@fontsource/vt323/package.json')), 'files')
for (const sub of ['latin', 'latin-ext', 'vietnamese']) {
  cpSync(path.join(fonts, `vt323-${sub}-400-normal.woff2`), path.join(out, 'setup', `vt323-${sub}.woff2`))
}

if (process.argv.includes('--with-art')) bundleArt()

/**
 * Chép đúng những hình app dùng: các sheet trong atlas.json, ảnh đồ trang trí + bàn ghế + đồ trên bàn (src/data/items.json), ảnh của các tileset bản đồ (maps/tilesets, trỏ tới
 * maps/art/... = cùng đường dẫn trong gói LimeZu) + bộ phận nhân vật 16x16 (tủ đồ chọn được mọi kiểu)
 */
function bundleArt() {
  const src = path.resolve(root, process.env.COOPVERSE_ASSETS?.trim() || '../coopverse-assets/limezu')
  const dst = path.join(out, 'limezu')
  const atlas = JSON.parse(readFileSync(at('src', 'pixel', 'atlas.json'), 'utf8'))
  const files = new Set(Object.values(atlas.sheets))
  const items = JSON.parse(readFileSync(at('src', 'data', 'items.json'), 'utf8'))
  const addView = (v) => v?.parts.forEach((p) => p.src && files.add(p.src[0]))
  for (const i of items.items) i.art.views?.forEach(addView)
  for (const t of [items.desk.top, items.desk.side]) if (t) files.add(t.src[0])
  Object.values(items.desk.chair).forEach(addView)
  for (const t of items.desk.things ?? []) Object.values(t.views).forEach(addView)
  for (const f of readdirSync(at('maps', 'tilesets'))) {
    if (!f.endsWith('.tsj')) continue
    const image = path.posix.join('maps/tilesets', JSON.parse(readFileSync(at('maps', 'tilesets', f), 'utf8')).image)
    if (!image.startsWith('maps/art/')) throw new Error(`Tileset ${f}: ảnh phải nằm trong maps/art/`)
    files.add(image.slice('maps/art/'.length))
  }
  const gen = path.join(src, '2_Characters', 'Character_Generator')
  for (const part of ['Bodies', 'Eyes', 'Outfits', 'Hairstyles', 'Accessories']) {
    const dir = path.join(gen, part, '16x16')
    for (const f of readdirSync(dir)) if (f.toLowerCase().endsWith('.png')) files.add(`2_Characters/Character_Generator/${part}/16x16/${f}`)
  }
  let bytes = 0
  for (const rel of files) {
    const from = path.join(src, rel)
    if (!existsSync(from)) throw new Error(`Thiếu hình ${rel} trong ${src}`)
    mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true })
    cpSync(from, path.join(dst, rel))
    bytes += statSync(from).size
  }
  writeFileSync(
    path.join(dst, 'CREDITS.txt'),
    'Pixel art by LimeZu (https://limezu.itch.io): Modern Interiors and Modern Office.\n' +
      'Licensed for use in Pixel Company only. Do not extract, reuse or redistribute these images.\n',
  )
  console.log(`desktop: đóng kèm ${files.size} hình LimeZu (${(bytes / 1048576).toFixed(1)} MB)`)
}

const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'))
writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'pixel-company',
      productName: 'Pixel Company',
      version: pkg.version,
      description: 'Văn phòng pixel cho các agent Paperclip',
      author: 'Pixel Company',
      license: pkg.license ?? 'MIT',
      main: 'main.cjs',
    },
    null,
    2,
  ),
)
console.log(`desktop: build/app sẵn sàng (Pixel Company ${pkg.version})`)
