// Sinh lại maps/office.tmj (sàn, tường bắc, viền, mốc) từ src/data/house.json, rồi src/world/mapMarkers.ts.
// Trang thiết kế nhà (cutter.html, mục 🏠) tự làm việc này khi lưu; chạy tay (`npm run house`) khi sửa house.json bằng tay.
// Layer Collision và tileset của bản đồ cũ giữ nguyên.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { houseTmj } from '../src/world/houseMap.mjs'
import { writeMarkers } from './map-markers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(root, 'maps', 'office.tmj')
const HOUSE = path.join(root, 'src', 'data', 'house.json')

/** Ghi bản đồ mới từ nhà `house` (mặc định: house.json); trả true nếu bản đồ đổi */
export function writeHouseMap(house = JSON.parse(readFileSync(HOUSE, 'utf8'))) {
  const prev = readFileSync(MAP, 'utf8')
  // Định dạng như Tiled lưu (thụt 1 dấu cách)
  const next = JSON.stringify(houseTmj(JSON.parse(prev), house), null, 1)
  const changed = prev.replace(/\r\n/g, '\n') !== next
  if (changed) writeFileSync(MAP, next)
  writeMarkers()
  return changed
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(writeHouseMap() ? 'house: đã sinh lại maps/office.tmj + src/world/mapMarkers.ts' : 'house: maps/office.tmj đã khớp house.json')
}
