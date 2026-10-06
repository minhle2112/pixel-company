import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { issueUrl, isRunActive, paperclip, PaperclipError, type Run } from '../data/paperclip'
import { useRunLog } from '../data/runlog'
import type { TermLine } from '../data/streamjson'
import { STATUS_COLOR, STATUS_LABEL, type Agent, type AgentStatus } from '../data/types'
import { useCoop } from '../store'
import { AskCard } from './AskCard'
import { ChatPane } from './Chat'
import { ExpBadge } from './ExpBadge'

type Act = 'wake' | 'pause' | 'resume' | 'comment'
/** ask = việc chờ bạn duyệt / trả lời (chỉ hiện khi agent có việc chờ) */
type Tab = 'chat' | 'log' | 'ask'

/** Nhớ tab xem lần trước (chat hay log) trên trình duyệt này */
const TAB_KEY = 'coopverse.termTab.v1'
const loadTab = (): Tab => { try { return localStorage.getItem(TAB_KEY) === 'log' ? 'log' : 'chat' } catch { return 'chat' } }

const RUN_LABEL: Record<string, string> = {
  queued: 'Đang xếp hàng',
  running: 'Đang chạy',
  succeeded: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã huỷ',
  timed_out: 'Quá giờ',
}

/** Lệnh nào hợp với trạng thái nào */
const ACTS: Record<AgentStatus, Act[]> = {
  running: ['pause'],
  idle: ['wake', 'pause'],
  paused: ['resume'],
  error: ['wake', 'pause'],
  terminated: [],
}

const ACT_LABEL: Record<Act, string> = { wake: 'Đánh thức', pause: 'Tạm dừng', resume: 'Tiếp tục', comment: 'Comment' }

const GLYPH: Partial<Record<TermLine['kind'], string>> = {
  text: '●', tool: '●', out: '⎿', outErr: '⎿', think: '✻', prompt: '›', done: '✔', fail: '✖', err: '!', meta: '─',
}

function clock(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

function elapsed(from: string | null, now: number) {
  if (!from) return ''
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function RunInfo({ run, state }: { run: Run | null; state: string }) {
  const active = !!run && isRunActive(run.status)
  const now = useNow(active)
  if (state === 'loading') return <span className="t-run">Đang mở log…</span>
  if (!run) return <span className="t-run">Chưa có lượt chạy nào</span>
  return (
    <span className={`t-run${active ? ' live' : ''}`}>
      {active ? `● ${RUN_LABEL[run.status] ?? run.status} · ${elapsed(run.startedAt, now)}` : `Lần chạy gần nhất · ${RUN_LABEL[run.status] ?? run.status} · ${clock(run.finishedAt ?? run.startedAt)}`}
    </span>
  )
}

function Line({ l }: { l: TermLine }) {
  return (
    <div className={`t-line t-${l.kind}`}>
      <span className="t-glyph">{GLYPH[l.kind] ?? ' '}</span>
      <span className="t-body">
        {l.label && <b className="t-name">{l.label}</b>}
        {l.label ? (l.text ? `(${l.text})` : '') : l.text}
      </span>
    </div>
  )
}

/** Màn hình CLI của một agent: log run trực tiếp + lệnh nhẹ. Lệnh nào cũng hỏi xác nhận trước. */
export function Terminal({ agent }: { agent: Agent }) {
  const view = useRunLog(agent.id)
  const issues = useCoop((s) => s.issues)
  const demo = useCoop((s) => s.conn === 'demo')
  const closeFocus = useCoop((s) => s.closeFocus)
  const pushNotes = useCoop((s) => s.pushNotes)

  const issueId = agent.issueId ?? view.run?.issueId ?? null
  const issue = issues.find((i) => i.id === issueId)
  const active = !!view.run && isRunActive(view.run.status)

  const asks = useCoop((s) => s.asks)
  const mine = asks.filter((a) => a.agentId === agent.id)
  // Agent đang giơ tay thì mở thẳng tab Duyệt
  const [tab, setTabState] = useState<Tab>(() => (mine.length ? 'ask' : loadTab()))
  const setTab = (t: Tab) => {
    setTabState(t)
    // Tab Duyệt chỉ có lúc có việc chờ, không nhớ làm tab mặc định
    if (t !== 'ask') try { localStorage.setItem(TAB_KEY, t) } catch { /* bỏ qua */ }
  }
  const chatting = useCoop((s) => s.chats.find((c) => c.agentId === agent.id)?.state === 'active')
  const [ask, setAsk] = useState<Act | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // ── Tự cuộn xuống cuối, trừ khi bạn đang cuộn lên đọc ──
  const body = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  useLayoutEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [view.lines, follow])
  const onScroll = () => {
    const el = body.current!
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  // Esc / E trong hộp xác nhận chỉ đóng hộp, không thoát CLI (chạy trước listener của useControls)
  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' && e.code !== 'KeyE') return
      const typing = e.target instanceof HTMLTextAreaElement
      if (e.code === 'KeyE' && typing) return
      e.stopImmediatePropagation()
      if (e.code === 'Escape' && !busy) setAsk(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ask, busy])

  const acts: Act[] = [...ACTS[agent.status], ...(issue ? (['comment'] as Act[]) : [])]

  function open(a: Act) {
    setErr(null)
    setAsk(a)
  }

  async function run(a: Act) {
    setBusy(true)
    setErr(null)
    try {
      if (demo) {
        const next: Partial<Record<Act, AgentStatus>> = { wake: 'running', pause: 'paused', resume: 'idle' }
        const st = next[a]
        if (st) useCoop.setState((s) => ({ agents: s.agents.map((x) => (x.id === agent.id ? { ...x, status: st } : x)) }))
      } else if (a === 'wake') await paperclip.wake(agent.id)
      else if (a === 'pause') await paperclip.pause(agent.id)
      else if (a === 'resume') await paperclip.resume(agent.id)
      else if (a === 'comment' && issue) await paperclip.comment(issue.id, draft.trim())
      const done: Record<Act, string> = {
        wake: `Đã đánh thức ${agent.name}`,
        pause: `Đã tạm dừng ${agent.name}`,
        resume: `${agent.name} làm việc trở lại`,
        comment: `Đã gửi comment vào ${issue?.key ?? 'ticket'}`,
      }
      pushNotes([{ kind: 'info', text: `${done[a]}${demo ? ' (demo)' : ''}` }])
      if (a === 'comment') setDraft('')
      setAsk(null)
    } catch (e) {
      const msg = e instanceof PaperclipError ? e.message : String(e)
      setErr(`Không gửi được lệnh: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  const confirmText: Record<Act, { title: string; body: string; ok: string }> = {
    wake: {
      title: `Đánh thức ${agent.name}?`,
      body: 'Agent bắt đầu một lượt chạy mới ngay: xem việc được giao rồi làm tiếp. Lượt chạy tốn token.',
      ok: 'Đánh thức',
    },
    pause: {
      title: `Tạm dừng ${agent.name}?`,
      body: active
        ? 'Lượt chạy đang dở sẽ bị huỷ ngay. Agent không nhận việc mới cho tới khi bạn bấm Tiếp tục.'
        : 'Agent không nhận việc mới cho tới khi bạn bấm Tiếp tục.',
      ok: 'Tạm dừng',
    },
    resume: {
      title: `Cho ${agent.name} làm tiếp?`,
      body: 'Agent nhận việc trở lại. Nếu có việc đang chờ, agent có thể chạy ngay.',
      ok: 'Tiếp tục',
    },
    comment: {
      title: `Comment vào ${issue?.key ?? 'ticket'}`,
      body: 'Comment hiện trong ticket dưới tên bạn (board). Paperclip có thể đánh thức agent được giao ticket để đọc comment.',
      ok: 'Gửi comment',
    },
  }

  const c = ask ? confirmText[ask] : null

  return (
    <div className="term-wrap">
      <div className="term">
        <div className="term-bar">
          <span className="term-dots"><i /><i /><i /></span>
          <span className="term-title">
            <span className="np-dot" style={{ background: STATUS_COLOR[agent.status] }} />
            {agent.name} <ExpBadge agentId={agent.id} /> <span className="muted">· {agent.title} · {STATUS_LABEL[agent.status]}</span>
          </span>
          <div className="term-tabs" role="tablist" aria-label="Xem">
            {(mine.length > 0 || tab === 'ask') && (
              <button role="tab" aria-selected={tab === 'ask'} className={`tab-ask${tab === 'ask' ? ' on' : ''}`} onClick={() => setTab('ask')}>
                Duyệt{mine.length > 0 && <span className="tab-count">{mine.length}</span>}
              </button>
            )}
            <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
              Chat{chatting && <i className="tab-dot" title="Đang trả lời" />}
            </button>
            <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
              Log{active && <i className="tab-dot" title="Đang chạy" />}
            </button>
          </div>
          <button className="term-close" onClick={closeFocus} title="Quay lại văn phòng">
            <kbd>Esc</kbd> Đóng
          </button>
        </div>

        {tab === 'ask' ? (
          <div className="ask-pane">
            {mine.length ? (
              mine.map((a) => <AskCard key={a.id} ask={a} />)
            ) : (
              <div className="t-empty">Xong hết rồi! {agent.name} không còn việc nào chờ bạn.</div>
            )}
          </div>
        ) : tab === 'chat' ? <ChatPane agent={agent} /> : <>
        <div className="term-sub">
          <span className="t-issue">{issue ? `${issue.key} · ${issue.title}` : agent.task ?? agent.reason ?? 'Không gắn ticket'}</span>
          <RunInfo run={view.run} state={view.state} />
        </div>

        <div className="term-body" ref={body} onScroll={onScroll}>
          {view.state === 'none' && <div className="t-empty">{agent.name} chưa có lượt chạy nào. Bấm Đánh thức để bắt đầu.</div>}
          {view.state === 'error' && <div className="t-empty t-errbox">Không đọc được log: {view.error}</div>}
          {view.lines.map((l) => <Line key={l.id} l={l} />)}
          {active && (
            <div className="t-line t-working">
              <span className="t-glyph t-spin">✻</span>
              <span className="t-body">Đang làm…</span>
            </div>
          )}
        </div>
        {!follow && (
          <button className="t-jump" onClick={() => setFollow(true)}>↓ Mới nhất</button>
        )}

        <div className="term-foot">
          {acts.map((a) => (
            <button key={a} className={`t-btn t-btn-${a}`} onClick={() => open(a)} disabled={busy}>
              {ACT_LABEL[a]}
            </button>
          ))}
          {issue && !demo && (
            <a className="t-btn t-link" href={issueUrl(issue.key)} target="_blank" rel="noreferrer">
              Mở {issue.key} trong Paperclip ↗
            </a>
          )}
          <span className="t-hint">Lệnh nào cũng hỏi lại trước khi gửi</span>
        </div>
        </>}


        {tab === 'log' && c && ask && (
          <div className="t-modal">
            <div className="t-dialog" role="dialog" aria-label={c.title}>
              <div className="t-dialog-title">{c.title}</div>
              <p>{c.body}</p>
              {ask === 'comment' && (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Viết comment…"
                  rows={5}
                  disabled={busy}
                />
              )}
              {err && <div className="t-dialog-err">{err}</div>}
              <div className="t-dialog-btns">
                <button className="t-btn" onClick={() => setAsk(null)} disabled={busy}>Huỷ</button>
                <button
                  className={`t-btn t-primary t-btn-${ask}`}
                  onClick={() => run(ask)}
                  disabled={busy || (ask === 'comment' && !draft.trim())}
                >
                  {busy ? 'Đang gửi…' : c.ok}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
