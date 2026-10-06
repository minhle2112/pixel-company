import type { Agent } from './types'

/**
 * Sơ đồ tổ chức chỉ có hai tầng: Lead (không báo cáo cho ai trong công ty) và thành viên của Lead.
 * Không có agent con: thành viên không đề xuất thuê thêm phụ tá, chỉ Lead thuê người cho nhóm.
 */

/** Cấp trong sơ đồ tổ chức: 0 = gốc (Lead / không báo cáo cho ai trong công ty), 1 = thành viên, 2+ = báo cáo cho một thành viên. */
export function depthOf(agents: Agent[], id: string | null | undefined): number {
  const seen = new Set<string>()
  let cur = agents.find((a) => a.id === id)
  let d = 0
  while (cur?.reportsTo && !seen.has(cur.id)) {
    seen.add(cur.id)
    const up = agents.find((a) => a.id === cur!.reportsTo)
    if (!up) break
    d++
    cur = up
  }
  return d
}

/** Lead (★): agent gốc (không báo cáo cho ai trong công ty) có ít nhất một thành viên. Ứng viên chưa duyệt không tính. */
export function leadIdsOf(agents: Agent[]): Set<string> {
  const staff = agents.filter((a) => !a.candidate)
  const ids = new Set(staff.map((a) => a.id))
  const roots = new Set(staff.filter((a) => !a.reportsTo || !ids.has(a.reportsTo)).map((a) => a.id))
  return new Set(staff.flatMap((a) => (a.reportsTo && roots.has(a.reportsTo) ? [a.reportsTo] : [])))
}

export interface HireWarning { level: 'red' | 'warn'; text: string }

/**
 * Ứng viên có được quyền thuê tiếp không. Payload phiếu không chứa quyền, nên đọc từ agent ứng viên
 * (Paperclip tạo sẵn ở trạng thái chờ duyệt); không có thì xem payload (bản demo).
 */
export function candidateCanHire(agents: Agent[], payload: Record<string, unknown>): boolean | undefined {
  const cand = agents.find((a) => a.id === payload.agentId)
  if (cand?.canHire !== undefined) return cand.canHire
  const v = (payload.permissions as { canCreateAgents?: unknown } | undefined)?.canCreateAgents
  return typeof v === 'boolean' ? v : undefined
}

/**
 * Kiểm phiếu thuê: chỉ Lead đề xuất thuê, người mới báo cáo cho Lead (không có agent con) và không được quyền thuê tiếp,
 * model rẻ. Pixel Company chỉ cảnh báo, bạn vẫn duyệt được.
 */
export function hireWarnings(agents: Agent[], requesterId: string | null, payload: Record<string, unknown>): HireWarning[] {
  const out: HireWarning[] = []
  const who = agents.find((a) => a.id === requesterId)
  const name = (id: unknown) => agents.find((a) => a.id === id)?.name
  const reportsTo = typeof payload.reportsTo === 'string' ? payload.reportsTo : null
  // Cấp của agent mới = cấp người nó báo cáo + 1
  const newDepth = reportsTo ? depthOf(agents, reportsTo) + 1 : 0

  if (who) {
    if (depthOf(agents, who.id) >= 1) out.push({ level: 'red', text: `${who.name} là thành viên. Chỉ Lead được thuê người cho nhóm, thành viên không đề xuất thêm phụ tá.` })
    if (reportsTo && reportsTo !== who.id) {
      out.push({ level: 'warn', text: `Agent mới báo cáo cho ${name(reportsTo) ?? 'người khác'}, không phải ${who.name}.` })
    }
  }
  if (!reportsTo) out.push({ level: 'warn', text: 'Agent mới không báo cáo cho ai, sẽ thành một Lead riêng.' })
  if (newDepth >= 2) out.push({ level: 'red', text: `Agent mới báo cáo cho thành viên ${name(reportsTo) ?? ''}. Không còn agent con: người mới phải báo cáo cho Lead.` })
  if (newDepth >= 1 && candidateCanHire(agents, payload) !== false) {
    out.push({ level: 'red', text: 'Thành viên mới sẽ có quyền thuê người (phiếu không tắt canCreateAgents).' })
  }

  const model = String((payload.adapterConfig as { model?: unknown } | undefined)?.model ?? '')
  if (/opus/i.test(model)) out.push({ level: 'warn', text: `Model đắt (${model}). Việc lặp lại thường chỉ cần model rẻ hơn.` })
  return out
}
