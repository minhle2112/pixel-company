import { useEffect, useRef } from 'react'
import { unlockAudio, uiTick } from '../audio/engine'
import { askLabel } from '../data/types'
import { useCoop } from '../store'
import { AskCard, ago } from './AskCard'

/**
 * Nút "Chờ duyệt" ở cột trái (phím Q): bấm mở danh sách mọi việc đang chờ bạn.
 * Mỗi dòng: tìm agent trên bản đồ (để đi tới bàn) hoặc mở thẻ duyệt nhanh ngay tại chỗ.
 */
export function Inbox() {
  const asks = useCoop((s) => s.asks)
  const agents = useCoop((s) => s.agents)
  const open = useCoop((s) => s.inboxOpen)
  const toggle = useCoop((s) => s.toggleInbox)
  const openAsk = useCoop((s) => s.openAsk)
  const pingAgent = useCoop((s) => s.pingAgent)
  if (!asks.length) return null
  // Cũ nhất trước: chờ lâu nhất thì xử lý trước
  const sorted = [...asks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return (
    <div className="inbox">
      <button
        className={`inbox-btn${open ? ' on' : ''}`}
        onClick={() => { unlockAudio(); toggle(); uiTick() }}
        aria-expanded={open}
        aria-keyshortcuts="Q"
        title="Việc đang chờ bạn duyệt / trả lời (phím Q)"
      >
        <span aria-hidden>🙋</span> <b>{asks.length}</b> việc chờ bạn <kbd>Q</kbd>
      </button>
      {open && (
        <div className="panel inbox-list" role="list">
          {sorted.map((a) => {
            const who = agents.find((x) => x.id === a.agentId)
            return (
              <div key={a.id} className={`inbox-item kind-${a.kind}`} role="listitem">
                <button className="inbox-main" onClick={() => openAsk(a.id)} title="Mở thẻ để duyệt / trả lời ngay">
                  <span className="inbox-top">
                    <span className="ask-tag">{askLabel(a)}</span>
                    <span className="inbox-who">{who?.name ?? 'Paperclip'} · {ago(a.createdAt)}</span>
                  </span>
                  <span className="inbox-title">{a.title}</span>
                </button>
                {who && (
                  <button className="inbox-find" onClick={() => pingAgent(who.id)} title={`Tìm ${who.name} trên bản đồ`} aria-label={`Tìm ${who.name} trên bản đồ`}>
                    📍
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Thẻ duyệt nhanh giữa màn hình (mở từ danh sách, không cần đi tới bàn agent). */
export function AskSheet() {
  const askId = useCoop((s) => s.askId)
  const ask = useCoop((s) => s.asks.find((a) => a.id === s.askId))
  const close = useCoop((s) => s.closeAsk)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus() }, [askId])
  if (!ask) return null
  return (
    <div className="ask-sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="ask-sheet-box" role="dialog" aria-modal="true" aria-label="Duyệt nhanh" tabIndex={-1} ref={box}>
        <div className="ask-sheet-bar">
          <span>Duyệt nhanh</span>
          <button className="term-close" onClick={close} title="Đóng"><kbd>Esc</kbd> Đóng</button>
        </div>
        <AskCard key={ask.id} ask={ask} />
      </div>
    </div>
  )
}
