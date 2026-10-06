import type { ReactNode } from 'react'
import { PAPERCLIP_UI } from '../data/paperclip'

/**
 * Markdown tối giản cho câu trả lời của agent: đoạn văn, tiêu đề, danh sách, khối code, **đậm**, *nghiêng*,
 * `code`, [link](url). Dựng bằng phần tử React (không dùng innerHTML) nên nội dung lạ không chạy được script.
 */
export function Md({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    // Khối code ```
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      out.push(<pre key={key++} className="md-pre">{body.join('\n')}</pre>)
      continue
    }
    // Tiêu đề
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      out.push(<div key={key++} className={`md-h md-h${Math.min(h[1].length, 3)}`}>{inline(h[2])}</div>)
      i++
      continue
    }
    // Danh sách (gạch đầu dòng hoặc đánh số)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^\[( |x)\]\s*/i, (_, x: string) => (x.trim() ? '☑ ' : '☐ ')))}</li>)
        i++
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>)
      continue
    }
    if (!line.trim()) { i++; continue }
    // Đoạn văn: gom các dòng liền nhau
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(lines[i])) para.push(lines[i++])
    out.push(<p key={key++}>{para.map((l, n) => <span key={n}>{n > 0 && <br />}{inline(l)}</span>)}</p>)
  }
  return <div className="md">{out}</div>
}

/** Link trong câu trả lời: đường dẫn tương đối (/LAB/issues/LAB-3) là trang của Paperclip. */
function href(url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return `${PAPERCLIP_UI}${url}`
  return null
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\n]+)\*(?!\w)|(https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>)
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<b key={k++}>{m[2] ?? m[3]}</b>)
    else if (m[4] !== undefined) {
      const url = href(m[5])
      out.push(url ? <a key={k++} href={url} target="_blank" rel="noreferrer">{m[4]}</a> : m[4])
    } else if (m[6] !== undefined) out.push(<i key={k++}>{m[6]}</i>)
    else if (m[7] !== undefined) out.push(<a key={k++} href={m[7]} target="_blank" rel="noreferrer">{m[7]}</a>)
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
