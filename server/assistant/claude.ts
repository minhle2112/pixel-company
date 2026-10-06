import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Chạy một lượt của Trợ lý bằng Claude Code CLI (`claude -p`), đăng nhập sẵn của máy (subscription hoặc khoá API, tuỳ máy).
 * Trợ lý chỉ đọc: công cụ có sẵn chỉ còn Read / Glob / Grep, MCP chỉ có server "coopverse" (server/assistant/mcp.ts),
 * không nạp hook / plugin / MCP riêng của người dùng.
 */

export interface Brain { ok: true; bin: string }
export interface NoBrain { ok: false; error: string }

let found: Brain | NoBrain | null = null

/** Tìm claude.exe (Windows không chạy thẳng được claude.cmd nếu không qua shell, mà qua shell thì khó giữ nguyên tham số). */
export function findClaude(): Brain | NoBrain {
  if (found?.ok) return found
  const env = process.env.COOPVERSE_CLAUDE?.trim()
  const win = process.platform === 'win32'
  const cands: string[] = []
  if (env) cands.push(env)
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    if (!win) {
      cands.push(path.join(dir, 'claude'))
      continue
    }
    cands.push(path.join(dir, 'claude.exe'))
    // Bản cài bằng npm: claude.cmd trỏ tới node_modules/@anthropic-ai/claude-code/bin/claude.exe cạnh nó
    if (existsSync(path.join(dir, 'claude.cmd'))) cands.push(path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  }
  // Bản cài native và npm toàn cục, phòng khi PATH của app khác PATH của terminal
  const home = os.homedir()
  cands.push(path.join(home, '.local', 'bin', win ? 'claude.exe' : 'claude'))
  if (win && process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  const bin = cands.find((c) => existsSync(c))
  found = bin ? { ok: true, bin } : { ok: false, error: 'Không tìm thấy Claude Code trên máy này. Cài Claude Code rồi đăng nhập (chạy `claude` một lần trong terminal), sau đó mở lại Pixel Company.' }
  return found
}

export type TurnEvent =
  | { t: 'init'; sessionId: string }
  | { t: 'textStart' }
  | { t: 'text'; text: string }
  | { t: 'tool'; id: string; name: string }
  | { t: 'toolInput'; id: string; name: string; input: Record<string, unknown> }
  | { t: 'toolResult'; id: string; isError: boolean }

export interface TurnResult {
  ok: boolean
  /** Lỗi để hiện cho người dùng */
  error?: string
  /** Phiên --resume không còn (đã xoá, khác máy): nên mở phiên mới */
  lostSession?: boolean
  /** Chưa đăng nhập / hết phiên đăng nhập */
  needLogin?: boolean
  sessionId?: string
}

export interface TurnOpts {
  bin: string
  /** Thư mục làm việc cố định của Trợ lý (giữ nguyên để --resume tìm được phiên) */
  cwd: string
  prompt: string
  system: string
  sessionId: string
  resume: boolean
  model?: string
  addDirs: string[]
  mcpUrl: string
  mcpToken: string
  /** CLAUDE_CONFIG_DIR: dùng bản đăng nhập khác bản mặc định của máy */
  configDir?: string
  onEvent: (e: TurnEvent) => void
}

export const TOOL_SERVER = 'coopverse'

const NEED_LOGIN = /failed to authenticate|not logged in|please run \/login|oauth (token|session)|invalid api key|authentication_error/i

/** Mở cửa sổ Claude Code riêng để người dùng tự đăng nhập (/login). Chỉ Windows: tiến trình console tách rời có cửa sổ riêng. */
export function openLogin(bin: string, configDir?: string): boolean {
  if (process.platform !== 'win32') return false
  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir
  const child = spawn(bin, ['/login'], { detached: true, stdio: 'ignore', windowsHide: false, env, cwd: os.homedir() })
  child.on('error', () => { /* báo qua lần gửi tin sau */ })
  child.unref()
  return true
}

/**
 * CLAUDE.md ở các thư mục cha của thư mục Trợ lý (vd bản dev: dữ liệu nằm trong repo → nạp nhầm CLAUDE.md của repo).
 * Bỏ qua, trừ khi thư mục cha đó chính là một project (--add-dir) thì vẫn nạp như thường.
 */
function ancestorClaudeMds(cwd: string, addDirs: string[]): string[] {
  const keep = new Set(addDirs.map((d) => path.resolve(d).toLowerCase()))
  const out: string[] = []
  for (let d = path.dirname(path.resolve(cwd)); ; d = path.dirname(d)) {
    if (!keep.has(d.toLowerCase())) {
      const g = d.replaceAll('\\', '/').replace(/\/$/, '')
      out.push(`${g}/CLAUDE.md`, `${g}/CLAUDE.local.md`, `${g}/.claude/CLAUDE.md`, `${g}/.claude/rules/**`)
    }
    if (path.dirname(d) === d) return out
  }
}

export function runTurn(o: TurnOpts): { done: Promise<TurnResult>; stop: () => void } {
  const mcp = { mcpServers: { [TOOL_SERVER]: { type: 'http', url: o.mcpUrl, headers: { authorization: `Bearer ${o.mcpToken}` } } } }
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', 'Read,Glob,Grep',
    // Không ghi Read / Glob / Grep vào allowedTools (thế là cho đọc mọi nơi): mặc định Claude Code tự cho đọc trong
    // thư mục làm việc + --add-dir, chỗ khác cần hỏi, mà dontAsk thì từ chối luôn
    '--allowedTools', `mcp__${TOOL_SERVER}`,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp),
    // Không nạp hook / plugin trong cài đặt của người dùng (chỉ cài đặt của thư mục Trợ lý, vốn trống)
    '--setting-sources', 'project,local',
    '--settings', JSON.stringify({ claudeMdExcludes: ancestorClaudeMds(o.cwd, o.addDirs) }),
    '--append-system-prompt', o.system,
    ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.addDirs.length ? ['--add-dir', ...o.addDirs] : []),
  ]
  const env = { ...process.env }
  // Pixel Company chạy từ trong một phiên Claude Code (vd npm run dev do Claude bật): đừng để CLI tưởng mình là phiên con
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  // CLAUDE.md của các thư mục project cũng được nạp (như khi mở Claude Code trong thư mục đó)
  env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = '1'
  if (o.configDir) env.CLAUDE_CONFIG_DIR = o.configDir

  const child = spawn(o.bin, args, { cwd: o.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stopped = false
  let buf = ''
  let err = ''
  let result: TurnResult | null = null
  let sessionId: string | undefined
  /** Khối nội dung đang stream (theo index) → id công cụ */
  const blocks = new Map<number, string>()

  const onLine = (line: string) => {
    let m: Record<string, any>
    try { m = JSON.parse(line) } catch { return }
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init' && typeof m.session_id === 'string') {
          sessionId = m.session_id
          o.onEvent({ t: 'init', sessionId: m.session_id })
        }
        break
      case 'stream_event': {
        const e = m.event ?? {}
        if (e.type === 'content_block_start') {
          const b = e.content_block ?? {}
          if (b.type === 'text') o.onEvent({ t: 'textStart' })
          if (b.type === 'tool_use' && typeof b.id === 'string') {
            blocks.set(e.index, b.id)
            o.onEvent({ t: 'tool', id: b.id, name: String(b.name ?? '') })
          }
        } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
          o.onEvent({ t: 'text', text: e.delta.text })
        }
        break
      }
      case 'assistant':
        // Tin đầy đủ: lấy tham số công cụ (lúc stream chỉ có từng mẩu JSON)
        for (const c of m.message?.content ?? []) {
          if (c?.type === 'tool_use' && typeof c.id === 'string') o.onEvent({ t: 'toolInput', id: c.id, name: String(c.name ?? ''), input: c.input ?? {} })
        }
        break
      case 'user':
        for (const c of m.message?.content ?? []) {
          if (c?.type === 'tool_result' && typeof c.tool_use_id === 'string') o.onEvent({ t: 'toolResult', id: c.tool_use_id, isError: !!c.is_error })
        }
        break
      case 'result': {
        const isErr = !!m.is_error || (typeof m.subtype === 'string' && m.subtype !== 'success')
        const text = typeof m.result === 'string' ? m.result : Array.isArray(m.errors) ? m.errors.join('\n') : ''
        result = isErr ? { ok: false, error: text || `Claude dừng (${m.subtype ?? 'lỗi'})`, sessionId } : { ok: true, sessionId: m.session_id ?? sessionId }
        break
      }
    }
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d: string) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) onLine(line)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d: string) => { if (err.length < 8000) err += d })
  child.stdin.on('error', () => { /* tiến trình chết sớm */ })
  child.stdin.end(o.prompt)

  const done = new Promise<TurnResult>((resolve) => {
    child.on('error', (e) => resolve({ ok: false, error: `Không chạy được Claude Code: ${e.message}` }))
    child.on('close', (code) => {
      if (buf.trim()) onLine(buf.trim())
      if (stopped) return resolve({ ok: false, error: 'Đã dừng.', sessionId })
      const r = result as TurnResult | null
      if (r?.ok) return resolve(r)
      const msg = (r?.error || err.trim() || `Claude Code thoát với mã ${code}`).slice(0, 1500)
      if (NEED_LOGIN.test(msg)) return resolve({ ok: false, needLogin: true, sessionId, error: 'Claude Code trên máy này chưa đăng nhập, hoặc phiên đăng nhập đã hết hạn. Bấm "Đăng nhập Claude", gõ /login trong cửa sổ vừa mở, đăng nhập xong thì gửi lại tin.' })
      resolve({ ok: false, error: msg, sessionId, lostSession: o.resume && /no conversation found|session.*not found/i.test(msg) })
    })
  })

  return {
    done,
    stop: () => {
      stopped = true
      child.kill()
    },
  }
}
