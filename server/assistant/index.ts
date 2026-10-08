import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { Handler } from '../guard'
import { findClaude, openLogin, runTurn, TOOL_SERVER, type TurnEvent } from './claude'
import { actionOf } from './actions'
import { mcpHandler } from './mcp'
import { SYSTEM, SYSTEM_VERSION } from './prompt'
import {
  folderProblem, liveProjects, overview, pcClient, projectFolder, vnTime,
  type Pc, type ProposalDraft, type ToolCtx,
} from './tools'
import { scan, vnDay, vnHour, type WatchState } from './watch'

/**
 * Trợ lý (lễ tân) của mỗi văn phòng: một cuộc trò chuyện liền mạch với Claude Code CLI, chạy trên máy này.
 *
 * - GET  /coop/assistant/:cid/events                      SSE: trạng thái đầy đủ lúc nối, sau đó từng phần đổi
 * - POST /coop/assistant/:cid/send      {text, model?, folder?}  gửi tin (folder: thư mục vừa chọn ở màn hình chào)
 * - POST /coop/assistant/:cid/stop                         dừng lượt đang chạy
 * - POST /coop/assistant/:cid/reset                        cuộc trò chuyện mới
 * - POST /coop/assistant/:cid/login                        mở cửa sổ Claude Code để đăng nhập
 * - POST /coop/assistant/:cid/prefs     {model?, proactive?}  model cho lượt tự động, bật / tắt lễ tân tự báo
 * - POST /coop/assistant/:cid/proposals/:pid/(approve|reject|continue)  quyết thẻ đề xuất
 *        approve {values?}: giá trị các ô bảo mật trên thẻ (khoá API…), chỉ dùng một lần, không lưu
 *        continue: thẻ đang chờ người dùng đăng nhập trên web, bấm "Xong rồi"
 * - POST /coop/assistant/mcp                               MCP "coopverse" cho CLI (khoá Bearer của lượt đang chạy)
 *
 * Lệnh POST của trang cần header x-coopverse + origin Pixel Company (như /coop/office). Dữ liệu: `<dir>/assistant/<cid>/`
 * (chat.json, memory/ = bộ nhớ cấp công ty, cũng là thư mục làm việc của CLI).
 */

type Part =
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; name: string; arg?: string; done?: boolean; err?: boolean }
  | { k: 'proposal'; id: string }

interface Msg {
  id: string; role: 'user' | 'assistant' | 'system'; at: number; parts: Part[]; error?: string; live?: boolean
  /** Lỗi vì chưa đăng nhập Claude: khung chat hiện nút đăng nhập */
  needLogin?: boolean
}

type ProposalStatus = 'pending' | 'running' | 'waiting' | 'done' | 'rejected' | 'failed'
interface Proposal extends ProposalDraft {
  id: string; at: number; status: ProposalStatus; result?: string
  /** Trạng thái waiting: link người dùng cần mở (đăng nhập connector) */
  link?: string
}

interface Chat {
  v: 1
  /** Phiên Claude Code (--session-id lần đầu, --resume các lần sau) */
  sessionId: string
  started: boolean
  /** Bản system prompt của phiên (Claude Code giữ nguyên system prompt khi resume: đổi bản thì mở phiên mới) */
  sys?: number
  messages: Msg[]
  proposals: Record<string, Proposal>
  /** Thư mục người dùng đã chọn mà chưa thành project: vẫn cho Trợ lý đọc */
  folders: string[]
  /** Việc xảy ra ngoài cuộc trò chuyện (duyệt / bỏ thẻ), báo cho Trợ lý ở tin kế tiếp */
  events: string[]
  /** Mốc theo dõi công ty để tự báo (watch.ts) */
  watch?: WatchState
  /** Cài đặt từ trang: model (lượt tự động dùng), lễ tân tự báo (mặc định bật) */
  prefs?: { model?: string; proactive?: boolean }
}

interface Live {
  cid: string
  chat: Chat
  clients: Set<ServerResponse>
  turn: { stop: () => void; msgId: string } | null
  dirtyMsgs: Set<string>
  dirtyProps: Set<string>
  flushTimer: ReturnType<typeof setTimeout> | null
  saveTimer: ReturnType<typeof setTimeout> | null
  /** Quét Paperclip định kỳ khi có trang đang mở */
  poll: ReturnType<typeof setInterval> | null
  /** Việc chờ báo trong lượt tự động kế tiếp */
  auto: { notices: string[]; brief: boolean; timer: ReturnType<typeof setTimeout> | null; last: number }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MODEL = /^[a-zA-Z0-9._\-[\]]{1,64}$/
const MAX_MSGS = 300
const MAX_TEXT = 8000
const FLUSH_MS = 80
/** Quét Paperclip tìm việc mới để tự báo */
const POLL_MS = 30_000
/** Chờ gom các việc xảy ra gần nhau vào một lượt */
const SETTLE_MS = 15_000
/** Tối đa một lượt tự động mỗi 3 phút (mỗi lượt tốn hạn mức) */
const AUTO_GAP_MS = 3 * 60_000
/** Tóm tắt đầu ngày từ 5 giờ sáng (giờ VN) */
const BRIEF_FROM = 5

const newChat = (): Chat => ({ v: 1, sessionId: randomUUID(), started: false, sys: SYSTEM_VERSION, messages: [], proposals: {}, folders: [], events: [] })

const lives = new Map<string, Live>()
/** Khoá MCP của lượt đang chạy → công ty + tin nhắn đang soạn */
const tokens = new Map<string, { cid: string; msgId: string }>()

const homeOf = (dir: string, cid: string) => path.join(dir, 'assistant', cid)
const chatFile = (dir: string, cid: string) => path.join(homeOf(dir, cid), 'chat.json')

async function loadLive(dir: string, cid: string): Promise<Live> {
  let L = lives.get(cid)
  if (L) return L
  let chat = newChat()
  try {
    const raw = JSON.parse(await readFile(chatFile(dir, cid), 'utf8')) as Partial<Chat>
    // sys lấy đúng theo file (thiếu = bản cũ trước khi có đánh số) để turn() biết phải mở phiên mới
    if (raw && raw.v === 1 && typeof raw.sessionId === 'string') chat = { ...newChat(), ...raw, sys: raw.sys } as Chat
  } catch { /* chưa có */ }
  // Tắt app giữa chừng: tin đang soạn / thẻ đang chạy coi như dừng
  for (const m of chat.messages) if (m.live) { m.live = false; m.error ??= 'Bị ngắt (Pixel Company đã tắt giữa chừng).' }
  for (const p of Object.values(chat.proposals)) if (p.status === 'running') { p.status = 'failed'; p.result = 'Bị ngắt giữa chừng, kiểm tra lại rồi đề xuất lại.' }
  L = lives.get(cid)
  if (L) return L
  L = {
    cid, chat, clients: new Set(), turn: null, dirtyMsgs: new Set(), dirtyProps: new Set(), flushTimer: null, saveTimer: null,
    poll: null, auto: { notices: [], brief: false, timer: null, last: 0 },
  }
  lives.set(cid, L)
  return L
}

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(data), 'utf8')
  await rename(tmp, file)
}

function scheduleSave(dir: string, L: Live) {
  if (L.saveTimer) return
  L.saveTimer = setTimeout(() => {
    L.saveTimer = null
    L.chat.messages = L.chat.messages.slice(-MAX_MSGS)
    const keep = new Set(L.chat.messages.flatMap((m) => m.parts.flatMap((p) => (p.k === 'proposal' ? [p.id] : []))))
    for (const id of Object.keys(L.chat.proposals)) if (!keep.has(id)) delete L.chat.proposals[id]
    writeJson(chatFile(dir, L.cid), L.chat).catch(() => { /* lần sau ghi lại */ })
  }, 400)
}

const publicState = (L: Live) => ({
  messages: L.chat.messages,
  proposals: Object.values(L.chat.proposals),
  busy: !!L.turn,
  brain: (({ ok, ...r }) => ({ ok, error: 'error' in r ? r.error : undefined }))(findClaude()),
  folders: L.chat.folders,
})

function sse(res: ServerResponse, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function flush(L: Live) {
  L.flushTimer = null
  const msgs = [...L.dirtyMsgs].map((id) => L.chat.messages.find((m) => m.id === id)).filter(Boolean)
  const proposals = [...L.dirtyProps].map((id) => L.chat.proposals[id]).filter(Boolean)
  L.dirtyMsgs.clear()
  L.dirtyProps.clear()
  for (const c of L.clients) sse(c, { type: 'patch', msgs, proposals, busy: !!L.turn })
}

function touch(dir: string, L: Live, msgId?: string, propId?: string) {
  if (msgId) L.dirtyMsgs.add(msgId)
  if (propId) L.dirtyProps.add(propId)
  if (!L.flushTimer) L.flushTimer = setTimeout(() => flush(L), FLUSH_MS)
  scheduleSave(dir, L)
}

function resetAll(L: Live) {
  for (const c of L.clients) sse(c, { type: 'state', state: publicState(L) })
}

function addMsg(dir: string, L: Live, m: Omit<Msg, 'id' | 'at'>): Msg {
  const msg: Msg = { id: randomUUID(), at: Date.now(), ...m }
  L.chat.messages.push(msg)
  touch(dir, L, msg.id)
  return msg
}

/** Một dòng ngắn cho tham số công cụ (hiện trong khung chat) */
function toolArg(name: string, input: Record<string, unknown>) {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Read': return s('file_path')
    case 'Glob': return [s('pattern'), s('path')].filter(Boolean).join(' · ')
    case 'Grep': return [s('pattern'), s('path')].filter(Boolean).join(' · ')
    case 'memory_read': case 'memory_write': return [s('scope') === 'project' ? s('project') : 'công ty', s('file')].filter(Boolean).join(' · ')
    case 'get_issue': return s('key')
    case 'agent_detail': case 'recent_runs': return s('agent')
    case 'list_issues': return [s('status'), s('project'), s('agent')].filter(Boolean).join(' · ')
    case 'list_skills': return s('agent')
    case 'list_connectors': return s('search')
    case 'list_models': return s('adapter')
    case 'propose_create_issues': {
      const n = Array.isArray(input.tickets) ? input.tickets.length : 0
      const t0 = n ? (input.tickets as { title?: unknown }[])[0]?.title : ''
      return n === 1 && typeof t0 === 'string' ? t0 : n ? `${n} ticket` : ''
    }
    default:
      return name.startsWith('propose_')
        ? s('name') || s('title') || s('agent') || s('key') || s('app') || s('routine') || s('target') || s('catalog_id') || s('source')
        : ''
  }
}

const shortTool = (n: string) => n.replace(`mcp__${TOOL_SERVER}__`, '')

/** Thư mục cho Trợ lý đọc: thư mục mọi project + thư mục người dùng vừa chọn */
async function readableDirs(pc: Pc, cid: string, picked: string[]) {
  const out = new Map<string, string>()
  const add = (f: string | null) => { if (f && existsSync(f)) out.set(path.normalize(f).toLowerCase(), path.normalize(f)) }
  try { for (const p of await liveProjects(pc, cid)) add(projectFolder(p)) } catch { /* Paperclip tắt */ }
  for (const f of picked) add(f)
  return [...out.values()]
}

/** Một lượt của Trợ lý. auto: lượt tự động (người dùng không gõ), hiện dòng báo này thay cho tin của người dùng */
async function turn(opts: AssistantOpts, L: Live, text: string, model: string | undefined, auto?: string) {
  const { dir } = opts
  const chat = L.chat
  addMsg(dir, L, auto ? { role: 'system', parts: [{ k: 'text', text: auto }] } : { role: 'user', parts: [{ k: 'text', text }] })
  model ??= chat.prefs?.model
  const brain = findClaude()
  if (!brain.ok) {
    addMsg(dir, L, { role: 'system', parts: [], error: brain.error })
    return
  }
  const msg = addMsg(dir, L, { role: 'assistant', parts: [], live: true })
  // Giữ chỗ ngay (trước các bước await): tin gửi lúc này / lượt tự động phải chờ, không chạy 2 CLI trên cùng phiên
  L.turn = { stop: () => {}, msgId: msg.id }
  const pc = pcClient(opts.target())
  const home = homeOf(dir, L.cid)
  await mkdir(path.join(home, 'memory'), { recursive: true }).catch(() => { /* CLI sẽ báo lỗi thư mục */ })

  let ctx: string
  try { ctx = await overview(pc, L.cid) } catch (e) { ctx = `(Không đọc được Paperclip: ${e instanceof Error ? e.message : e})` }
  if (chat.sys !== SYSTEM_VERSION) {
    // Lời dặn hệ thống đã đổi (Pixel Company cập nhật): phiên cũ giữ bản cũ nên mở phiên mới
    if (chat.started) chat.events.push('Pixel Company vừa cập nhật lễ tân (phiên Claude mới, có thêm công cụ). Lịch sử trò chuyện cũ không còn trong ngữ cảnh: đọc bộ nhớ công ty nếu cần.')
    chat.sessionId = randomUUID()
    chat.started = false
    chat.sys = SYSTEM_VERSION
  }
  const events = chat.events.splice(0)
  if (chat.folders.length) ctx += `\nThư mục người dùng đã chọn (chưa thành project): ${chat.folders.join(' · ')}`
  if (events.length) ctx += `\nSự kiện mới:\n${events.map((e) => `- ${e}`).join('\n')}`
  const prompt = `<coopverse>\n${ctx}\n</coopverse>\n\n${text}`
  const addDirs = await readableDirs(pc, L.cid, chat.folders)

  const token = randomUUID()
  tokens.set(token, { cid: L.cid, msgId: msg.id })
  const part = (id: string) => msg.parts.find((p): p is Extract<Part, { k: 'tool' }> => p.k === 'tool' && p.id === id)
  const onEvent = (e: TurnEvent) => {
    switch (e.t) {
      case 'init': chat.started = true; break
      case 'textStart': msg.parts.push({ k: 'text', text: '' }); break
      case 'text': {
        const last = msg.parts[msg.parts.length - 1]
        if (last?.k === 'text') last.text += e.text
        else msg.parts.push({ k: 'text', text: e.text })
        break
      }
      case 'tool': msg.parts.push({ k: 'tool', id: e.id, name: shortTool(e.name) }); break
      case 'toolInput': {
        const p = part(e.id)
        if (p) p.arg = toolArg(shortTool(e.name), e.input)
        break
      }
      case 'toolResult': {
        const p = part(e.id)
        if (p) Object.assign(p, { done: true, err: e.isError })
        break
      }
    }
    touch(dir, L, msg.id)
  }

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = runTurn({
        bin: brain.bin, cwd: path.join(home, 'memory'), prompt, system: SYSTEM,
        sessionId: chat.sessionId, resume: chat.started, model, addDirs,
        mcpUrl: `${opts.origin()}/coop/assistant/mcp`, mcpToken: token, configDir: opts.claudeConfigDir?.(), onEvent,
      })
      L.turn = { stop: run.stop, msgId: msg.id }
      touch(dir, L, msg.id)
      const r = await run.done
      if (!r.ok && r.lostSession && attempt === 0) {
        // Phiên cũ không còn: mở phiên mới, Trợ lý vẫn có bộ nhớ + lịch sử tóm tắt trong bối cảnh
        chat.sessionId = randomUUID()
        chat.started = false
        msg.parts = []
        continue
      }
      if (!r.ok) Object.assign(msg, { error: r.error, needLogin: r.needLogin || undefined })
      break
    }
  } finally {
    tokens.delete(token)
    L.turn = null
    msg.live = false
    // Lượt bị dừng / lỗi: bỏ khối chữ trống
    msg.parts = msg.parts.filter((p) => p.k !== 'text' || p.text.trim())
    touch(dir, L, msg.id)
  }
}

// ── Tự báo ──

const proactive = (L: Live) => L.chat.prefs?.proactive !== false

/** Quét công ty mỗi POLL_MS khi có trang đang mở (trang đóng hết thì thôi) */
function startWatch(opts: AssistantOpts, L: Live) {
  if (L.poll) return
  const tick = async () => {
    if (!L.clients.size) {
      if (L.poll) clearInterval(L.poll)
      L.poll = null
      return
    }
    try {
      const { next, notices } = await scan(pcClient(opts.target()), L.cid, L.chat.watch)
      L.chat.watch = next
      // Tắt tự báo thì vẫn cập nhật mốc, để lúc bật lại không báo dồn
      if (proactive(L) && notices.length) {
        L.auto.notices.push(...notices)
        scheduleAuto(opts, L, SETTLE_MS)
      }
      checkBrief(opts, L)
      scheduleSave(opts.dir, L)
    } catch { /* Paperclip tắt: lần sau */ }
  }
  L.poll = setInterval(() => void tick(), POLL_MS)
  void tick()
}

/** Lần đầu mở game trong ngày (từ 5 giờ sáng): tóm tắt đầu ngày, nếu công ty đã có ticket */
function checkBrief(opts: AssistantOpts, L: Live) {
  const w = L.chat.watch
  const today = vnDay()
  if (!w || w.day === today || vnHour() < BRIEF_FROM) return
  w.day = today
  if (!proactive(L) || !Object.keys(w.issues).length) return
  L.auto.brief = true
  scheduleAuto(opts, L, 3000)
}

function scheduleAuto(opts: AssistantOpts, L: Live, delay: number) {
  if (L.auto.timer) return
  const wait = Math.max(delay, L.auto.last + AUTO_GAP_MS - Date.now())
  L.auto.timer = setTimeout(() => {
    L.auto.timer = null
    runAuto(opts, L).catch((e) => addMsg(opts.dir, L, { role: 'system', parts: [], error: String(e) }))
  }, wait)
}

async function runAuto(opts: AssistantOpts, L: Live) {
  if (!L.auto.notices.length && !L.auto.brief) return
  if (!proactive(L)) {
    L.auto.notices = []
    L.auto.brief = false
    return
  }
  // Đang trả lời người dùng: báo sau
  if (L.turn) return scheduleAuto(opts, L, 20_000)
  const notices = L.auto.notices.splice(0)
  const brief = L.auto.brief
  L.auto.brief = false
  L.auto.last = Date.now()
  const list = notices.map((n) => `- ${n}`).join('\n')
  let prompt: string
  let shown: string
  if (brief) {
    const w = L.chat.watch
    const since = w?.briefAt ? vnTime(new Date(w.briefAt)) : 'lần trước'
    if (w) w.briefAt = Date.now()
    shown = `☀️ Tóm tắt đầu ngày${notices.length ? ` · ${notices.join(' · ')}` : ''}`
    prompt = [
      `[Tự động: tóm tắt đầu ngày, người dùng không gõ tin này] Từ ${since} tới giờ.`,
      notices.length ? `Việc mới:\n${list}` : '',
      'Xem ticket (list_issues) rồi tóm tắt thật ngắn: việc đã xong, đang làm, đang chờ người dùng quyết; gợi ý 1–3 việc nên làm hôm nay (việc giao được thì đề xuất bằng thẻ). Không có gì mới thì chào một câu là đủ.',
    ].filter(Boolean).join('\n')
  } else {
    shown = `🔔 ${notices.join(' · ')}`
    prompt = [
      '[Tự động: Pixel Company báo việc mới, người dùng không gõ tin này]',
      list,
      'Báo người dùng thật ngắn (1–3 dòng). Ticket xong / chờ xem lại: đọc kết quả (get_issue) nếu cần; có việc tiếp theo hợp lý thì đề xuất giao bằng thẻ, không có thì thôi. Việc cần quyết: nói họ cần quyết gì (phím Q trong game).',
    ].join('\n')
  }
  await turn(opts, L, prompt, undefined, shown)
}

/** Duyệt (approve, kèm giá trị ô bảo mật) hoặc làm tiếp sau khi người dùng đăng nhập trên web (cont) */
async function decide(opts: AssistantOpts, L: Live, p: Proposal, step: 'approve' | 'cont', values: Record<string, string>) {
  const action = actionOf(p.kind)
  const ctx = { cid: L.cid, pc: pcClient(opts.target()), claudeConfigDir: opts.claudeConfigDir?.() }
  p.status = 'running'
  touch(opts.dir, L, undefined, p.id)
  try {
    if (!action || (step === 'cont' && !action.cont)) throw new Error('Bản Pixel Company này không làm được thẻ này nữa')
    const r = step === 'approve' ? await action.apply(ctx, p.data, values) : await action.cont!(ctx, p.data)
    if ('wait' in r) {
      Object.assign(p.data, r.wait.data ?? {})
      p.status = 'waiting'
      p.link = r.wait.link
      p.result = r.wait.note
      L.chat.events.push(`Người dùng đã duyệt "${p.title}"; đang chờ họ đăng nhập trên web rồi bấm "Xong rồi".`)
    } else {
      p.status = 'done'
      p.link = undefined
      p.result = r.result
      if (p.kind === 'create_project') {
        const folder = path.normalize(String(p.data.folder)).toLowerCase()
        L.chat.folders = L.chat.folders.filter((f) => path.normalize(f).toLowerCase() !== folder)
      }
      L.chat.events.push(`Người dùng đã DUYỆT "${p.title}". Kết quả: ${p.result}`)
    }
  } catch (e) {
    // Khoá người dùng vừa nhập có thể lọt vào câu báo lỗi của Paperclip: che đi trước khi lưu / báo cho Trợ lý
    let msg = e instanceof Error ? e.message : String(e)
    for (const v of Object.values(values)) if (v.length >= 4) msg = msg.split(v).join('***')
    p.status = 'failed'
    p.result = msg
    L.chat.events.push(`Người dùng duyệt "${p.title}" nhưng làm không được: ${msg}`)
  }
  touch(opts.dir, L, undefined, p.id)
}

// ── HTTP ──

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let s = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      s += c
      if (s.length > max) { reject(new Error('quá dài')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}) } catch { reject(new Error('không phải JSON')) }
    })
    req.on('error', reject)
  })
}

export interface AssistantOpts {
  target: () => string
  isOwnOrigin: (o: unknown) => boolean
  /** Thư mục dữ liệu Pixel Company */
  dir: string
  /** Địa chỉ server này (CLI gọi MCP vào đây) */
  origin: () => string
  /** CLAUDE_CONFIG_DIR cho Trợ lý (trống = bản đăng nhập mặc định của máy) */
  claudeConfigDir?: () => string | undefined
}

const asObj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function assistantHandler(opts: AssistantOpts): Handler {
  const { dir } = opts
  const fail = (res: ServerResponse) => (e: unknown) => { if (!res.headersSent) send(res, 400, { error: `coopverse: ${e instanceof Error ? e.message : e}` }) }

  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/coop/assistant/')) return next()
    const method = (req.method ?? 'GET').toUpperCase()
    const seg = url.slice('/coop/assistant/'.length).split('/')

    // MCP cho CLI: không phải trang web nên không có origin, chỉ kiểm khoá của lượt đang chạy
    if (seg[0] === 'mcp') {
      if (method !== 'POST') return send(res, 405, { error: 'chỉ hỗ trợ POST' })
      const tok = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1]
      const t = tok ? tokens.get(tok) : undefined
      if (!t) return send(res, 401, { error: 'khoá không hợp lệ' })
      readBody(req, 1_000_000).then(async (body) => {
        const L = await loadLive(dir, t.cid)
        const ctx: ToolCtx = {
          cid: t.cid,
          pc: pcClient(opts.target()),
          memDir: path.join(homeOf(dir, t.cid), 'memory'),
          propose: (d) => {
            const p: Proposal = { ...d, id: randomUUID(), at: Date.now(), status: 'pending' }
            L.chat.proposals[p.id] = p
            const m = L.chat.messages.find((x) => x.id === t.msgId)
            m?.parts.push({ k: 'proposal', id: p.id })
            touch(dir, L, t.msgId, p.id)
            return { id: p.id }
          },
        }
        await mcpHandler(res, body, ctx)
      }).catch(fail(res))
      return
    }

    const [cid, action, pid, verb] = seg
    if (!cid || !UUID.test(cid)) return send(res, 404, { error: 'coopverse: không có công ty này' })

    if (action === 'events' && method === 'GET') {
      loadLive(dir, cid).then((L) => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
        sse(res, { type: 'state', state: publicState(L) })
        L.clients.add(res)
        startWatch(opts, L)
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
        req.on('close', () => { clearInterval(ping); L.clients.delete(res) })
      }).catch(fail(res))
      return
    }

    if (method !== 'POST') return send(res, 405, { error: 'coopverse: sai phương thức' })
    if (req.headers['x-coopverse'] !== '1' || !opts.isOwnOrigin(req.headers.origin)) {
      return send(res, 403, { error: 'coopverse: lệnh phải gửi từ trang Pixel Company' })
    }

    readBody(req, 64_000).then(async (raw) => {
      const body = asObj(raw)
      const L = await loadLive(dir, cid)

      if (action === 'send') {
        if (L.turn) return send(res, 409, { error: 'Trợ lý đang trả lời, chờ chút hoặc bấm Dừng' })
        let text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : ''
        const model = typeof body.model === 'string' && MODEL.test(body.model) ? body.model : undefined
        if (typeof body.folder === 'string' && body.folder.trim()) {
          const folder = path.normalize(body.folder.trim())
          const bad = folderProblem(folder)
          if (bad) return send(res, 400, { error: bad })
          if (!L.chat.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) L.chat.folders.push(folder)
          text ||= `Tôi muốn làm việc ở thư mục ${folder}`
        }
        if (!text) return send(res, 400, { error: 'Tin nhắn trống' })
        if (model) L.chat.prefs = { ...L.chat.prefs, model }
        send(res, 202, { ok: true })
        turn(opts, L, text, model).catch((e) => addMsg(dir, L, { role: 'system', parts: [], error: String(e) }))
        return
      }

      if (action === 'prefs') {
        const p = { ...L.chat.prefs }
        if (typeof body.model === 'string' && MODEL.test(body.model)) p.model = body.model
        else if (body.model === '') delete p.model
        if (typeof body.proactive === 'boolean') p.proactive = body.proactive
        L.chat.prefs = p
        scheduleSave(dir, L)
        return send(res, 200, { ok: true })
      }

      if (action === 'login') {
        const b = findClaude()
        if (!b.ok) return send(res, 400, { error: b.error })
        return openLogin(b.bin, opts.claudeConfigDir?.())
          ? send(res, 200, { ok: true })
          : send(res, 400, { error: 'Mở terminal, chạy "claude" rồi gõ /login' })
      }

      if (action === 'stop') {
        L.turn?.stop()
        return send(res, 200, { ok: true })
      }

      if (action === 'reset') {
        if (L.turn) return send(res, 409, { error: 'Dừng lượt đang chạy trước' })
        const old = L.chat
        L.chat = { ...newChat(), folders: old.folders, watch: old.watch, prefs: old.prefs }
        addMsg(dir, L, { role: 'system', parts: [{ k: 'text', text: 'Cuộc trò chuyện mới. Trợ lý vẫn nhớ những gì đã ghi vào bộ nhớ.' }] })
        resetAll(L)
        return send(res, 200, { ok: true })
      }

      if (action === 'proposals' && pid && (verb === 'approve' || verb === 'reject' || verb === 'continue')) {
        const p = L.chat.proposals[pid]
        if (!p) return send(res, 404, { error: 'Không còn thẻ này' })
        const open = p.status === 'pending' || (p.status === 'waiting' && verb !== 'approve')
        if (!open) return send(res, 409, { error: verb === 'continue' ? 'Thẻ này không chờ đăng nhập' : 'Thẻ này đã được quyết rồi' })
        if (verb === 'continue' && p.status !== 'waiting') return send(res, 409, { error: 'Thẻ này chưa được duyệt' })
        if (verb === 'reject') {
          p.status = 'rejected'
          L.chat.events.push(`Người dùng BỎ đề xuất "${p.title}"${typeof body.note === 'string' && body.note.trim() ? `, ghi chú: ${body.note.trim().slice(0, 500)}` : ''}`)
          touch(dir, L, undefined, p.id)
          return send(res, 200, { ok: true })
        }
        const values: Record<string, string> = {}
        const given = asObj(body.values)
        for (const f of p.fields ?? []) {
          const v = typeof given[f.key] === 'string' ? (given[f.key] as string).trim() : ''
          if (v.length > 16_000) return send(res, 400, { error: `${f.label} quá dài` })
          if (v) values[f.key] = v
          else if (!f.optional && verb === 'approve') return send(res, 400, { error: `Chưa nhập ${f.label}` })
        }
        await decide(opts, L, p, verb === 'approve' ? 'approve' : 'cont', values)
        // decide() đổi p.status (TS không theo được qua lời gọi hàm)
        const st = p.status as ProposalStatus
        return st === 'done' || st === 'waiting' ? send(res, 200, { ok: true }) : send(res, 400, { error: p.result })
      }

      send(res, 404, { error: 'coopverse: không có lệnh này' })
    }).catch(fail(res))
  }
}

/** Vite: dev (5179) và preview (5180). Đặt trước coopData (cái đó trả 403 cho mọi /coop/ lạ). */
export function assistant(opts: { target: string; isOwnOrigin: (o: unknown) => boolean; claudeConfigDir?: string }): Plugin {
  const dir = path.resolve(process.cwd(), '.coopverse')
  const make = (port: () => number | undefined, def: number) =>
    assistantHandler({
      target: () => opts.target, isOwnOrigin: opts.isOwnOrigin, dir,
      origin: () => `http://127.0.0.1:${port() ?? def}`, claudeConfigDir: () => opts.claudeConfigDir,
    })
  return {
    name: 'coopverse-assistant',
    configureServer(server) { server.middlewares.use(make(() => server.config.server.port, 5179)) },
    configurePreviewServer(server) { server.middlewares.use(make(() => server.config.preview.port, 5180)) },
  }
}
