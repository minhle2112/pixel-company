import { useEffect } from 'react'
import { create } from 'zustand'
import { useCoop } from '../store'

/**
 * Trợ lý (lễ tân) phía trang: nối SSE `/coop/assistant/:cid/events` (server/assistant/index.ts),
 * gửi tin / dừng / duyệt thẻ. Bản demo (?demo) không có server: trả lời theo kịch bản cố định.
 */

export type AsPart =
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; name: string; arg?: string; done?: boolean; err?: boolean }
  | { k: 'proposal'; id: string }

export interface AsMsg {
  id: string
  role: 'user' | 'assistant' | 'system'
  at: number
  parts: AsPart[]
  error?: string
  live?: boolean
  needLogin?: boolean
}

export type ProposalStatus = 'pending' | 'running' | 'waiting' | 'done' | 'rejected' | 'failed'
/** Ô nhập trên thẻ (khoá API…): giá trị gửi một lần lúc bấm Duyệt, server không lưu, Trợ lý không thấy */
export interface AsField { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }
export interface AsProposal {
  id: string
  /** create_project, hire_agent, create_issues, connect_app… (server/assistant/actions.ts) */
  kind: string
  title: string
  lines: string[]
  /** Nội dung dài (AGENTS.md, mô tả ticket) */
  detail?: string
  fields?: AsField[]
  data: Record<string, unknown>
  status: ProposalStatus
  result?: string
  /** status waiting: link cần mở (đăng nhập connector) */
  link?: string
  at: number
}

interface State {
  /** Công ty đang nối */
  cid: string | null
  conn: 'off' | 'connecting' | 'live' | 'error'
  messages: AsMsg[]
  proposals: Record<string, AsProposal>
  busy: boolean
  brain: { ok: boolean; error?: string }
  folders: string[]
  /** Lỗi của lệnh vừa gửi (hiện dưới ô gõ) */
  error: string | null
  /** Có câu trả lời / thẻ mới lúc khung chat đang đóng: chấm đỏ trên lễ tân */
  unread: boolean
}

export const useAssistant = create<State>(() => ({
  cid: null, conn: 'off', messages: [], proposals: {}, busy: false, brain: { ok: true }, folders: [], error: null, unread: false,
}))

const set = useAssistant.setState
const demo = () => useCoop.getState().conn === 'demo'

function merge(list: AsMsg[], upd: AsMsg[]) {
  const out = list.slice()
  for (const m of upd) {
    const i = out.findIndex((x) => x.id === m.id)
    if (i >= 0) out[i] = m
    else out.push(m)
  }
  return out
}

async function post(path: string, body: unknown = {}): Promise<{ ok: boolean; error?: string }> {
  const cid = useAssistant.getState().cid
  if (!cid) return { ok: false, error: 'Chưa chọn công ty' }
  try {
    const r = await fetch(`/coop/assistant/${cid}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-coopverse': '1' },
      body: JSON.stringify(body),
    })
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    return r.ok ? { ok: true } : { ok: false, error: j.error ?? `Lỗi ${r.status}` }
  } catch {
    return { ok: false, error: 'Không gọi được server Pixel Company' }
  }
}

/** Nối SSE theo công ty đang xem. Gắn một lần ở App. */
export function useAssistantLink() {
  const cid = useCoop((s) => s.company?.id ?? null)
  const isDemo = useCoop((s) => s.conn === 'demo')
  useEffect(() => {
    if (isDemo) {
      set({ cid: 'demo', conn: 'live', brain: { ok: true } })
      return
    }
    if (!cid) {
      set({ cid: null, conn: 'off', messages: [], proposals: {}, busy: false })
      return
    }
    set({ cid, conn: 'connecting', messages: [], proposals: {}, busy: false, error: null, unread: false })
    const es = new EventSource(`/coop/assistant/${cid}/events`)
    es.onopen = () => set({ conn: 'live' })
    es.onerror = () => set({ conn: 'error' })
    es.onmessage = (e) => {
      let d: any
      try { d = JSON.parse(e.data) } catch { return }
      if (d.type === 'state') {
        const s = d.state
        set({
          messages: s.messages, busy: s.busy, brain: s.brain, folders: s.folders,
          proposals: Object.fromEntries((s.proposals as AsProposal[]).map((p) => [p.id, p])),
        })
      } else if (d.type === 'patch') {
        const st = useAssistant.getState()
        const fresh = (d.msgs as AsMsg[]).some((m) => m.role === 'assistant' && !m.live && st.messages.find((x) => x.id === m.id)?.live)
        set({
          messages: merge(st.messages, d.msgs),
          proposals: { ...st.proposals, ...Object.fromEntries((d.proposals as AsProposal[]).map((p) => [p.id, p])) },
          busy: d.busy,
          unread: st.unread || (fresh && !useCoop.getState().assistantOpen),
        })
      }
    }
    return () => es.close()
  }, [cid, isDemo])
}

// ── Lệnh ──

let demoSeq = 0
const demoMsg = (role: AsMsg['role'], text: string): AsMsg => ({ id: `demo${++demoSeq}`, role, at: Date.now(), parts: [{ k: 'text', text }] })

export async function sendAssistant(text: string, opts: { model?: string; folder?: string } = {}) {
  set({ error: null })
  if (demo()) {
    const st = useAssistant.getState()
    set({ messages: [...st.messages, demoMsg('user', text || `Tôi muốn làm việc ở thư mục ${opts.folder}`)], busy: true })
    setTimeout(() => {
      set((s) => ({
        busy: false,
        messages: [...s.messages, demoMsg('assistant', 'Đây là bản demo nên mình chỉ trả lời mẫu thôi. Mở Pixel Company nối với Paperclip thật để mình đọc thư mục, lập project và chia việc cho đội nhé.')],
      }))
    }, 900)
    return true
  }
  const r = await post('send', { text, ...opts })
  if (!r.ok) set({ error: r.error ?? 'Không gửi được' })
  return r.ok
}

export const stopAssistant = () => (demo() ? set({ busy: false }) : post('stop'))

export async function resetAssistant() {
  if (demo()) return set({ messages: [], proposals: {} })
  const r = await post('reset')
  if (!r.ok) set({ error: r.error ?? 'Không làm mới được' })
}

export async function decideProposal(id: string, verb: 'approve' | 'reject' | 'continue', body: Record<string, unknown> = {}) {
  set({ error: null })
  const r = await post(`proposals/${id}/${verb}`, body)
  if (!r.ok) set({ error: r.error ?? 'Không thực hiện được' })
  return r.ok
}

export async function loginClaude() {
  const r = await post('login')
  if (!r.ok) set({ error: r.error ?? 'Không mở được cửa sổ đăng nhập' })
}

export const markRead = () => { if (useAssistant.getState().unread) set({ unread: false }) }
