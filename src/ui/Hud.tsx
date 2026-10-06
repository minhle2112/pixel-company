import { useEffect, useState } from 'react'
import { PAPERCLIP_UI } from '../data/paperclip'
import { switchCompany } from '../data/sync'
import { leadIdsOf } from '../data/hire'
import { STATUS_COLOR, STATUS_LABEL } from '../data/types'
import { useAssistantLink } from '../data/assistant'
import { ASSISTANT_ID, useCoop } from '../store'
import type { World } from '../world/layout'
import { itemById } from '../data/catalog'
import { useExp } from '../data/exp'
import type { OfficeState } from '../data/officeState'
import { useOffice } from '../data/officeSync'
import { USE_LABEL } from '../life/playerUse'
import { spotById } from '../life/spots'
import { desktop } from '../desktop'
import { RoomsPanel, XuBadge } from './Rooms'
import { useDeco } from './decoStore'
import { ShopPanel } from './Shop'
import { FameView } from './FameView'
import { AskSheet, Inbox } from './Inbox'
import { KanbanView } from './KanbanView'
import { Minimap } from './Minimap'
import { Clock, SettingsPanel, Toolbar } from './Settings'
import { Terminal } from './Terminal'
import { AssistantPanel } from './Assistant'
import { Avatar, Wardrobe } from '../pixel/Wardrobe'
import { partsOf, usePixelLooks } from '../pixel/look'

function Toast() {
  const toast = useCoop((s) => s.toast)
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (!toast) return
    setShown(toast.id)
    const t = setTimeout(() => setShown(null), 4200)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast || shown !== toast.id) return null
  return <div className="toast">{toast.text}</div>
}

/** Số giây còn lại tới lúc thử kết nối lại. */
function useCountdown(at: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!at) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [at])
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0
}

function ConnBadge() {
  const conn = useCoop((s) => s.conn)
  const version = useCoop((s) => s.version)
  const retryAt = useCoop((s) => s.retryAt)
  const secs = useCountdown(conn === 'offline' ? retryAt : null)
  const text = {
    connecting: 'Đang kết nối Paperclip…',
    live: `Trực tiếp · Paperclip ${version ?? ''}`.trim(),
    offline: secs > 0 ? `Mất kết nối · thử lại sau ${secs}s` : 'Mất kết nối · đang thử lại…',
    demo: 'Bản demo · dữ liệu giả',
  }[conn]
  return (
    <div className={`badge conn-${conn}`}>
      <span className="conn-dot" />
      {text}
    </div>
  )
}

/** Tên công ty đang xem; Paperclip có nhiều công ty thì thành ô chọn để đổi. */
function CompanyLine() {
  const companies = useCoop((s) => s.companies)
  const company = useCoop((s) => s.company)
  const demo = useCoop((s) => s.conn === 'demo')
  if (demo) return <div className="brand-sub">Văn phòng demo</div>
  // Công ty cho agent tự thuê agent mới mà không cần bạn duyệt
  const warn = company?.hireApproval === false && (
    <div className="brand-warn" title="Trong Paperclip, mở cài đặt công ty và bật &quot;Require board approval for new agents&quot;.">
      ⚠ Agent thuê người mới không cần bạn duyệt
    </div>
  )
  if (company && companies.length > 1) {
    return (
      <>
      <select className="brand-sub company-pick" value={company.id} onChange={(e) => switchCompany(e.target.value)} aria-label="Đổi công ty" title="Đổi công ty">
        {companies.map((c) => <option key={c.id} value={c.id}>Văn phòng {c.name}</option>)}
      </select>
      {warn}
      </>
    )
  }
  return <><div className="brand-sub">{company ? `Văn phòng ${company.name}` : 'Văn phòng AI'}</div>{warn}</>
}

function Notes() {
  const notes = useCoop((s) => s.notes)
  const dismiss = useCoop((s) => s.dismissNote)
  return (
    <div className="notes">
      {notes.map((n) => (
        <button key={n.id} className={`note note-${n.kind}`} onClick={() => dismiss(n.id)} title="Bấm để ẩn">
          {n.text}
        </button>
      ))}
    </div>
  )
}

/** Paperclip tắt và chưa từng có dữ liệu: hướng dẫn bật. */
function OfflineCard() {
  const conn = useCoop((s) => s.conn)
  const hasData = useCoop((s) => s.hasData)
  if (hasData || conn !== 'offline') return null
  if (desktop) {
    return (
      <div className="panel center-card">
        <div className="center-title">Chưa kết nối được Paperclip</div>
        <p>
          Pixel Company cần Paperclip chạy ở <code>{PAPERCLIP_UI.replace(/^https?:\/\//, '')}</code>. Mở màn hình kết nối để
          bật Paperclip hoặc đổi địa chỉ.
        </p>
        <p className="muted">Pixel Company tự kết nối lại khi Paperclip bật xong.</p>
        <div className="desk-actions">
          <button type="button" className="desk-btn primary" onClick={() => void desktop?.openSetup()}>Kết nối Paperclip…</button>
          <a href="?demo">Xem bản demo với dữ liệu giả</a>
        </div>
      </div>
    )
  }
  return (
    <div className="panel center-card">
      <div className="center-title">Chưa kết nối được Paperclip</div>
      <p>
        Pixel Company cần Paperclip chạy ở <code>{PAPERCLIP_UI.replace(/^https?:\/\//, '')}</code>. Bấm đúp{' '}
        <code>start-pixel-company.cmd</code> (tự bật Paperclip nếu đã khai báo trong <code>.env</code>), hoặc tự chạy{' '}
        <code>paperclipai run</code>.
      </p>
      <p className="muted">Paperclip chạy ở địa chỉ khác thì sửa <code>VITE_PAPERCLIP_URL</code> trong file <code>.env</code>.</p>
      <p className="muted">Pixel Company tự kết nối lại khi Paperclip bật xong.</p>
      <a href="?demo">Xem bản demo với dữ liệu giả</a>
    </div>
  )
}

/** "Ngồi nghỉ · Sofa xám", "Chơi game · Máy game đỏ" */
function labelOf(spotId: string, o: OfficeState) {
  const s = spotById(spotId)
  const p = o.items.find((x) => x.uid === s?.item)
  const name = itemById.get(p?.item ?? '')?.name
  const verb = (s?.act && USE_LABEL[s.act]) ?? 'Dùng'
  return name ? `${verb} · ${name}` : verb
}

export function Hud({ world }: { world: World }) {
  const agents = useCoop((s) => s.agents)
  const conn = useCoop((s) => s.conn)
  const hasData = useCoop((s) => s.hasData)
  const nearId = useCoop((s) => s.nearId)
  const ping = useCoop((s) => s.ping)
  const cycleStatus = useCoop((s) => s.cycleStatus)
  const openAgent = useCoop((s) => s.openAgent)
  const focusId = useCoop((s) => s.focusId)
  const nearBoard = useCoop((s) => s.nearBoard)
  const nearFame = useCoop((s) => s.nearFame)
  const nearUse = useCoop((s) => s.nearUse)
  const usingSpot = useCoop((s) => s.using)
  const office = useOffice((s) => s.office)
  const boardOpen = useCoop((s) => s.boardOpen)
  const fameOpen = useCoop((s) => s.fameOpen)
  const roomsOpen = useCoop((s) => s.roomsOpen)
  const decoOpen = useDeco((s) => s.open)
  const expStats = useExp((s) => s.stats)
  const wardrobeId = useCoop((s) => s.wardrobeId)
  const settingsOpen = useCoop((s) => s.settingsOpen)
  const company = useCoop((s) => s.company)
  const asks = useCoop((s) => s.asks)
  const askId = useCoop((s) => s.askId)
  const assistantOpen = useCoop((s) => s.assistantOpen)
  const nearDesk = nearId === ASSISTANT_ID
  useAssistantLink()
  // Danh sách nhân sự gọn (một dòng mỗi người, chi tiết khi rê chuột) hoặc đầy đủ; nhớ trên trình duyệt
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('coopverse.rosterFull') !== '1' } catch { return true } })
  const toggleRoster = () => {
    setCompact((c) => {
      try { localStorage.setItem('coopverse.rosterFull', c ? '1' : '0') } catch { /* chỉ giữ trong phiên */ }
      return !c
    })
  }
  const near = agents.find((a) => a.id === nearId)
  const focused = agents.find((a) => a.id === focusId)
  const viewing = !!focusId || boardOpen || fameOpen || !!wardrobeId || !!askId
  const waitingOn = (id: string) => asks.filter((a) => a.agentId === id).length
  const nearAsks = near ? waitingOn(near.id) : 0

  // Đang xem CLI / bảng ticket: ẩn bảng tên và các bảng HUD che màn hình
  useEffect(() => {
    document.body.classList.toggle('focus-mode', viewing)
  }, [viewing])
  // Ảnh nhỏ trong danh sách nhân sự cập nhật khi chỉnh tủ đồ
  usePixelLooks((s) => s.custom)
  const leadIds = leadIdsOf(agents)
  const working = agents.filter((a) => a.status === 'running').length
  const staff = agents.filter((a) => !a.candidate).length
  const demo = conn === 'demo'

  return (
    <div className="hud">
      <div className="left-col">
        <div className="panel brand">
          <div className="brand-title">PIXEL COMPANY</div>
          <CompanyLine />
          <ConnBadge />
          <Clock />
          <XuBadge />
        </div>
        <Toolbar />
        <Inbox />
        {settingsOpen && <SettingsPanel />}
        {roomsOpen && <RoomsPanel />}
        {decoOpen && <ShopPanel />}
        <Notes />
      </div>

      <div className={`panel roster${compact ? ' compact' : ''}`}>
        <div className="roster-head">
          <span>Nhân sự</span>
          <span className="roster-count">{working}/{staff} đang làm</span>
          <button className="roster-toggle" onClick={toggleRoster} title={compact ? 'Hiện chi tiết việc đang làm' : 'Thu gọn danh sách'} aria-expanded={!compact}>
            {compact ? '▸' : '▾'}
          </button>
        </div>
        {agents.map((a) => (
          <button
            key={a.id}
            className={`roster-item${ping?.id === a.id ? ' pinged' : ''}`}
            onClick={() => openAgent(a.id)}
            onContextMenu={demo ? (e) => { e.preventDefault(); if (!a.candidate) cycleStatus(a.id) } : undefined}
            title={a.candidate ? 'Bấm để xem hồ sơ' : 'Bấm để mở CLI' + (demo ? ' · chuột phải: đổi trạng thái (demo)' : '')}
          >
            <span className="roster-av">
              <Avatar parts={partsOf(a.id, a.name, leadIds.has(a.id))} scale={1} />
              <span className={`np-dot${a.candidate ? ' dot-cand' : ''}`} style={{ background: a.candidate ? undefined : STATUS_COLOR[a.status] }} />
            </span>
            <span className="roster-main">
              <span className="roster-row">
                <span className="roster-name">{!a.candidate && <span className="lv-chip" title="Cấp">Lv {expStats[a.id]?.level ?? 1}</span>}{a.name}{waitingOn(a.id) > 0 && <span className="roster-ask" title="Đang chờ bạn duyệt / trả lời"> 🙋</span>}{!a.candidate && a.status === 'error' && <span className="roster-err" title="Lỗi">!</span>}</span>
                <span className="roster-status">{a.candidate ? 'Ứng viên' : STATUS_LABEL[a.status]}</span>
              </span>
              {a.status === 'running' && a.task && <span className="roster-task">{a.task}</span>}
              {!a.candidate && (a.status === 'error' || a.status === 'paused') && a.reason && <span className="roster-task">{a.reason}</span>}
            </span>
          </button>
        ))}
        {hasData && agents.length === 0 && (
          <div className="roster-hint">
            {company || demo ? 'Công ty chưa có agent nào.' : 'Paperclip chưa có công ty nào. Tạo công ty trong Paperclip, Pixel Company sẽ tự nhận.'}
          </div>
        )}
        {!hasData && <div className="roster-hint">Đang chờ dữ liệu từ Paperclip…</div>}
        {agents.length > 0 && (
          <div className="roster-hint">
            {demo ? 'Bấm tên để mở CLI · chuột phải: đổi trạng thái (demo)' : 'Bấm tên để mở CLI'}
          </div>
        )}
      </div>

      {nearBoard && !viewing && (
        <div className="prompt">
          <kbd>E</kbd>
          <span>Xem bảng ticket</span>
        </div>
      )}

      {nearFame && !nearBoard && !usingSpot && !viewing && (
        <div className="prompt">
          <kbd>E</kbd>
          <span>Xem bảng vinh danh</span>
        </div>
      )}

      {(usingSpot || (nearUse && !nearBoard && !nearFame)) && !viewing && !decoOpen && (
        <div className="prompt">
          <kbd>E</kbd>
          <span>{usingSpot ? 'Đứng dậy (hoặc đi tiếp)' : labelOf(nearUse!, office)}</span>
        </div>
      )}

      {nearDesk && !viewing && !assistantOpen && (
        <div className="prompt">
          <kbd>E</kbd>
          <span>Chat với lễ tân (Trợ lý) · ở đâu cũng bấm được <kbd>L</kbd></span>
        </div>
      )}

      {near && !viewing && (
        <div className="prompt">
          <kbd>E</kbd>
          <span>
            {near.candidate
              ? `Xem hồ sơ ứng viên · ${near.name}`
              : nearAsks > 0
              ? `Duyệt / trả lời · ${near.name} · ${nearAsks} việc chờ bạn`
              : near.status === 'running'
              ? `Chat / xem CLI · ${near.name}`
              : near.status === 'terminated'
                ? `${near.name} · ${STATUS_LABEL[near.status]}`
                : `Chat / mở máy · ${near.name} · ${STATUS_LABEL[near.status]}`}
          </span>
        </div>
      )}

      <div className="help">
        {decoOpen ? (
          // Đang trang trí: chỉ các phím của chế độ này
          <div className="help-keys">
            <span>Bấm chuột: đặt thử / chọn món</span>
            <span><kbd>R</kbd> xoay</span>
            <span><kbd>Enter</kbd> mua</span>
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> đi xem góc khác</span>
            <span><kbd>Esc</kbd> bỏ / thoát</span>
          </div>
        ) : (
        <div className="help-keys">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> đi</span>
          <span><kbd>Shift</kbd> chạy</span>
          <span><kbd>E</kbd> hoặc bấm chuột: mở CLI agent / bảng ticket</span>
          <span><kbd>E</kbd> cạnh đồ: ngồi / dùng</span>
          <span><kbd>L</kbd> lễ tân (Trợ lý)</span>
          <span><kbd>Q</kbd> việc chờ duyệt</span>
          <span><kbd>B</kbd> mở phòng</span>
          <span><kbd>T</kbd> trang trí</span>
          <span><kbd>C</kbd> tủ đồ</span>
          <span><kbd>M</kbd> nhạc</span>
          <span><kbd>Esc</kbd> đóng</span>
        </div>
        )}
      </div>

      <Minimap world={world} />
      <OfflineCard />
      {assistantOpen && !viewing && <AssistantPanel />}
      {focused && <Terminal key={focused.id} agent={focused} />}
      {boardOpen && <KanbanView />}
      {fameOpen && <FameView />}
      {wardrobeId && <Wardrobe id={wardrobeId} />}
      <AskSheet />
      <Toast />
    </div>
  )
}
