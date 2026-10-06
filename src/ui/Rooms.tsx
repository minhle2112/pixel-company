import { useState } from 'react'
import { demoGift, isDemo, openRoom, resetDemoOffice, useBalance, useOffice } from '../data/officeSync'
import { XU_TICKET, fmtXu } from '../data/xu'
import { useCoop } from '../store'
import { ROOMS, ROOM_PRICES, isOpen, nextRoomPrice, roomById, unlockBlock } from '../world/rooms'

/**
 * Bảng Mở phòng (phím B / nút chìa khoá): số Xu trong quỹ, phòng đang chọn trên bản đồ, danh sách phòng,
 * ai góp nhiều Xu nhất. Bảng nhỏ bên trái như Cài đặt: vẫn đi lại được khi đang mở.
 */
export function RoomsPanel() {
  const close = useCoop((s) => s.toggleRooms)
  const pick = useCoop((s) => s.roomPick)
  const setPick = useCoop((s) => s.pickRoom)
  const showToast = useCoop((s) => s.showToast)
  const agents = useCoop((s) => s.agents)
  const demo = useCoop((s) => s.conn === 'demo')
  const office = useOffice((s) => s.office)
  const ready = useOffice((s) => s.ready)
  // "Làm lại từ đầu" xoá cả phòng đã mở, đồ, chỗ bàn và các lần +500: bấm 2 lần cho chắc
  const [sureReset, setSureReset] = useState(false)
  const byAgent = useOffice((s) => s.earned.byAgent)
  const balance = useBalance()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const price = nextRoomPrice(office)
  const room = pick ? roomById.get(pick) : undefined
  const locked = ROOMS.filter((r) => !isOpen(office, r.id))
  const done = ROOMS.length - locked.length
  const top = Object.entries(byAgent)
    .map(([id, xu]) => ({ name: agents.find((a) => a.id === id)?.name, xu }))
    .filter((r) => r.name && r.xu > 0)
    .sort((a, b) => b.xu - a.xu)
    .slice(0, 3)

  async function unlock(id: string) {
    const r = roomById.get(id)
    if (!r) return
    setBusy(id)
    setErr(null)
    try {
      await openRoom(id)
      showToast(`🎉 Đã mở ${r.name.toLowerCase()} · −${fmtXu(price)} Xu`)
      if (pick === id) setPick(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không mở được')
    }
    setBusy(null)
  }

  /** Nút mở phòng, hoặc lý do chưa mở được */
  const action = (id: string) => {
    const why = unlockBlock(office, id)
    if (why) return <span className="muted" title={why}>{why === 'Phòng đã mở' ? '✓ đã mở' : '🔒 chưa tới được'}</span>
    return (
      <button type="button" className="desk-btn primary" disabled={!!busy || balance < price} onClick={() => void unlock(id)}
        title={balance < price ? `Còn thiếu ${fmtXu(price - balance)} Xu` : undefined}>
        {busy === id ? 'Đang mở…' : `Mở · ${fmtXu(price)} Xu`}
      </button>
    )
  }

  return (
    <section className="panel settings cleanup" aria-label="Mở phòng mới">
      <div className="set-head">
        <b>🔑 Mở phòng</b>
        <button className="term-close" onClick={close}><kbd>Esc</kbd> Đóng</button>
      </div>
      <div className="xu-big" title="Xu trong quỹ văn phòng">🪙 {fmtXu(balance)} <small>Xu</small> <DemoXu /></div>
      <div className="clean-bar" title={`${done}/${ROOMS.length} phòng đã mở`}>
        <i style={{ width: `${Math.round((100 * done) / ROOMS.length)}%` }} />
      </div>
      <p className="set-hint">
        {!ready ? 'Đang đọc văn phòng…' : !locked.length
          ? 'Đã mở hết các phòng! Bấm T (nút 🛋️) để sắm thêm đồ.'
          : `Đã mở ${done}/${ROOMS.length} phòng. Bấm vào phòng tối trên bản đồ để chọn.`}
      </p>

      {room && !isOpen(office, room.id) && (
        <div className="clean-pick">
          <div><b>{room.icon} {room.name}</b></div>
          {room.blurb.trim() && <p className="set-hint">Có sẵn: {room.blurb.trim().toLowerCase()}.</p>}
          {unlockBlock(office, room.id) && <p className="set-hint">Phòng này chưa có cửa thông với phòng đã mở: mở phòng bên cạnh trước.</p>}
          <div className="set-row set-btns">
            {action(room.id)}
            <button type="button" className="desk-btn" onClick={() => setPick(null)}>Bỏ chọn</button>
          </div>
          {!unlockBlock(office, room.id) && balance < price && <p className="set-hint">Còn thiếu {fmtXu(price - balance)} Xu: chờ agent làm xong thêm ticket.</p>}
        </div>
      )}
      {err && <p className="set-hint clean-err">{err}</p>}

      <div className="set-sec">Các phòng</div>
      {ROOMS.map((r) => (
        <div key={r.id} className="set-row clean-row">
          <span className={isOpen(office, r.id) ? 'muted' : ''} title={r.blurb}>{r.icon} {r.name}</span>
          {action(r.id)}
        </div>
      ))}

      <div className="set-sec">Xu từ đâu ra</div>
      <p className="set-hint">
        Agent làm xong ticket trên board thì quỹ có Xu: ưu tiên thấp {XU_TICKET.low}, vừa {XU_TICKET.medium}, cao {XU_TICKET.high},
        khẩn {XU_TICKET.critical} Xu; agent cấp càng cao càng được nhiều (mỗi cấp +10%). Phòng mở sau đắt hơn:{' '}
        {ROOM_PRICES.map(fmtXu).join(' → ')} Xu.
      </p>
      {top.length > 0 && (
        <p className="set-hint">Góp nhiều nhất: {top.map((r) => `${r.name} ${fmtXu(r.xu)}`).join(' · ')}</p>
      )}
      {demo && (
        <div className="set-row set-btns">
          {!sureReset
            ? <button type="button" className="desk-btn" onClick={() => setSureReset(true)}
              title="Đưa bản demo về lúc đầu: khoá lại các phòng, mất cả đồ và Xu đã thêm">Làm lại từ đầu (demo)</button>
            : <>
              <button type="button" className="desk-btn danger" onClick={() => { setSureReset(false); resetDemoOffice() }}>Chắc chưa? Xoá cả phòng, đồ, Xu thêm</button>
              <button type="button" className="desk-btn" onClick={() => setSureReset(false)}>Thôi</button>
            </>}
        </div>
      )}
    </section>
  )
}

/** Số Xu trong quỹ dưới logo: bấm để mở bảng Mở phòng */
export function XuBadge() {
  const balance = useBalance()
  const ready = useOffice((s) => s.ready)
  const toggle = useCoop((s) => s.toggleRooms)
  if (!ready) return null
  return (
    <div className="xu-row">
      <button type="button" className="xu-badge" onClick={toggle} title="Quỹ văn phòng · bấm để mở phòng mới (phím B)">
        🪙 {fmtXu(balance)} Xu
      </button>
      <DemoXu />
    </div>
  )
}

/** Bản demo: nút thêm 500 Xu để thử mở phòng, mua đồ (bản thật không có) */
export function DemoXu() {
  if (!isDemo()) return null
  return (
    <button type="button" className="xu-add" title="Bản demo: thêm 500 Xu để thử"
      onClick={() => { demoGift(500); useCoop.getState().showToast('🪙 +500 Xu (bản demo)') }}>
      +500
    </button>
  )
}
