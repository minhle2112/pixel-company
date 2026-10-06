import { snippet } from '../life/comments'
import { raiseHand } from '../life/director'
import { say } from '../life/store'
import { useCoop } from '../store'
import { MOCK_AGENTS, MOCK_ASKS, MOCK_ISSUES } from './mock'
import { askNotes, diffNotes, newAsks } from './notify'
import { classifyEvent, paperclip, setCompanyId, type PcLiveEvent, type Snapshot } from './paperclip'
import type { Ask, ChatInfo, Company } from './types'

/** Ai cần nghe sự kiện realtime thô (vd. ô chat đọc lại tin mới ngay). */
export const liveListeners = new Set<(e: PcLiveEvent) => void>()

/**
 * Agent vừa trả lời chat xong (cuộc trò chuyện từ "đang trả lời" về "chờ bạn"): báo một dòng và cho agent
 * nói câu đầu của câu trả lời trong bong bóng, để bạn thấy dù đang ở chỗ khác trong văn phòng.
 */
function announceReplies(prev: ChatInfo[], next: ChatInfo[]) {
  const before = new Map(prev.map((c) => [c.issueId, c]))
  for (const c of next) {
    if (before.get(c.issueId)?.state !== 'active' || c.state !== 'waiting') continue
    const name = useCoop.getState().agents.find((a) => a.id === c.agentId)?.name ?? 'Agent'
    useCoop.getState().pushNotes([{ kind: 'done', text: `${name} đã trả lời bạn trong chat` }])
    paperclip
      .chatMessages(c.issueId)
      .then((list) => {
        const last = [...list].reverse().find((m) => m.from === 'agent')
        if (last) say(c.agentId, snippet(last.body, 90), { real: true, sec: 8 })
      })
      .catch(() => {})
  }
}

const POLL_MS = 30_000
const DEBOUNCE_MS = 350
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 15_000]

const COMPANY_KEY = 'coopverse.company.v1'

/**
 * Chọn công ty để mở: `?company=<id>` trên URL → công ty xem lần trước → VITE_COMPANY_ID → công ty đầu tiên.
 */
function pickCompany(list: Company[]): Company | null {
  let saved: string | null = null
  try { saved = localStorage.getItem(COMPANY_KEY) } catch { /* bỏ qua */ }
  const wanted = [new URLSearchParams(location.search).get('company'), saved, import.meta.env.VITE_COMPANY_ID]
  for (const id of wanted) {
    const c = id && list.find((x) => x.id === id)
    if (c) return c
  }
  return list[0] ?? null
}

/** Đổi sang công ty khác: nhớ lựa chọn rồi tải lại trang (mọi trạng thái bắt đầu lại sạch). */
export function switchCompany(id: string) {
  try { localStorage.setItem(COMPANY_KEY, id) } catch { /* bỏ qua */ }
  const url = new URL(location.href)
  url.searchParams.delete('company')
  location.replace(url.toString())
}

/** Đọc lại dữ liệu Paperclip sớm (vd ngay sau khi bạn duyệt một phiếu). Không làm gì ở bản demo. */
export let requestRefresh: () => void = () => {}

/** Việc chờ mới: báo một dòng, agent gửi giơ tay gọi bạn. */
function announceAsks(prev: Ask[], next: Ask[]) {
  const fresh = newAsks(prev, next)
  if (!fresh.length) return
  useCoop.getState().pushNotes(askNotes(fresh, useCoop.getState().agents))
  for (const a of fresh) if (a.agentId) raiseHand(a.agentId, a.kind)
}

/** Dev: bơm sự kiện giả vào luồng realtime để kiểm tra (window.__coop.inject). */
export let injectLiveEvent: ((e: PcLiveEvent, opts?: { noRefresh?: boolean }) => void) | null = null

/**
 * Đồng bộ Pixel Company với Paperclip: đọc một lượt đầy đủ, rồi nghe WebSocket để biết khi nào cần đọc lại.
 * `agent.status` được áp ngay (không chờ HTTP) cho cảm giác tức thì. Có poll 30 s phòng khi lỡ sự kiện.
 * URL có `?demo` thì dùng dữ liệu giả, không gọi Paperclip.
 */
export function startSync(): () => void {
  const store = useCoop.getState
  if (new URLSearchParams(location.search).has('demo')) {
    store().setSnapshot(MOCK_AGENTS, MOCK_ISSUES, [], MOCK_ASKS)
    store().setConn('demo')
    return () => {}
  }

  let stopped = false
  let wsOpen = false
  let attempt = 0
  let snap: Snapshot | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let closeWs: (() => void) | null = null
  /**
   * Thế hệ dữ liệu: tăng mỗi lần bắt đầu đọc hoặc nhận sự kiện. Lượt đọc nào về trễ (đã có dữ liệu mới hơn)
   * thì bỏ, để không ghi đè trạng thái mới bằng trạng thái cũ (gây thông báo và "ting" lặp).
   */
  let gen = 0

  const apply = (next: Snapshot) => {
    const s = store()
    // Không đọc được hộp thư việc chờ lần này: giữ danh sách đang có
    const asks = next.asks ?? snap?.asks ?? null
    if (snap) {
      s.pushNotes(diffNotes(snap.agents, next.agents, snap.issues, next.issues))
      announceReplies(snap.chats, next.chats)
      // Lần đọc đầu tiên không báo: việc chờ có sẵn từ trước, không phải "mới"
      if (asks && snap.asks) announceAsks(snap.asks, asks)
    }
    snap = { ...next, asks }
    s.setSnapshot(next.agents, next.issues, next.chats, asks ?? undefined)
  }

  async function refresh() {
    const mine = ++gen
    try {
      const next = await paperclip.snapshot()
      if (stopped || mine !== gen) return
      apply(next)
      if (wsOpen) store().setConn('live')
    } catch {
      if (!stopped && mine === gen && store().conn !== 'offline') store().setConn('offline', Date.now() + POLL_MS)
    }
  }

  const schedule = (ms = DEBOUNCE_MS) => {
    clearTimeout(debounce)
    debounce = setTimeout(refresh, ms)
  }

  const onEvent = (e: PcLiveEvent, opts?: { noRefresh?: boolean }) => {
    for (const l of liveListeners) l(e)
    const c = classifyEvent(e)
    if (c.kind === 'ignore') return
    if (c.kind === 'agent-status' && snap) {
      gen++
      apply({ ...snap, agents: snap.agents.map((a) => (a.id === c.agentId ? { ...a, status: c.status, candidate: c.candidate || (c.status === 'terminated' && a.candidate) || undefined } : a)) })
    }
    if (!opts?.noRefresh) schedule()
  }
  if (import.meta.env.DEV) injectLiveEvent = onEvent
  requestRefresh = () => schedule(0)

  function connect() {
    if (stopped) return
    closeWs = paperclip.openEvents({
      onOpen: () => {
        attempt = 0
        wsOpen = true
        paperclip.health().then((h) => store().setVersion(h.version)).catch(() => {})
        schedule(0)
      },
      onEvent,
      onClose: () => {
        wsOpen = false
        closeWs = null
        if (stopped) return
        const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
        store().setConn('offline', Date.now() + wait)
        reconnect = setTimeout(connect, wait)
      },
    })
  }

  // Đọc danh sách công ty trước; chưa đọc được (Paperclip tắt) thì thử lại, chưa có công ty nào thì chờ
  let init: ReturnType<typeof setTimeout> | undefined
  async function start() {
    if (stopped) return
    let list: Company[]
    try {
      list = await paperclip.companies()
    } catch {
      if (stopped) return
      const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
      store().setConn('offline', Date.now() + wait)
      init = setTimeout(start, wait)
      return
    }
    if (stopped) return
    attempt = 0
    const company = pickCompany(list)
    store().setCompanies(list, company)
    if (!company) {
      store().setSnapshot([], [])
      store().setConn('live')
      init = setTimeout(start, POLL_MS)
      return
    }
    setCompanyId(company.id)
    connect()
  }

  start()
  const poll = setInterval(() => { if (wsOpen) schedule(0) }, POLL_MS)

  return () => {
    stopped = true
    clearTimeout(debounce)
    clearTimeout(reconnect)
    clearTimeout(init)
    clearInterval(poll)
    closeWs?.()
    injectLiveEvent = null
    requestRefresh = () => {}
  }
}
