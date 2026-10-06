import { useEffect, useRef } from 'react'
import { footprint, itemById } from '../data/catalog'
import { CELL, COLS, ROWS, cellX, cellZ, type OfficeState } from '../data/officeState'
import { useOffice } from '../data/officeSync'
import { STATUS_COLOR } from '../data/types'
import { agentPos, player } from '../runtime'
import { useCoop } from '../store'
import { BOARD, DESK_D, DESK_W, DOOR_X, OFFICE, deskCenter, type World } from '../world/layout'
import { ROOMS, building, isOpen, isOutside } from '../world/rooms'

const PX = 7 // điểm ảnh mỗi mét
const W = (OFFICE.maxX - OFFICE.minX) * PX
const H = (OFFICE.maxZ - OFFICE.minZ) * PX
const sx = (x: number) => (x - OFFICE.minX) * PX
const sz = (z: number) => (z - OFFICE.minZ) * PX
const PING_MS = 5000

function drawStatic(ctx: CanvasRenderingContext2D, world: World, office: OfficeState) {
  ctx.fillStyle = '#2b3242'
  ctx.fillRect(0, 0, W, H)

  // Phòng còn khoá: tối hẳn
  for (const r of ROOMS) {
    if (isOpen(office, r.id)) continue
    ctx.fillStyle = 'rgba(8, 7, 14, 0.7)'
    for (const b of r.rects) ctx.fillRect(sx(cellX(b.c0)), sz(cellZ(b.r0)), (b.c1 - b.c0 + 1) * CELL * PX, (b.r1 - b.r0 + 1) * CELL * PX)
  }
  // Ngoài nhà (nhà không vuông): nền tối
  ctx.fillStyle = '#14161d'
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isOutside(c, r)) ctx.fillRect(sx(cellX(c)), sz(cellZ(r)), CELL * PX, CELL * PX)

  ctx.fillStyle = '#9b7a55'
  for (const s of world.slots) {
    const c = deskCenter(s)
    const side = Math.abs(Math.sin(s.yaw)) > 0.5
    const w = side ? DESK_D : DESK_W
    const d = side ? DESK_W : DESK_D
    ctx.fillRect(sx(c.x - w / 2), sz(c.z - d / 2), w * PX, d * PX)
  }

  // Đồ đã mua (thảm nhạt hơn)
  for (const p of office.items) {
    const i = itemById.get(p.item)
    if (!i || p.stored || i.mount === 'wall') continue
    const { w, d } = footprint(i, p.rot)
    ctx.fillStyle = i.mount === 'rug' ? 'rgba(190, 120, 90, 0.35)' : '#7d8aa6'
    ctx.fillRect(sx(cellX(p.c)), sz(cellZ(p.r)), w * CELL * PX, d * CELL * PX)
  }
  // Tường giữa các phòng, vách trong phòng (cửa giữa hai phòng đã mở thì để trống)
  for (const [k, kind] of building(office).walls) {
    const [c, r] = k.split(',').map(Number)
    ctx.fillStyle = kind === 'low' ? '#c9c3d6' : '#eceaf2'
    ctx.fillRect(sx(cellX(c)), sz(cellZ(r)), CELL * PX, CELL * PX)
  }

  // Bảng ticket trên tường nam
  ctx.fillStyle = '#f7f4ec'
  ctx.fillRect(sx(BOARD.x - BOARD.w / 2), sz(BOARD.z) - 3, BOARD.w * PX, 3)

  ctx.strokeStyle = '#dfe4ec'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, W - 2, H - 2)
  // Cửa vào ở tường nam
  ctx.fillStyle = '#c4553f'
  ctx.fillRect(sx(DOOR_X - 0.75), H - 3, 1.5 * PX, 3)
}

/** Bản đồ nhỏ góc dưới phải: bắc ở trên, chấm màu theo trạng thái, mũi tên là bạn. */
export function Minimap({ world }: { world: World }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const office = useOffice((s) => s.office)

  useEffect(() => {
    const canvas = ref.current!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!

    const bg = document.createElement('canvas')
    bg.width = W * dpr
    bg.height = H * dpr
    const bctx = bg.getContext('2d')!
    bctx.scale(dpr, dpr)
    drawStatic(bctx, world, office)

    // setInterval thay vì rAF: vẫn chạy khi tab bị ẩn, 10 khung/giây là đủ cho bản đồ
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(bg, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const { agents, ping, asks } = useCoop.getState()

      // Agent đang chờ bạn duyệt / trả lời: vòng cam nhấp nháy + dấu "?"
      // (cả ứng viên ở sảnh đang chờ duyệt thuê)
      const waiting = new Set(asks.flatMap((a) => [a.agentId, a.candidateId]))
      const blink = 0.55 + 0.45 * Math.sin(performance.now() / 260)
      for (const a of agents) {
        const p = waiting.has(a.id) ? agentPos.get(a.id) : undefined
        if (!p) continue
        ctx.beginPath()
        ctx.arc(sx(p.x), sz(p.z), 7, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255, 145, 64, ${blink})`
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = '#ffb066'
        ctx.font = '700 10px "Segoe UI", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('?', sx(p.x) + 8, sz(p.z) - 6)
      }

      for (const a of agents) {
        const p = agentPos.get(a.id)
        if (!p) continue
        ctx.beginPath()
        ctx.arc(sx(p.x), sz(p.z), 3.4, 0, Math.PI * 2)
        ctx.fillStyle = a.candidate ? '#e3b860' : STATUS_COLOR[a.status]
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
        ctx.stroke()
      }

      if (ping) {
        const t = performance.now() - ping.at
        const p = agentPos.get(ping.id)
        if (p && t < PING_MS) {
          const k = (t % 1000) / 1000
          ctx.beginPath()
          ctx.arc(sx(p.x), sz(p.z), 4 + k * 12, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(242, 181, 68, ${1 - k})`
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }

      // Bạn: mũi tên theo hướng nhìn
      const fx = Math.sin(player.facing), fz = Math.cos(player.facing)
      const x = sx(player.x), z = sz(player.z)
      ctx.beginPath()
      ctx.moveTo(x + fx * 6, z + fz * 6)
      ctx.lineTo(x - fx * 3.5 + fz * 3.8, z - fz * 3.5 - fx * 3.8)
      ctx.lineTo(x - fx * 3.5 - fz * 3.8, z - fz * 3.5 + fx * 3.8)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#1d2230'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    draw()
    const id = setInterval(draw, 100)
    return () => clearInterval(id)
  }, [world, office])

  return (
    <div className="panel minimap">
      <canvas ref={ref} style={{ width: W, height: H }} />
    </div>
  )
}
