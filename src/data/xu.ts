import type { Ledger } from './ledger'
import { EXP, levelOf, ticketExp } from './levels'

/**
 * Xu: tiền của văn phòng, để dọn dẹp, mua đồ trang trí và đồ để bàn.
 * Chỉ ticket xong trên board mới ra Xu, nhiều ít theo độ ưu tiên; agent cấp càng cao (lúc ticket xong) càng được nhiều,
 * mỗi cấp thêm 10%. Xu vào một quỹ chung. Tính lại từ sổ EXP mỗi lần, nên ticket cũ trước khi có tính năng này cũng có Xu.
 * Không phụ thuộc React: server dùng chung để kiểm số dư trước khi cho tiêu.
 */
export const XU_TICKET: Record<string, number> = { critical: 40, high: 25, medium: 15, low: 10 }
export const ticketXu = (priority: string) => XU_TICKET[priority] ?? XU_TICKET.medium
/** Hệ số theo cấp: cấp 1 ×1,0 · cấp 5 ×1,4 · cấp 10 ×1,9 */
export const levelBonus = (level: number) => 1 + 0.1 * (level - 1)

export interface Earnings {
  /** Tổng Xu kiếm được từ trước tới giờ */
  total: number
  byAgent: Record<string, number>
  /** issueId → Xu ticket đó mang về */
  byTicket: Record<string, number>
}

/**
 * Cộng Xu từ sổ. Đi lần lượt theo thời gian để biết cấp của agent lúc từng ticket xong
 * (EXP của chính ticket đó chỉ cộng sau khi tính Xu).
 */
export function earnings(L: Ledger): Earnings {
  // [lúc, agentId, EXP, issueId nếu là ticket, độ ưu tiên]
  const ev: [number, string, number, string?, string?][] = []
  for (const [agentId, at] of Object.values(L.runs)) ev.push([at, agentId, EXP.run])
  for (const [agentId, at] of Object.values(L.approvals)) ev.push([at, agentId, EXP.approval])
  for (const [id, [agentId, at, p]] of Object.entries(L.tickets)) ev.push([at, agentId, ticketExp(p), id, p])
  // Cùng lúc thì việc khác tính trước ticket
  ev.sort((a, b) => a[0] - b[0] || (a[3] ? 1 : 0) - (b[3] ? 1 : 0))
  const exp = new Map<string, number>()
  const out: Earnings = { total: 0, byAgent: {}, byTicket: {} }
  for (const [, agentId, gain, ticket, p] of ev) {
    const before = exp.get(agentId) ?? 0
    if (ticket) {
      const xu = Math.round(ticketXu(p!) * levelBonus(levelOf(before)))
      out.byTicket[ticket] = xu
      out.byAgent[agentId] = (out.byAgent[agentId] ?? 0) + xu
      out.total += xu
    }
    exp.set(agentId, before + gain)
  }
  return out
}

/** Xu mỗi agent vừa kiếm thêm giữa hai bản sổ (chỉ ticket mới) */
export function xuGained(prev: Earnings, next: Earnings, L: Ledger): Map<string, number> {
  const g = new Map<string, number>()
  for (const [id, xu] of Object.entries(next.byTicket)) {
    if (prev.byTicket[id] !== undefined) continue
    const agentId = L.tickets[id]?.[0]
    if (agentId) g.set(agentId, (g.get(agentId) ?? 0) + xu)
  }
  return g
}

/** 1250 → "1.250" */
export const fmtXu = (n: number) => Math.round(n).toLocaleString('vi-VN')
