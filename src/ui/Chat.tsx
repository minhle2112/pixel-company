import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { unlockAudio, uiTick } from '../audio/engine'
import { useChat } from '../data/chat'
import { chatUrl } from '../data/paperclip'
import type { Agent } from '../data/types'
import { snippet } from '../life/comments'
import { say } from '../life/store'
import { useCoop } from '../store'
import { AskCard } from './AskCard'
import { Md } from './Md'

/** Đã đồng ý "mỗi tin đánh thức agent" một lần thì không hỏi lại */
const OK_KEY = 'coopverse.chat.ok.v1'
const readOk = () => { try { return localStorage.getItem(OK_KEY) === '1' } catch { return false } }
const saveOk = () => { try { localStorage.setItem(OK_KEY, '1') } catch { /* bỏ qua */ } }

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Ô chat với một agent (Agent Chat của Paperclip): gõ tiếng Việt.
 * Mic (nói → chữ) và đọc to câu trả lời đang tạm tắt: trên một số máy Chrome không nhận
 * giọng được (máy chủ Google lỗi "network", gói tiếng Việt trên máy tải mãi không xong). Code cũ nằm ở src/audio/voice.ts trên nhánh main.
 * Mỗi tin gửi đi đánh thức agent chạy một lượt để trả lời.
 */
export function ChatPane({ agent }: { agent: Agent }) {
  const demo = useCoop((s) => s.conn === 'demo')
  const prefix = useCoop((s) => s.company?.prefix ?? '')
  const storeAsks = useCoop((s) => s.asks)
  const { view, send } = useChat(agent.id, (m) => {
    // Bản thật: sync.ts đã cho agent nói câu đầu trong bong bóng
    if (demo) say(agent.id, snippet(m.body, 90), { real: true, sec: 8 })
  })

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Esc trong hộp xác nhận chỉ đóng hộp, không thoát màn hình agent (chạy trước listener của useControls)
  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return
      e.stopImmediatePropagation()
      setConfirm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm])

  // Mở xong (ô gõ hết bị khoá) thì đặt con trỏ vào ô gõ
  useEffect(() => { if (view.state === 'ready') box.current?.focus() }, [view.state])

  // ── Tự cuộn xuống tin mới nhất, trừ khi đang cuộn lên đọc ──
  const list = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  useLayoutEffect(() => {
    if (follow && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [view.messages, view.replying, view.asks, follow])
  const onScroll = () => {
    const el = list.current!
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  async function doSend(text: string) {
    setBusy(true)
    setConfirm(null)
    const ok = await send(text)
    setBusy(false)
    if (ok) {
      setDraft('')
      setFollow(true)
      uiTick()
    }
    box.current?.focus()
  }

  function submit(text = draft) {
    const body = text.trim()
    if (!body || busy) return
    unlockAudio()
    if (!demo && !readOk()) return setConfirm(body)
    void doSend(body)
  }

  if (view.state === 'disabled') {
    return (
      <div className="chat">
        <div className="chat-list">
          <div className="t-empty">
            Agent Chat đang tắt trong Paperclip.<br />
            Bật lại trong Paperclip: Instance settings → Experimental → Agent Chat.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat">
      <div className="chat-list" ref={list} onScroll={onScroll} aria-live="polite">
        {view.state === 'loading' && <div className="t-empty">Đang mở cuộc trò chuyện…</div>}
        {view.state === 'error' && <div className="t-empty t-errbox">Không mở được cuộc trò chuyện: {view.error}</div>}
        {view.state === 'ready' && !view.messages.length && (
          <div className="chat-intro">
            <b>Nhắn cho {agent.name} bằng tiếng Việt</b>
            <p>
              Gõ vào ô bên dưới rồi Enter. Mỗi tin nhắn đánh thức {agent.name} chạy một lượt để trả lời:
              mất khoảng 20 giây đến vài phút và tốn hạn mức Claude như khi giao một việc nhỏ.
            </p>
            <p className="muted">Gõ <code>/new</code> để bắt đầu phiên mới (agent quên ngữ cảnh cũ). Lịch sử chat lưu trong Paperclip.</p>
          </div>
        )}
        {view.messages.map((m) =>
          m.from === 'system' ? (
            <div key={m.id} className="chat-sys"><span>{m.body} · {time(m.createdAt)}</span></div>
          ) : (
            <div key={m.id} className={`chat-msg ${m.from}${m.sending ? ' sending' : ''}`}>
              <div className="chat-bubble">
                {m.from === 'agent' ? <Md text={m.body} /> : <div className="chat-text">{m.body}</div>}
              </div>
              <div className="chat-meta">
                {m.from === 'agent' ? agent.name : 'Bạn'} · {m.sending ? 'đang gửi…' : time(m.createdAt)}
              </div>
            </div>
          ),
        )}
        {view.asks.map((a) => {
          // Câu hỏi đã có trong danh sách việc chờ: trả lời ngay trong khung chat
          const full = storeAsks.find((x) => x.id === a.id)
          if (full) return <div key={a.id} className="chat-askcard"><AskCard ask={full} /></div>
          return (
          <div key={a.id} className="chat-ask">
            <b>❓ {a.title}</b>
            {a.text && <Md text={a.text} />}
            {!demo && prefix && (
              <a className="t-btn" href={chatUrl(prefix, agent.id)} target="_blank" rel="noreferrer">Trả lời trong Paperclip ↗</a>
            )}
          </div>
          )
        })}
        {view.replying && (
          <div className="chat-typing">
            <span className="t-spin">✻</span> {agent.name} đang trả lời… <span className="muted">(xem agent làm gì ở tab Log)</span>
          </div>
        )}
        {view.stalled && (
          <div className="chat-warn">
            {agent.name} chưa chạy để trả lời. Có thể agent đang tạm dừng, gặp lỗi hoặc hết hạn mức. Xem tab Log hoặc mở Paperclip.
          </div>
        )}
      </div>
      {!follow && <button className="t-jump" onClick={() => setFollow(true)}>↓ Mới nhất</button>}

      <div className="chat-foot">
        {view.error && <div className="chat-err">{view.error}</div>}
        <div className="chat-compose">
          <textarea
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={`Nhắn cho ${agent.name}… (Enter gửi, Shift+Enter xuống dòng)`}
            rows={2}
            disabled={busy || view.state !== 'ready'}
            aria-label={`Tin nhắn cho ${agent.name}`}
          />
          <button className="t-btn t-primary t-btn-comment chat-send" onClick={() => submit()} disabled={busy || !draft.trim() || view.state !== 'ready'}>
            {busy ? 'Đang gửi…' : 'Gửi'}
          </button>
        </div>
        <div className="chat-tools">
          <button className="t-btn chat-new" onClick={() => submit('/new')} disabled={busy || !view.messages.length || view.state !== 'ready'} title="Agent quên ngữ cảnh cũ, lịch sử vẫn giữ">
            Phiên mới
          </button>
          {!demo && prefix && (
            <a className="t-btn t-link" href={chatUrl(prefix, agent.id)} target="_blank" rel="noreferrer">Mở trong Paperclip ↗</a>
          )}
        </div>
      </div>

      {confirm && (
        <div className="t-modal">
          <div className="t-dialog" role="dialog" aria-label="Gửi tin đầu tiên">
            <div className="t-dialog-title">Nhắn tin cho agent</div>
            <p>
              Mỗi tin nhắn đánh thức {agent.name} chạy một lượt để trả lời (khoảng 20 giây đến vài phút, tốn hạn mức Claude).
              Agent trả lời như khi làm việc thật: có thể đọc file, tạo ticket nếu bạn yêu cầu.
            </p>
            <div className="t-dialog-btns">
              <button className="t-btn" onClick={() => { setConfirm(null); box.current?.focus() }}>Huỷ</button>
              <button className="t-btn t-primary t-btn-comment" onClick={() => { saveOk(); void doSend(confirm) }}>Gửi, lần sau không hỏi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
