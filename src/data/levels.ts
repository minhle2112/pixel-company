/**
 * Quy tắc EXP và cấp, không phụ thuộc React: dùng chung cho trang (src/data/exp.ts, src/data/xu.ts)
 * và server nhỏ của Pixel Company (server/coopData.ts kiểm số Xu trước khi cho tiêu).
 * Việc hỏng (run lỗi, bị huỷ) được 0 điểm, nên không bao giờ bị trừ.
 */
export const EXP = {
  /** Ticket xong, theo độ ưu tiên */
  ticket: { critical: 120, high: 80, medium: 50, low: 30 } as Record<string, number>,
  run: 10,
  approval: 30,
}
export const ticketExp = (priority: string) => EXP.ticket[priority] ?? EXP.ticket.medium

/** EXP tích luỹ để đạt cấp L: cấp 2 = 100, cấp 3 = 300, cấp 4 = 600… (cấp sau cần thêm 100 × cấp hiện tại) */
export const expForLevel = (level: number) => 50 * level * (level - 1)

export function levelOf(exp: number) {
  let l = 1
  while (expForLevel(l + 1) <= exp) l++
  return l
}

export const TITLES = [
  'Thực tập sinh', 'Nhân viên mới', 'Nhân viên', 'Nhân viên chính', 'Chuyên viên',
  'Chuyên viên chính', 'Chuyên gia', 'Chuyên gia cao cấp', 'Bậc thầy', 'Huyền thoại',
]
export const titleOf = (level: number) => TITLES[Math.min(level, TITLES.length) - 1]

/** EXP tích luỹ của một agent, cộng thẳng từ sổ (server dùng để kiểm cấp trước khi bán đồ để bàn) */
type Rows = Record<string, readonly [string, number, ...string[]]>
export function agentExp(L: { runs: Rows; tickets: Rows; approvals: Rows }, agentId: string) {
  let n = 0
  for (const [id] of Object.values(L.runs)) if (id === agentId) n += EXP.run
  for (const [id, , p] of Object.values(L.tickets)) if (id === agentId) n += ticketExp(p ?? '')
  for (const [id] of Object.values(L.approvals)) if (id === agentId) n += EXP.approval
  return n
}
