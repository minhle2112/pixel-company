import type { Issue } from './types'

/** Các cột trên bảng ticket (trạng thái Paperclip → cột). Ticket đã huỷ không hiện. */
export const COLUMNS = [
  { id: 'todo', label: 'Cần làm', statuses: ['backlog', 'todo'], color: '#8a94a6' },
  { id: 'doing', label: 'Đang làm', statuses: ['in_progress'], color: '#3ccf6e' },
  { id: 'review', label: 'Chờ duyệt', statuses: ['in_review'], color: '#6c8ed8' },
  { id: 'blocked', label: 'Bị chặn', statuses: ['blocked'], color: '#ef5a4c' },
  { id: 'done', label: 'Xong', statuses: ['done'], color: '#f2b544' },
] as const

export type ColumnId = (typeof COLUMNS)[number]['id']

export const PRIORITY: Record<string, { label: string; color: string; rank: number }> = {
  critical: { label: 'Khẩn', color: '#ef5a4c', rank: 0 },
  high: { label: 'Cao', color: '#f2884c', rank: 1 },
  medium: { label: 'Vừa', color: '#f2b544', rank: 2 },
  low: { label: 'Thấp', color: '#8a94a6', rank: 3 },
}

const time = (i: Issue) => (i.status === 'done' ? i.completedAt ?? i.updatedAt : i.updatedAt)

/** Chia ticket vào cột. Cột Xong: mới xong trước; các cột khác: ưu tiên cao trước, rồi mới cập nhật trước. */
export function groupIssues(issues: Issue[]): Record<ColumnId, Issue[]> {
  const out = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as Issue[]])) as Record<ColumnId, Issue[]>
  for (const i of issues) {
    const col = COLUMNS.find((c) => (c.statuses as readonly string[]).includes(i.status))
    if (col) out[col.id].push(i)
  }
  for (const c of COLUMNS) {
    out[c.id].sort((a, b) =>
      c.id === 'done'
        ? time(b).localeCompare(time(a))
        : (PRIORITY[a.priority ?? '']?.rank ?? 9) - (PRIORITY[b.priority ?? '']?.rank ?? 9) || time(b).localeCompare(time(a)),
    )
  }
  return out
}

/** "5 phút trước", "3 giờ trước", "2 ngày trước" */
export function ago(iso: string | null | undefined) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'vừa xong'
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
  return `${Math.floor(s / 86400)} ngày trước`
}
