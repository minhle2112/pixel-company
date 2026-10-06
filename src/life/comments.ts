import { MOCK_COMMENTS } from '../data/mock'
import { paperclip } from '../data/paperclip'
import type { Comment } from '../data/types'
import { useCoop } from '../store'

/** Đọc lại comment của một ticket tối đa 2 phút một lần */
const TTL_MS = 120_000

const cache = new Map<string, { at: number; latest: Comment | null; loading: boolean }>()

/**
 * Comment mới nhất của ticket, đọc từ bộ nhớ đệm (không chờ mạng).
 * Chưa có trong bộ nhớ đệm thì trả `undefined` và tải ngầm; lần hỏi sau sẽ có.
 */
export function latestComment(issueId: string): Comment | null | undefined {
  if (useCoop.getState().conn === 'demo') return MOCK_COMMENTS[issueId]?.[0] ?? null
  const now = Date.now()
  const e = cache.get(issueId)
  if (!e || (!e.loading && now - e.at > TTL_MS)) {
    const entry = { at: now, latest: e?.latest ?? null, loading: true }
    cache.set(issueId, entry)
    paperclip
      .comments(issueId)
      .then((list) => { entry.latest = list[0] ?? null })
      .catch(() => {})
      .finally(() => { entry.loading = false; entry.at = Date.now() })
    return e ? e.latest : undefined
  }
  return e.latest
}

/** Rút một comment (markdown, có thể rất dài) thành một câu ngắn để hiện trong bong bóng. */
export function snippet(body: string, max = 72) {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? plain
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}
