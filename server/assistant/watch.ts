import { clip, type Pc, type PcAgent, type PcIssue } from './tools'

/**
 * Theo dõi công ty để lễ tân tự báo: ticket vừa xong / chờ xem lại, việc mới chờ người dùng quyết
 * (hộp "cần chú ý" của Paperclip, cũng là hàng phím Q trong game). Không báo agent lỗi / kẹt (owner không chọn).
 * Lần quét đầu chỉ ghi mốc, không báo gì.
 */

export interface WatchState {
  /** id ticket → trạng thái lần quét trước */
  issues: Record<string, string>
  /** id việc chờ quyết đã thấy */
  asks: string[]
  /** Ngày (giờ VN, YYYY-MM-DD) đã tóm tắt đầu ngày */
  day?: string
  /** Lúc tóm tắt đầu ngày lần trước (ms) */
  briefAt?: number
}

interface AttentionItem {
  sourceKind: string
  subject: { id: string; title: string; metadata: Record<string, unknown> | null }
  relatedIssue: { identifier: string | null } | null
}

/** Trạng thái ticket đáng báo khi vừa chuyển sang */
const NOTE: Record<string, string> = { done: 'xong', in_review: 'chờ xem lại' }

export const vnDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
export const vnHour = (d = new Date()) => Number(d.toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }))

export async function scan(pc: Pc, cid: string, prev: WatchState | undefined): Promise<{ next: WatchState; notices: string[] }> {
  const [issues, feed] = await Promise.all([
    pc.get<(PcIssue & { conversationAgentId?: string | null })[]>(`/companies/${cid}/issues`),
    pc.get<{ items: AttentionItem[] }>(`/companies/${cid}/attention?all=true`).catch(() => ({ items: [] as AttentionItem[] })),
  ])
  // Cuộc trò chuyện Agent Chat cũng là "ticket": bỏ qua
  const real = issues.filter((i) => !i.conversationAgentId)
  const asks = feed.items.filter((i) => i.sourceKind === 'approval' || i.sourceKind === 'issue_thread_interaction')
  const next: WatchState = {
    ...prev,
    issues: Object.fromEntries(real.map((i) => [i.id, i.status])),
    asks: asks.map((a) => a.subject.id),
  }
  if (!prev) return { next, notices: [] }

  const moved = real.filter((i) => NOTE[i.status] && prev.issues[i.id] !== undefined && prev.issues[i.id] !== i.status)
  const seen = new Set(prev.asks)
  const fresh = asks.filter((a) => !seen.has(a.subject.id))
  if (!moved.length && !fresh.length) return { next, notices: [] }

  const agents = await pc.get<PcAgent[]>(`/companies/${cid}/agents`).catch(() => [] as PcAgent[])
  const name = (id: unknown) => (typeof id === 'string' ? agents.find((a) => a.id === id)?.name : undefined)
  const notices = [
    ...moved.map((i) => `${i.identifier} "${clip(i.title, 80)}" ${NOTE[i.status]}${name(i.assigneeAgentId) ? ` (${name(i.assigneeAgentId)})` : ''}`),
    ...fresh.map((a) => {
      const m = a.subject.metadata ?? {}
      const who = name(a.sourceKind === 'approval' ? m.requestedByAgentId : m.createdByAgentId)
      const key = a.relatedIssue?.identifier ? ` (${a.relatedIssue.identifier})` : ''
      return `${who ?? 'Một agent'} cần bạn quyết: ${clip(a.subject.title, 100)}${key}`
    }),
  ]
  return { next, notices }
}
