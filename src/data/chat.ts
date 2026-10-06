import { useCallback, useEffect, useRef, useState } from 'react'
import { useCoop } from '../store'
import { paperclip, PaperclipError, type PcLiveEvent } from './paperclip'
import { liveListeners } from './sync'
import type { ChatAsk, ChatInfo, ChatMessage } from './types'

/** Đang chờ agent trả lời thì đọc lại thường xuyên; rảnh thì thưa (đã có WebSocket báo khi có tin mới). */
const FAST_MS = 2000
const SLOW_MS = 12_000
/** Gửi xong mà quá lâu agent vẫn chưa chạy thì báo có thể bị kẹt */
const STALL_MS = 45_000

export interface ChatView {
  state: 'loading' | 'disabled' | 'ready' | 'error'
  chat: ChatInfo | null
  messages: ChatMessage[]
  asks: ChatAsk[]
  /** Agent đang soạn câu trả lời */
  replying: boolean
  /** Đã gửi nhưng agent không chạy: có thể bị tạm dừng / lỗi / hết hạn mức */
  stalled: boolean
  error?: string
}

const errText = (e: unknown) => (e instanceof PaperclipError ? e.message : e instanceof Error ? e.message : String(e))

/**
 * Cuộc trò chuyện của bạn với một agent (Agent Chat của Paperclip).
 * `onReply` được gọi với mỗi câu trả lời MỚI của agent (không gọi cho lịch sử lúc mở) — dùng để đọc to.
 */
export function useChat(agentId: string, onReply?: (m: ChatMessage) => void) {
  const demo = useCoop((s) => s.conn === 'demo')
  const [view, setView] = useState<ChatView>({ state: 'loading', chat: null, messages: [], asks: [], replying: false, stalled: false })
  const replyRef = useRef(onReply)
  replyRef.current = onReply
  /** Hàm đọc lại, do effect bên dưới gán; gửi tin xong thì gọi ngay */
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  /** Lúc gửi tin gần nhất (ms), để biết đang chờ trả lời */
  const sentAt = useRef(0)

  // Trạng thái chat trong lượt đồng bộ chung (WebSocket + 30 s) và agent có đang chạy không
  const storeState = useCoop((s) => s.chats.find((c) => c.agentId === agentId)?.state)
  const agentRunning = useCoop((s) => s.agents.find((a) => a.id === agentId)?.status === 'running')

  useEffect(() => {
    if (demo) {
      setView((v) => ({ ...v, state: 'ready' }))
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let seen: Set<string> | null = null
    let chat: ChatInfo | null = null

    async function refresh() {
      clearTimeout(timer)
      try {
        if (!chat) chat = await paperclip.chat(agentId)
        else chat = (await paperclip.chat(agentId)) ?? chat
        const [messages, asks] = chat
          ? await Promise.all([paperclip.chatMessages(chat.issueId), paperclip.chatAsks(chat.issueId).catch(() => [])])
          : [[], []]
        if (stopped) return
        // Câu trả lời mới (không tính lịch sử lúc vừa mở)
        if (seen) for (const m of messages) if (m.from === 'agent' && !seen.has(m.id)) replyRef.current?.(m)
        seen = new Set(messages.map((m) => m.id))
        const last = messages[messages.length - 1]
        const answered = !!last && last.from !== 'me' && new Date(last.createdAt).getTime() >= sentAt.current - 2000
        if (chat?.state === 'waiting' && answered) sentAt.current = 0
        setView((v) => ({ ...v, state: 'ready', chat, messages: mergeSending(v.messages, messages), asks, error: undefined }))
      } catch (e) {
        if (stopped) return
        if (e instanceof PaperclipError && e.status === 404 && /disabled/i.test(e.message)) {
          setView((v) => ({ ...v, state: 'disabled' }))
          return
        }
        setView((v) => (v.state === 'ready' ? { ...v, error: `Không đọc được tin mới: ${errText(e)}` } : { ...v, state: 'error', error: errText(e) }))
      }
      if (!stopped) timer = setTimeout(refresh, chat?.state === 'active' || sentAt.current ? FAST_MS : SLOW_MS)
    }
    refreshRef.current = refresh

    // Tin mới trên WebSocket (Paperclip ghi "activity" cho mỗi comment / đổi trạng thái của cuộc trò chuyện)
    const onLive = (e: PcLiveEvent) => {
      if (!chat || e.type !== 'activity.logged') return
      const p = e.payload
      if (p.entityId === chat.issueId || (p.details as { issueId?: string } | undefined)?.issueId === chat.issueId) {
        clearTimeout(timer)
        timer = setTimeout(refresh, 250)
      }
    }
    liveListeners.add(onLive)

    ;(async () => {
      try {
        if (!(await paperclip.chatEnabled())) {
          if (!stopped) setView((v) => ({ ...v, state: 'disabled' }))
          return
        }
      } catch (e) {
        if (!stopped) setView((v) => ({ ...v, state: 'error', error: errText(e) }))
        return
      }
      await refresh()
    })()

    return () => {
      stopped = true
      clearTimeout(timer)
      liveListeners.delete(onLive)
    }
  }, [agentId, demo])

  /** Gửi một tin. Trả về false nếu không gửi được (giữ lại bản nháp). */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const body = text.trim()
      if (!body) return false
      const requestId = crypto.randomUUID()
      const temp: ChatMessage = { id: `tmp-${requestId}`, from: 'me', body, createdAt: new Date().toISOString(), sending: true }
      setView((v) => ({ ...v, messages: [...v.messages, temp], error: undefined }))
      sentAt.current = Date.now()
      if (demo) return demoSend(temp, setView, (m) => { sentAt.current = 0; replyRef.current?.(m) })
      try {
        let chat = view.chat
        if (!chat) {
          chat = await paperclip.openChat(agentId)
          setView((v) => ({ ...v, chat }))
        }
        await paperclip.sendChat(chat.issueId, body, requestId)
        await refreshRef.current()
        return true
      } catch (e) {
        sentAt.current = 0
        setView((v) => ({ ...v, messages: v.messages.filter((m) => m.id !== temp.id), error: `Không gửi được: ${errText(e)}` }))
        return false
      }
    },
    [agentId, demo, view.chat],
  )

  // Đang trả lời: Paperclip báo cuộc trò chuyện "active", hoặc vừa gửi mà chưa có câu trả lời
  const pending = !!sentAt.current || view.chat?.state === 'active' || storeState === 'active'
  const stalled = pending && !agentRunning && !demo && !!sentAt.current && Date.now() - sentAt.current > STALL_MS
  return { view: { ...view, replying: pending && !stalled, stalled }, send }
}

/** Giữ tin "đang gửi" cho tới khi Paperclip trả về bản đã lưu (cùng nội dung). */
function mergeSending(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const sending = prev.filter((m) => m.sending && !next.some((n) => n.from === 'me' && n.body === m.body))
  return sending.length ? [...next, ...sending] : next
}

// ───────────────────── Bản demo (?demo): trả lời giả, không gọi Paperclip ─────────────────────

const DEMO_REPLIES = [
  'Mình nhận được rồi nhé. Đây là bản demo nên chưa hỏi agent thật, nhưng khi chạy thật, câu trả lời của agent sẽ hiện ở đây.',
  'Ý hay đấy! Mình sẽ ghi lại và lên kế hoạch. Bạn muốn mình ưu tiên **bài tiếng Đức** hay **bài tiếng Anh** trước?',
  'Tóm tắt nhanh:\n\n- Đã xong 3 bài guide\n- Còn 2 bài chờ duyệt\n- Hạn mốc tiếp theo: 22/12\n\nBạn cần mình làm gì tiếp?',
]
let demoTurn = 0

function demoSend(
  temp: ChatMessage,
  setView: (f: (v: ChatView) => ChatView) => void,
  onReply: (m: ChatMessage) => void,
): Promise<boolean> {
  setTimeout(() => setView((v) => ({ ...v, messages: v.messages.map((m) => (m.id === temp.id ? { ...m, sending: false } : m)) })), 400)
  setTimeout(() => {
    const reply: ChatMessage = {
      id: `demo-${Date.now()}`,
      from: 'agent',
      body: DEMO_REPLIES[demoTurn++ % DEMO_REPLIES.length],
      createdAt: new Date().toISOString(),
    }
    setView((v) => ({ ...v, messages: [...v.messages, reply] }))
    onReply(reply)
  }, 2600)
  return Promise.resolve(true)
}
