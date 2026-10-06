/**
 * Biến log run của Paperclip thành các dòng CLI dễ đọc.
 *
 * Log là NDJSON, mỗi dòng `{ts, stream, chunk}`. Với adapter claude_local, stdout là luồng
 * stream-json của Claude Code (`system`/`assistant`/`user`/`result`), nhưng bị cắt thành chunk
 * tuỳ ý: một dòng JSON có thể nằm trên nhiều chunk. Vì vậy ghép stdout lại rồi mới tách theo dòng.
 */

export type LineKind = 'meta' | 'text' | 'tool' | 'out' | 'outErr' | 'err' | 'think' | 'prompt' | 'done' | 'fail' | 'plain'

export interface TermLine {
  id: number
  kind: LineKind
  text: string
  /** Tên công cụ (dòng `tool`) */
  label?: string
}

const MAX_LINES = 1500
const OUT_LINES = 4
const OUT_COLS = 220

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Tóm tắt tham số công cụ thành một dòng, kiểu `Bash(git status)`. */
function toolArg(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Bash': return s('command').split('\n')[0]
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return s('file_path') || s('notebook_path')
    case 'Grep': return [s('pattern'), s('path')].filter(Boolean).join(' · ')
    case 'Glob': return s('pattern')
    case 'WebFetch': return s('url')
    case 'WebSearch': return s('query')
    case 'Task': case 'Agent': return s('description')
    case 'Skill': return s('skill')
    case 'TodoWrite': return 'cập nhật danh sách việc'
    default: {
      const j = JSON.stringify(input)
      return j === '{}' ? '' : j
    }
  }
}

/** `mcp__Paperclip_projects__create_task` → `Paperclip_projects · create_task` */
const toolName = (n: string) => (n.startsWith('mcp__') ? n.slice(5).replace('__', ' · ') : n)

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: { type?: string; text?: string }) => (c?.type === 'text' ? c.text ?? '' : c?.type === 'image' ? '[ảnh]' : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function duration(ms: number) {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} giây`
  const m = Math.floor(sec / 60)
  return m < 60 ? `${m} phút ${sec % 60} giây` : `${Math.floor(m / 60)} giờ ${m % 60} phút`
}

export class LogParser {
  lines: TermLine[] = []
  private seq = 0
  private carry: Record<string, string> = {}
  /** Bắt đầu đọc giữa log: bỏ phần dòng stdout dở dang đầu tiên */
  private resync: boolean

  constructor(opts: { resync?: boolean } = {}) {
    this.resync = !!opts.resync
  }

  private push(kind: LineKind, text: string, label?: string) {
    const last = this.lines[this.lines.length - 1]
    // Nhiều khối "suy nghĩ" liền nhau chỉ hiện một dòng
    if (kind === 'think' && last?.kind === 'think') return
    this.lines.push({ id: ++this.seq, kind, text, label })
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
  }

  meta(text: string) { this.push('meta', text) }

  /** Nhận các dòng NDJSON hoàn chỉnh. */
  feed(ndjson: string) {
    for (const raw of ndjson.split('\n')) {
      if (!raw.trim()) continue
      let rec: { stream?: string; chunk?: string }
      try { rec = JSON.parse(raw) } catch { continue }
      const stream = rec.stream ?? 'stdout'
      let chunk = rec.chunk ?? ''
      if (this.resync && stream === 'stdout') {
        const nl = chunk.indexOf('\n')
        if (nl < 0) continue
        chunk = chunk.slice(nl + 1)
        this.resync = false
      }
      const text = (this.carry[stream] ?? '') + chunk
      const parts = text.split('\n')
      this.carry[stream] = parts.pop() ?? ''
      for (const line of parts) this.line(stream, line)
    }
  }

  private line(stream: string, line: string) {
    if (!line.trim()) return
    if (stream === 'stderr') return this.push('err', clip(line, OUT_COLS * 2))
    if (stream !== 'stdout') return this.push('meta', clip(line, OUT_COLS))
    if (!line.startsWith('{')) return this.push('plain', clip(line, OUT_COLS * 2))
    let ev: Record<string, unknown>
    try { ev = JSON.parse(line) } catch { return }
    this.event(ev)
  }

  private event(ev: Record<string, unknown>) {
    const type = ev.type as string
    if (type === 'system') {
      if (ev.subtype === 'init') {
        this.push('meta', `Phiên bắt đầu · ${ev.model ?? '?'} · ${ev.cwd ?? ''}`)
      } else if (ev.subtype !== 'thinking_tokens' && ev.subtype !== 'status') {
        this.push('meta', `system · ${String(ev.subtype ?? '')}`)
      }
      return
    }
    if (type === 'assistant' || type === 'user') {
      const content = (ev.message as { content?: unknown })?.content
      if (typeof content === 'string') {
        if (type === 'user') this.push('prompt', clip(content.trim(), 600))
        else this.push('text', content.trim())
        return
      }
      if (!Array.isArray(content)) return
      for (const c of content as Record<string, unknown>[]) {
        switch (c.type) {
          case 'text': {
            const t = String(c.text ?? '').trim()
            if (t) this.push(type === 'user' ? 'prompt' : 'text', type === 'user' ? clip(t, 600) : t)
            break
          }
          case 'thinking':
          case 'redacted_thinking':
            this.push('think', 'Đang suy nghĩ…')
            break
          case 'tool_use': {
            const name = String(c.name ?? '?')
            const arg = toolArg(name, (c.input as Record<string, unknown>) ?? {})
            this.push('tool', clip(oneLine(arg), OUT_COLS), toolName(name))
            break
          }
          case 'tool_result': {
            const all = resultText(c.content).split('\n').filter((l) => l.trim())
            const shown = all.slice(0, OUT_LINES).map((l) => clip(l, OUT_COLS))
            if (all.length > OUT_LINES) shown.push(`… +${all.length - OUT_LINES} dòng`)
            this.push(c.is_error ? 'outErr' : 'out', shown.length ? shown.join('\n') : '(không có output)')
            break
          }
        }
      }
      return
    }
    if (type === 'result') {
      const bits = [
        typeof ev.duration_ms === 'number' ? duration(ev.duration_ms) : null,
        typeof ev.num_turns === 'number' ? `${ev.num_turns} lượt` : null,
        typeof ev.total_cost_usd === 'number' ? `$${ev.total_cost_usd.toFixed(2)}` : null,
      ].filter(Boolean)
      const ok = ev.subtype === 'success' && !ev.is_error
      this.push(ok ? 'done' : 'fail', `${ok ? 'Xong' : `Kết thúc lỗi (${String(ev.subtype)})`}${bits.length ? ` · ${bits.join(' · ')}` : ''}`)
      return
    }
    // rate_limit_event, stream_event…: không cần hiện
  }
}

const enc = new TextEncoder()
export const utf8Bytes = (s: string) => enc.encode(s).length
