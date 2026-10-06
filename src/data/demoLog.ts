/** Log giả cho bản demo (`?demo`): một lượt chạy Claude Code điển hình, phát lại từng dòng. */

const tool = (name: string, input: Record<string, unknown>) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't', name, input }] },
})
const out = (text: string, is_error = false) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't', content: text, is_error }] },
})
const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const think = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } }

export function demoEvents(task: string): object[] {
  return [
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5', cwd: '/home/you/agents/seo-workspace' },
    think,
    say(`Bắt đầu ${task}. Đọc checklist và trạng thái hiện tại trước.`),
    tool('Read', { file_path: 'handoff/checklist-2026-10-02.md' }),
    out('# Checklist\n- [x] Batch A: template strings\n- [ ] Batch B: alt text DE\n- [ ] Batch C: meta descriptions\n- [ ] Batch D: CTA\n- [ ] Review'),
    tool('Bash', { command: 'ls content/rewrites/ | head', description: 'Xem các file đã viết' }),
    out('template-article-guide-r1.md\nalt-text-de-r1.md\ncover-briefs-r1.md'),
    think,
    tool('Grep', { pattern: 'alt="', path: 'raw/2026-10-02-blog-html' }),
    out('raw/de_blogs_guides_groesse.html:12\nraw/de_blogs_guides_ausstellen.html:9\nraw/blogs_guides_display.html:7'),
    say('Có 28 ảnh cần alt tiếng Đức. Viết theo quy tắc ở mục 0: mô tả đúng ảnh, không nhồi từ khoá.'),
    tool('Write', { file_path: 'content/rewrites/alt-text-de-r2.md' }),
    out('File created successfully'),
    tool('mcp__Paperclip_projects__create_task', { title: 'Review alt text DE (r2)' }),
    out('{"ok":true,"identifier":"LAB-13"}'),
    tool('Bash', { command: 'npx markdownlint content/rewrites/alt-text-de-r2.md' }),
    out('content/rewrites/alt-text-de-r2.md:14 MD013/line-length', true),
    say('Một dòng quá dài, sửa lại rồi chạy lại lint.'),
    tool('Edit', { file_path: 'content/rewrites/alt-text-de-r2.md' }),
    out('The file has been updated successfully.'),
    say('Xong batch B. Đã ghi file và tạo ticket review cho SEO Lead.'),
    { type: 'result', subtype: 'success', duration_ms: 187000, num_turns: 11, total_cost_usd: 0.84 },
  ]
}

/** Gói một sự kiện stream-json thành một dòng NDJSON như log Paperclip. */
export const asLogRecord = (ev: object) =>
  `${JSON.stringify({ ts: new Date().toISOString(), stream: 'stdout', chunk: `${JSON.stringify(ev)}\n` })}\n`
