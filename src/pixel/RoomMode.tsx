import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Graphics } from 'pixi.js'
import { useBalance, useOffice } from '../data/officeSync'
import { fmtXu } from '../data/xu'
import { useCoop } from '../store'
import { ROOMS, isOpen, nextRoomPrice, unlockBlock, type Room } from '../world/rooms'
import { roomShade, type Rect } from './office'
import { stage, ticks, toScreen, type Tick } from './stage'

/**
 * Phòng khoá trên bản đồ: phủ tối (vẽ trong office.ts), nhãn "🔒 tên phòng" ở giữa. Bấm vào phòng khoá thì mở bảng
 * Mở phòng (phím B) chọn sẵn phòng đó. Đang mở bảng: nhãn kèm giá, rê chuột lên phòng thì sáng viền.
 */

/** Phòng khoá đang được rê chuột lên (Scene cập nhật mỗi khung hình) */
export const roomHover: { id: string | null } = { id: null }

/** Phòng khoá dưới điểm (x, y) pixel gốc */
export function lockedAt(x: number, y: number): Room | undefined {
  const o = useOffice.getState().office
  if (!useOffice.getState().ready) return undefined
  return ROOMS.find((r) => !isOpen(o, r.id) && shades(r).some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h))
}

const HL = 0xf4d35e

/** Phần màn hình của mỗi phòng (không đổi khi chạy) */
const shadeCache = new Map<string, Rect[]>()
const shades = (r: Room) => {
  let s = shadeCache.get(r.id)
  if (!s) shadeCache.set(r.id, (s = roomShade(r)))
  return s
}

/** Các cạnh viền của phần màn hình (đoạn ngang / dọc theo ô 16 px), để vẽ viền quanh phòng chữ L */
interface Edge { x: number; y: number; len: number; horiz: boolean; /** Phía ngoài: -1 = bắc / tây, 1 = nam / đông */ out: -1 | 1 }
function outline(rs: Rect[]): Edge[] {
  const T = 16
  const inside = (x: number, y: number) => rs.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
  const out: Edge[] = []
  for (const b of rs)
    for (let y = b.y; y < b.y + b.h; y += T)
      for (let x = b.x; x < b.x + b.w; x += T) {
        const h = Math.min(T, b.y + b.h - y)
        if (!inside(x, y - 1)) out.push({ x, y, len: T, horiz: true, out: -1 })
        if (!inside(x, y + h)) out.push({ x, y: y + h - 1, len: T, horiz: true, out: 1 })
        if (!inside(x - 1, y)) out.push({ x, y, len: h, horiz: false, out: -1 })
        if (!inside(x + T, y)) out.push({ x: x + T - 1, y, len: h, horiz: false, out: 1 })
      }
  return out
}

export function RoomOverlay() {
  const open = useCoop((s) => s.roomsOpen)
  const pick = useCoop((s) => s.roomPick)
  const office = useOffice((s) => s.office)
  const ready = useOffice((s) => s.ready)
  const balance = useBalance()
  const labels = useRef(new Map<string, HTMLDivElement>())
  const locked = ready ? ROOMS.filter((r) => !isOpen(office, r.id)) : []
  const price = nextRoomPrice(office)

  // Khung phòng đang rê / đang chọn (lớp fx, trên cả ngày/đêm) + đặt nhãn theo camera mỗi khung hình
  useEffect(() => {
    if (!stage.fx) return
    const g = new Graphics()
    stage.fx.addChild(g)
    let last = ''
    const tick: Tick = (_dt, t) => {
      const s = useCoop.getState()
      const sel = s.roomsOpen ? s.roomPick : null
      const hv = roomHover.id
      const ants = Math.floor(t * 8) % 4
      const key = `${hv}|${sel}|${ants}`
      if (key !== last) {
        last = key
        g.clear()
        for (const id of new Set([hv, sel])) {
          const r = id ? ROOMS.find((x) => x.id === id) : undefined
          if (!r || isOpen(useOffice.getState().office, r.id)) continue
          const rs = shades(r)
          for (const b of rs) g.rect(b.x, b.y, b.w, b.h).fill({ color: HL, alpha: r.id === sel ? 0.08 : 0.05 })
          // Viền "kiến bò": nét đứt 2 px chạy quanh phòng (theo toạ độ màn hình, để các đoạn nối liền)
          for (const e of outline(rs)) {
            // Viền tối ngay bên ngoài cho nổi trên sàn sáng
            if (e.horiz) g.rect(e.x, e.y + e.out, e.len, 1).fill({ color: 0x2a1f14, alpha: 0.8 })
            else g.rect(e.x + e.out, e.y, 1, e.len).fill({ color: 0x2a1f14, alpha: 0.8 })
            const p0 = e.horiz ? e.x : e.y
            for (let k = 0; k < e.len; k++) {
              if ((p0 + k + 4 - ants) % 4 >= 2) continue
              if (e.horiz) g.rect(e.x + k, e.y, 1, 1).fill(HL)
              else g.rect(e.x, e.y + k, 1, 1).fill(HL)
            }
          }
        }
      }
      for (const [id, el] of labels.current) {
        const r = ROOMS.find((x) => x.id === id)
        if (!r) continue
        const b = shades(r).reduce((a, x) => (x.w * x.h > a.w * a.h ? x : a))
        const p = toScreen(b.x + b.w / 2, b.y + b.h / 2)
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
        el.classList.toggle('hv', id === hv)
      }
    }
    ticks.add(tick)
    return () => {
      ticks.delete(tick)
      g.removeFromParent()
      g.destroy()
    }
  }, [])

  if (!stage.overlay) return null
  return createPortal(
    <>
      {locked.map((r) => {
        const why = unlockBlock(office, r.id)
        return (
          <div
            key={r.id}
            className={`px-anchor room-tag${open ? ' open' : ''}${!why && balance >= price ? ' ok' : ' poor'}${open && pick === r.id ? ' on' : ''}`}
            style={{ transform: 'translate(-9999px, -9999px)' }}
            ref={(el) => { if (el) labels.current.set(r.id, el); else labels.current.delete(r.id) }}
          >
            <span className="room-name">🔒 {r.name}</span>
            <span className="room-price">{why ? why : `Mở · ${fmtXu(price)} Xu`}</span>
          </div>
        )
      })}
    </>,
    stage.overlay,
  )
}
