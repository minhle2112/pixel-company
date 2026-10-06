import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uiTick, unlockAudio } from '../audio/engine'
import {
  decideProposal, loginClaude, markRead, resetAssistant, sendAssistant, stopAssistant, useAssistant,
  type AsMsg, type AsPart, type AsProposal,
} from '../data/assistant'
import { desktop } from '../desktop'
import { ASSISTANT_MODELS, useSettings } from '../settings'
import { useCoop } from '../store'
import { Md } from './Md'

/** Tên công cụ → việc Trợ lý đang làm (hiện trong khung chat) */
const TOOL_LABEL: Record<string, string> = {
  Read: 'Đọc', Glob: 'Tìm file', Grep: 'Tìm trong code',
  memory_read: 'Đọc bộ nhớ', memory_write: 'Ghi nhớ',
  company_overview: 'Xem tổng quan công ty', list_issues: 'Xem ticket', get_issue: 'Đọc ticket',
  agent_detail: 'Xem hồ sơ agent', recent_runs: 'Xem các lượt chạy',
  list_skills: 'Xem skill', list_connectors: 'Xem connector', list_routines: 'Xem việc định kỳ', list_secrets: 'Xem bí mật đã lưu',
  budget_overview: 'Xem hạn mức', list_models: 'Xem model',
  propose_create_project: 'Đề xuất tạo project', propose_hire_agent: 'Đề xuất thuê agent', propose_update_agent: 'Đề xuất sửa agent',
  propose_edit_agent_instructions: 'Đề xuất sửa AGENTS.md', propose_create_issues: 'Đề xuất tạo ticket', propose_update_issue: 'Đề xuất sửa ticket',
  propose_install_skill: 'Đề xuất cài skill', propose_agent_skills: 'Đề xuất gắn skill', propose_connect_app: 'Đề xuất kết nối app',
  propose_create_routine: 'Đề xuất việc định kỳ', propose_update_routine: 'Đề xuất sửa việc định kỳ', propose_set_budget: 'Đề xuất hạn mức',
  propose_add_secret: 'Đề xuất lưu bí mật', propose_update_company: 'Đề xuất sửa công ty',
}

/** Đường dẫn dài: chỉ giữ 2 phần cuối */
const shortPath = (s: string) => {
  const p = s.split(/[\\/]/).filter(Boolean)
  return p.length > 2 ? `…/${p.slice(-2).join('/')}` : s
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

const SUGGEST = ['Công ty mình đang có những gì?', 'Giúp mình bắt đầu một dự án mới', 'Đội đang làm tới đâu rồi?']

function ToolLine({ p, live }: { p: Extract<AsPart, { k: 'tool' }>; live: boolean }) {
  const label = TOOL_LABEL[p.name] ?? p.name
  const arg = p.arg ? (p.name === 'Read' || p.name === 'Glob' ? shortPath(p.arg) : p.arg) : ''
  const state = p.err ? 'err' : p.done ? 'done' : live ? 'run' : 'done'
  return (
    <div className={`as-tool ${state}`} title={p.arg}>
      <span className="as-tool-ic">{state === 'run' ? <span className="t-spin">✻</span> : state === 'err' ? '✕' : '✓'}</span>
      <span>{label}</span>
      {arg && <span className="as-tool-arg">{arg}</span>}
    </div>
  )
}

const STATUS_TEXT: Record<AsProposal['status'], string> = {
  pending: 'Chờ bạn duyệt', running: 'Đang làm…', waiting: 'Chờ bạn đăng nhập', done: 'Đã làm', rejected: 'Đã bỏ', failed: 'Không làm được',
}

const KIND_ICON: Record<string, string> = {
  create_project: '📁', hire_agent: '🧑‍💼', update_agent: '🧑‍💼', edit_instructions: '📝', create_issues: '🎫', update_issue: '🎫',
  install_skill: '🧩', agent_skills: '🧩', connect_app: '🔌', create_routine: '⏰', update_routine: '⏰',
  set_budget: '💰', add_secret: '🔑', update_company: '🏢',
}

const openLink = (url: string) => {
  if (desktop?.openExternal) void desktop.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

function ProposalCard({ p }: { p: AsProposal }) {
  const [busy, setBusy] = useState(false)
  // Giá trị ô bảo mật chỉ nằm ở đây cho tới lúc bấm Duyệt (không vào store, không lưu)
  const [values, setValues] = useState<Record<string, string>>({})
  const fields = p.fields ?? []
  const missing = fields.some((f) => !f.optional && !values[f.key]?.trim())
  const decide = async (verb: 'approve' | 'reject' | 'continue') => {
    unlockAudio()
    setBusy(true)
    const ok = await decideProposal(p.id, verb, verb === 'approve' && fields.length ? { values } : {})
    if (ok) setValues({})
    setBusy(false)
    uiTick()
  }
  return (
    <div className={`as-card ${p.status}`}>
      <div className="as-card-head">
        <b>{KIND_ICON[p.kind] ? `${KIND_ICON[p.kind]} ` : ''}{p.title}</b>
        <span className="as-card-st">{STATUS_TEXT[p.status] ?? p.status}</span>
      </div>
      <ul>{p.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {p.detail && (
        <details className="as-card-detail">
          <summary>Xem chi tiết</summary>
          <pre>{p.detail}</pre>
        </details>
      )}
      {p.status === 'pending' && fields.length > 0 && (
        <form className="as-card-fields" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (!missing && !busy) void decide('approve') }}>
          {fields.map((f) => (
            <label key={f.key}>
              <span>{f.label}{f.optional ? ' (không bắt buộc)' : ''}</span>
              <input
                type={f.secret ? 'password' : 'text'} value={values[f.key] ?? ''} placeholder={f.placeholder}
                autoComplete={f.secret ? 'new-password' : 'off'} spellCheck={false}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <div className="muted">🔒 Gửi thẳng vào kho bí mật của công ty. Lễ tân không thấy, Pixel Company không lưu.</div>
        </form>
      )}
      {p.result && <div className="as-card-result">{p.result}</div>}
      {p.status === 'pending' && (
        <div className="as-card-btns">
          <button className="t-btn" disabled={busy} onClick={() => void decide('reject')}>Bỏ</button>
          <button className="t-btn t-primary t-btn-comment" disabled={busy || missing} onClick={() => void decide('approve')}
            title={missing ? 'Nhập đủ các ô trước' : undefined}>Duyệt</button>
        </div>
      )}
      {p.status === 'waiting' && (
        <div className="as-card-btns">
          <button className="t-btn" disabled={busy} onClick={() => void decide('reject')}>Bỏ</button>
          {p.link && <button className="t-btn" onClick={() => openLink(p.link!)}>Mở trang đăng nhập ↗</button>}
          <button className="t-btn t-primary t-btn-comment" disabled={busy} onClick={() => void decide('continue')}>Xong rồi</button>
        </div>
      )}
    </div>
  )
}

function Message({ m, proposals }: { m: AsMsg; proposals: Record<string, AsProposal> }) {
  if (m.role === 'user') {
    const text = m.parts.map((p) => (p.k === 'text' ? p.text : '')).join('')
    return (
      <div className="chat-msg me">
        <div className="chat-bubble"><div className="chat-text">{text}</div></div>
        <div className="chat-meta">Bạn · {time(m.at)}</div>
      </div>
    )
  }
  if (m.role === 'system') {
    const text = m.parts.map((p) => (p.k === 'text' ? p.text : '')).join('')
    return (
      <>
        {text && <div className="chat-sys"><span>{text}</span></div>}
        {m.error && <ErrorBox m={m} />}
      </>
    )
  }
  const live = !!m.live
  return (
    <div className="as-turn">
      {m.parts.map((p, i) =>
        p.k === 'text' ? (
          p.text.trim() ? <div key={i} className="chat-msg agent"><div className="chat-bubble"><Md text={p.text} /></div></div> : null
        ) : p.k === 'tool' ? (
          <ToolLine key={p.id} p={p} live={live} />
        ) : proposals[p.id] ? (
          <ProposalCard key={p.id} p={proposals[p.id]} />
        ) : null,
      )}
      {live && <div className="chat-typing"><span className="t-spin">✻</span> Lễ tân đang {m.parts.length ? 'làm' : 'nghĩ'}…</div>}
      {m.error && <ErrorBox m={m} />}
      {!live && <div className="chat-meta">Lễ tân · {time(m.at)}</div>}
    </div>
  )
}

function ErrorBox({ m }: { m: AsMsg }) {
  return (
    <div className="chat-warn">
      {m.error}
      {m.needLogin && (
        <div className="as-err-btns">
          <button className="t-btn" onClick={() => void loginClaude()}>Đăng nhập Claude</button>
        </div>
      )}
    </div>
  )
}

/** Ô nhập đường dẫn (chạy bằng trình duyệt, không có hộp chọn thư mục của Windows) */
function FolderInput({ onPick, onCancel }: { onPick: (dir: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('')
  return (
    <div className="as-folder">
      <input
        autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="Đường dẫn thư mục, vd C:\Users\ban\du-an"
        onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) onPick(v.trim()) }}
        aria-label="Đường dẫn thư mục"
      />
      <button className="t-btn" onClick={onCancel}>Huỷ</button>
      <button className="t-btn t-primary t-btn-comment" disabled={!v.trim()} onClick={() => onPick(v.trim())}>Dùng</button>
    </div>
  )
}

/** Khung chat với Trợ lý (lễ tân) bên phải màn hình. Mở bằng phím L, phím E cạnh quầy lễ tân hoặc bấm vào lễ tân. */
export function AssistantPanel() {
  const close = useCoop((s) => s.toggleAssistant)
  const company = useCoop((s) => s.company)
  const demo = useCoop((s) => s.conn === 'demo')
  const { messages, proposals, busy, brain, conn, error } = useAssistant()
  const model = useSettings((s) => s.assistantModel)
  const setSettings = useSettings((s) => s.set)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [typingPath, setTypingPath] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { markRead() }, [messages])
  useEffect(() => { box.current?.focus() }, [])

  // Tự cuộn xuống cuối, trừ khi đang cuộn lên đọc
  const list = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  useLayoutEffect(() => {
    if (follow && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages, proposals, busy, follow])
  const onScroll = () => {
    const el = list.current!
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  const ready = conn === 'live' && !busy && !sending && brain.ok

  async function send(text: string, folder?: string) {
    if (!text.trim() && !folder) return
    unlockAudio()
    setSending(true)
    const ok = await sendAssistant(text.trim(), { model: model || undefined, folder })
    setSending(false)
    if (ok) {
      setDraft('')
      setFollow(true)
      uiTick()
    }
    box.current?.focus()
  }

  async function pickFolder() {
    if (desktop?.pickWorkFolder) {
      const dir = await desktop.pickWorkFolder()
      if (dir) void send('', dir)
    } else setTypingPath(true)
  }

  const empty = !messages.length
  return (
    <section className="panel as-panel" aria-label="Trợ lý">
      <div className="as-head">
        <span className="as-title">🛎️ Lễ tân</span>
        <span className="as-sub">{company?.name ?? (demo ? 'Bản demo' : '')}</span>
        <select
          className="as-model" value={model} onChange={(e) => setSettings({ assistantModel: e.target.value })}
          title="Model của Trợ lý (tốn hạn mức Claude của máy này)" aria-label="Model của Trợ lý"
        >
          {ASSISTANT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button className="as-icon" onClick={() => void resetAssistant()} disabled={busy || empty} title="Cuộc trò chuyện mới (Trợ lý vẫn nhớ những gì đã ghi vào bộ nhớ)">↺</button>
        <button className="as-icon" onClick={close} title="Đóng (Esc hoặc L)" aria-label="Đóng">✕</button>
      </div>

      <div className="chat-list as-list" ref={list} onScroll={onScroll} aria-live="polite">
        {!brain.ok && <div className="chat-warn">{brain.error}</div>}
        {conn === 'error' && <div className="chat-warn">Mất kết nối với server Pixel Company, đang thử lại…</div>}
        {!company && !demo && <div className="t-empty">Chưa có công ty nào trên Paperclip.</div>}
        {empty && (company || demo) && (
          <div className="chat-intro as-intro">
            <b>Chào bạn, mình là lễ tân của văn phòng 👋</b>
            <p>Mình giúp bạn bắt đầu dự án, hiểu đội đang làm gì và sắp xếp công việc. Mọi thay đổi mình chỉ đề xuất, bạn bấm <b>Duyệt</b> mới làm.</p>
            <p>Bắt đầu bằng cách chọn thư mục bạn muốn làm việc:</p>
            <button className="t-btn t-primary t-btn-comment" onClick={() => void pickFolder()} disabled={!ready}>📁 Chọn thư mục</button>
            <div className="as-suggest">
              {SUGGEST.map((s) => <button key={s} className="t-btn" disabled={!ready} onClick={() => void send(s)}>{s}</button>)}
            </div>
            <p className="muted">Trò chuyện với lễ tân dùng Claude Code đã đăng nhập trên máy này (tốn hạn mức như khi bạn chat với Claude).</p>
          </div>
        )}
        {messages.map((m) => <Message key={m.id} m={m} proposals={proposals} />)}
      </div>
      {!follow && <button className="t-jump" onClick={() => setFollow(true)}>↓ Mới nhất</button>}

      <div className="chat-foot">
        {error && <div className="chat-err">{error}</div>}
        {typingPath && (
          <FolderInput onCancel={() => setTypingPath(false)} onPick={(dir) => { setTypingPath(false); void send('', dir) }} />
        )}
        <div className="chat-compose">
          <textarea
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (ready) void send(draft)
              }
            }}
            placeholder="Nhắn cho lễ tân… (Enter gửi, Shift+Enter xuống dòng)"
            rows={2}
            disabled={conn !== 'live' || !brain.ok}
            aria-label="Tin nhắn cho lễ tân"
          />
          {busy ? (
            <button className="t-btn chat-send" onClick={() => void stopAssistant()}>Dừng</button>
          ) : (
            <button className="t-btn t-primary t-btn-comment chat-send" onClick={() => void send(draft)} disabled={!ready || !draft.trim()}>
              {sending ? 'Đang gửi…' : 'Gửi'}
            </button>
          )}
        </div>
        <div className="chat-tools">
          <button className="t-btn" onClick={() => void pickFolder()} disabled={!ready} title="Cho lễ tân xem một thư mục trên máy (để lập project)">📁 Thư mục</button>
        </div>
      </div>
    </section>
  )
}
