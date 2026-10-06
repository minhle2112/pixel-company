import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Công cụ của Trợ lý (gọi qua MCP "coopverse"). Nhóm đọc chạy ngay; nhóm `propose_*` chỉ tạo thẻ đề xuất,
 * người dùng bấm Duyệt trong khung chat thì server mới làm thật (server/assistant/index.ts `approve`).
 */

// ── Paperclip ──

export class PcError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface Pc {
  get: <T = any>(p: string) => Promise<T>
  post: <T = any>(p: string, body: unknown) => Promise<T>
  patch: <T = any>(p: string, body: unknown) => Promise<T>
  put: <T = any>(p: string, body: unknown) => Promise<T>
}

export function pcClient(target: string): Pc {
  const call = async <T>(method: string, p: string, body?: unknown): Promise<T> => {
    let r: Response
    try {
      r = await fetch(`${target}/api${p}`, {
        method,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new PcError(0, 'Không kết nối được Paperclip')
    }
    if (!r.ok) {
      let msg = `Paperclip trả ${r.status} cho ${method} ${p}`
      try {
        const j = (await r.json()) as { error?: unknown; message?: unknown }
        const e = typeof j.error === 'string' ? j.error : typeof j.message === 'string' ? j.message : ''
        if (e) msg += `: ${e}`
      } catch { /* không phải JSON */ }
      throw new PcError(r.status, msg)
    }
    const text = await r.text()
    return (text ? JSON.parse(text) : null) as T
  }
  return {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b),
  }
}

export interface PcProject {
  id: string; name: string; description: string | null; status: string; archivedAt: string | null; taskCount?: number
  primaryWorkspace: { cwd?: string | null } | null
  codebase?: { localFolder?: string | null; effectiveLocalFolder?: string | null } | null
}
export interface PcAgent {
  id: string; name: string; role: string; title: string | null; status: string; reportsTo: string | null; adapterType: string
  adapterConfig?: { model?: string; cwd?: string; effort?: string } | null
  permissions?: { canCreateAgents?: boolean; canAssignTasks?: boolean } | null
  errorReason?: string | null; pauseReason?: string | null; budgetMonthlyCents?: number; spentMonthlyCents?: number
}
export interface PcIssue {
  id: string; identifier: string; title: string; status: string; priority: string | null; projectId: string | null
  assigneeAgentId: string | null; updatedAt: string; description?: string | null; parentId?: string | null
}

/** Thư mục làm việc của project: thư mục người dùng gắn, không có thì thư mục Paperclip tự quản */
export const projectFolder = (p: PcProject) =>
  p.codebase?.localFolder || p.primaryWorkspace?.cwd || p.codebase?.effectiveLocalFolder || null

export const liveProjects = async (pc: Pc, cid: string) =>
  (await pc.get<PcProject[]>(`/companies/${cid}/projects`)).filter((p) => !p.archivedAt)

export const OPEN = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'blocked'])

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const vnTime = (d = new Date()) =>
  d.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).slice(0, 16)

/** Bảng tóm tắt công ty (đầu mỗi tin nhắn + công cụ company_overview) */
export async function overview(pc: Pc, cid: string, full = false): Promise<string> {
  const [co, projects, agents, issues] = await Promise.all([
    pc.get<{ name: string; issuePrefix: string; description: string | null }>(`/companies/${cid}`),
    liveProjects(pc, cid),
    pc.get<PcAgent[]>(`/companies/${cid}/agents`),
    pc.get<PcIssue[]>(`/companies/${cid}/issues`),
  ])
  const byId = new Map(agents.map((a) => [a.id, a]))
  const open = issues.filter((i) => OPEN.has(i.status))
  const lines = [`Giờ VN: ${vnTime()}`, `Công ty: ${co.name} (mã ticket ${co.issuePrefix})${co.description ? ` · ${clip(co.description, 160)}` : ''}`]
  lines.push(projects.length ? 'Project:' : 'Project: (chưa có project nào)')
  for (const p of projects) {
    const n = open.filter((i) => i.projectId === p.id).length
    lines.push(`- ${p.name} · thư mục ${projectFolder(p) ?? '(chưa có)'} · ${p.status} · ${n} ticket chưa xong`)
  }
  const staff = agents.filter((a) => a.status !== 'terminated')
  lines.push(staff.length ? 'Agent:' : 'Agent: (chưa có agent nào)')
  for (const a of staff) {
    const doing = open.find((i) => i.assigneeAgentId === a.id && i.status === 'in_progress')
    const boss = a.reportsTo ? byId.get(a.reportsTo)?.name : null
    lines.push(`- ${a.name} (${a.title || a.role}${boss ? `, báo cáo cho ${boss}` : ''}) · ${a.status}${doing ? ` · đang làm ${doing.identifier}` : ''}${full ? ` · ${a.adapterType}${a.adapterConfig?.model ? ` ${a.adapterConfig.model}` : ''} · id ${a.id}` : ''}`)
  }
  const count = (s: string) => open.filter((i) => i.status === s).length
  lines.push(`Ticket chưa xong: ${open.length}${open.length ? ` (backlog ${count('backlog')}, todo ${count('todo')}, đang làm ${count('in_progress')}, chờ duyệt ${count('in_review')}, bị chặn ${count('blocked')})` : ''}`)
  return lines.join('\n')
}

// ── Bộ nhớ ──

export const INDEX = '_INDEX.md'
const MEM_FILE = /^[\p{L}\p{N} _.\-()/]+\.md$/u

/** Đường dẫn file nhớ an toàn bên trong `dir` (không cho thoát ra ngoài, chỉ file .md) */
function memPath(dir: string, file: string) {
  const f = file.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!MEM_FILE.test(f) || f.split('/').some((s) => s === '..' || s === '.')) throw new Error('Tên file nhớ không hợp lệ (chỉ file .md, không có ..)')
  const p = path.resolve(dir, f)
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('File nhớ phải nằm trong thư mục bộ nhớ')
  return p
}

async function listMd(dir: string, rel = ''): Promise<string[]> {
  let out: string[] = []
  let ents
  try { ents = await readdir(path.join(dir, rel), { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out = out.concat(await listMd(dir, r))
    else if (e.name.endsWith('.md')) out.push(r)
  }
  return out
}

export const projectMemDir = (folder: string) => path.join(folder, '.coopverse', 'memory')

const PROJECT_INDEX = (name: string) => `# Bộ nhớ project ${name}

Ghi chú chung của Trợ lý và các agent làm trong thư mục này. Mỗi phiên làm việc: đọc file này trước, rồi các note liên quan.

## Note
(chưa có)
`

const CLAUDE_MD_MARK = '.coopverse/memory'
const CLAUDE_MD_SECTION = `
## Bộ nhớ chung (Pixel Company)
- Đầu mỗi phiên: đọc \`.coopverse/memory/_INDEX.md\`, rồi các note liên quan trong \`.coopverse/memory/\`.
- Học được điều đáng nhớ (quy ước, quyết định, lỗi hay gặp): ghi thành note ngắn trong \`.coopverse/memory/\` và thêm một dòng vào \`_INDEX.md\`.
- Không ghi mật khẩu, khoá API, token.
`

/** Tạo bộ nhớ trong thư mục project + nhắc trong CLAUDE.md (agent Claude tự đọc CLAUDE.md). Trả về mô tả việc đã làm. */
export async function initProjectMemory(folder: string, name: string): Promise<string[]> {
  const done: string[] = []
  const dir = projectMemDir(folder)
  await mkdir(dir, { recursive: true })
  const idx = path.join(dir, INDEX)
  if (!existsSync(idx)) {
    await writeFile(idx, PROJECT_INDEX(name), 'utf8')
    done.push('tạo .coopverse/memory/_INDEX.md')
  }
  const cm = path.join(folder, 'CLAUDE.md')
  const old = existsSync(cm) ? await readFile(cm, 'utf8') : null
  if (old === null) {
    await writeFile(cm, `# ${name}\n${CLAUDE_MD_SECTION}`, 'utf8')
    done.push('tạo CLAUDE.md')
  } else if (!old.includes(CLAUDE_MD_MARK)) {
    await writeFile(cm, `${old.replace(/\s*$/, '\n')}${CLAUDE_MD_SECTION}`, 'utf8')
    done.push('thêm mục "Bộ nhớ chung" vào cuối CLAUDE.md')
  }
  return done
}

/** Thư mục có dùng làm project được không. Trả về lỗi, hoặc null nếu được. */
export function folderProblem(folder: string): string | null {
  if (!folder || !path.isAbsolute(folder)) return 'Cần đường dẫn đầy đủ (vd C:\\Users\\ban\\du-an)'
  try {
    if (!statSync(folder).isDirectory()) return 'Đây là file, không phải thư mục'
  } catch {
    return 'Không tìm thấy thư mục này'
  }
  return null
}

// ── Công cụ ──

/** Ô nhập trên thẻ duyệt (khoá API, token…): người dùng gõ lúc bấm Duyệt, giá trị đi thẳng vào Paperclip, model không thấy */
export interface ProposalField {
  key: string
  label: string
  secret?: boolean
  optional?: boolean
  placeholder?: string
}

export interface ProposalDraft {
  kind: string
  title: string
  /** Vài dòng mô tả cho thẻ duyệt */
  lines: string[]
  /** Nội dung dài (AGENTS.md, mô tả ticket…): thẻ hiện dạng gập lại */
  detail?: string
  fields?: ProposalField[]
  data: Record<string, unknown>
}

export interface ToolCtx {
  cid: string
  pc: Pc
  /** Bộ nhớ cấp công ty */
  memDir: string
  propose: (d: ProposalDraft) => { id: string }
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<string>
}

export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
export const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false })
export const S = (description: string) => ({ type: 'string', description })

/** Tìm theo id, tên đúng, rồi tên gần đúng */
export function pick<T extends { id: string; name: string }>(list: T[], ref: string): T | null {
  const r = ref.trim().toLowerCase()
  if (!r) return null
  return list.find((a) => a.id === ref.trim()) ?? list.find((a) => a.name.toLowerCase() === r) ?? list.find((a) => a.name.toLowerCase().includes(r)) ?? null
}

export async function findAgent(ctx: Pick<ToolCtx, 'pc' | 'cid'>, ref: string) {
  const agents = await ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`)
  return pick(agents.filter((a) => a.status !== 'terminated'), ref)
}

export async function findProject(ctx: Pick<ToolCtx, 'pc' | 'cid'>, ref: string) {
  return pick(await liveProjects(ctx.pc, ctx.cid), ref)
}

async function memDirOf(ctx: ToolCtx, args: Record<string, unknown>) {
  if (str(args.scope) !== 'project') return ctx.memDir
  const p = await findProject(ctx, str(args.project))
  if (!p) throw new Error(`Không thấy project "${str(args.project)}"`)
  const f = projectFolder(p)
  if (!f || !existsSync(f)) throw new Error(`Project ${p.name} chưa có thư mục trên máy`)
  return projectMemDir(f)
}

export const READ_TOOLS: Tool[] = [
  {
    name: 'company_overview',
    description: 'Tóm tắt công ty hiện tại: các project (kèm thư mục), agent (vai trò, trạng thái, model, id), số ticket chưa xong.',
    inputSchema: obj({}),
    run: (ctx) => overview(ctx.pc, ctx.cid, true),
  },
  {
    name: 'list_issues',
    description: 'Danh sách ticket. Mặc định: các ticket chưa xong, mới cập nhật trước.',
    inputSchema: obj({
      status: S('Lọc trạng thái: open (mặc định), all, backlog, todo, in_progress, in_review, blocked, done, cancelled'),
      project: S('Tên hoặc id project'),
      agent: S('Tên hoặc id agent được giao'),
      limit: { type: 'number', description: 'Tối đa (mặc định 30, tối đa 100)' },
    }),
    run: async (ctx, a) => {
      let list = await ctx.pc.get<PcIssue[]>(`/companies/${ctx.cid}/issues`)
      const st = str(a.status) || 'open'
      if (st === 'open') list = list.filter((i) => OPEN.has(i.status))
      else if (st !== 'all') list = list.filter((i) => i.status === st)
      if (str(a.project)) {
        const p = await findProject(ctx, str(a.project))
        if (!p) return `Không thấy project "${str(a.project)}"`
        list = list.filter((i) => i.projectId === p.id)
      }
      const agents = await ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`)
      const name = new Map(agents.map((x) => [x.id, x.name]))
      if (str(a.agent)) {
        const ag = await findAgent(ctx, str(a.agent))
        if (!ag) return `Không thấy agent "${str(a.agent)}"`
        list = list.filter((i) => i.assigneeAgentId === ag.id)
      }
      const n = Math.min(100, Math.max(1, Number(a.limit) || 30))
      list.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
      if (!list.length) return 'Không có ticket nào khớp.'
      return list.slice(0, n).map((i) =>
        `${i.identifier} · ${i.status}${i.priority ? ` · ${i.priority}` : ''} · ${i.assigneeAgentId ? name.get(i.assigneeAgentId) ?? '?' : 'chưa giao'} · ${i.title}`,
      ).join('\n') + (list.length > n ? `\n… còn ${list.length - n} ticket` : '')
    },
  },
  {
    name: 'get_issue',
    description: 'Chi tiết một ticket: mô tả và các bình luận gần nhất.',
    inputSchema: obj({ key: S('Mã ticket, vd COO-12') }, ['key']),
    run: async (ctx, a) => {
      const key = str(a.key)
      const i = await ctx.pc.get<PcIssue & { companyId: string }>(`/issues/${encodeURIComponent(key)}`)
      if (i.companyId !== ctx.cid) return `${key} không thuộc công ty này`
      const comments = await ctx.pc.get<{ body: string; createdAt: string; authorAgentId: string | null; deletedAt: string | null }[]>(`/issues/${i.id}/comments`)
      const agents = await ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`)
      const name = new Map(agents.map((x) => [x.id, x.name]))
      const cs = comments.filter((c) => !c.deletedAt).sort((x, y) => x.createdAt.localeCompare(y.createdAt)).slice(-8)
      return [
        `${i.identifier} · ${i.title}`,
        `Trạng thái ${i.status} · ưu tiên ${i.priority ?? '-'} · giao cho ${i.assigneeAgentId ? name.get(i.assigneeAgentId) ?? '?' : 'chưa giao'}`,
        '', 'Mô tả:', clip(i.description || '(trống)', 6000),
        '', `Bình luận gần nhất (${cs.length}/${comments.length}):`,
        ...cs.map((c) => `--- ${c.authorAgentId ? name.get(c.authorAgentId) ?? 'agent' : 'người dùng'} · ${vnTime(new Date(c.createdAt))}\n${clip(c.body, 1500)}`),
      ].join('\n')
    },
  },
  {
    name: 'agent_detail',
    description: 'Chi tiết một agent: loại / model, thư mục làm việc, quyền, ngân sách, và nội dung AGENTS.md (hướng dẫn của agent).',
    inputSchema: obj({ agent: S('Tên hoặc id agent') }, ['agent']),
    run: async (ctx, a) => {
      const ag = await findAgent(ctx, str(a.agent))
      if (!ag) return `Không thấy agent "${str(a.agent)}"`
      let md = ''
      try {
        const f = await ctx.pc.get<{ content?: string }>(`/agents/${ag.id}/instructions-bundle/file?path=AGENTS.md`)
        md = f.content ?? ''
      } catch { md = '(không đọc được AGENTS.md)' }
      const c = ag.adapterConfig ?? {}
      return [
        `${ag.name} · ${ag.title || ag.role} · ${ag.status}${ag.errorReason ? ` (${ag.errorReason})` : ''}${ag.pauseReason ? ` (tạm dừng: ${ag.pauseReason})` : ''}`,
        `Loại: ${ag.adapterType}${c.model ? ` · model ${c.model}` : ''}${c.effort ? ` · effort ${c.effort}` : ''}`,
        `Thư mục làm việc: ${c.cwd ?? '(theo project của ticket)'}`,
        `Quyền: thuê agent ${ag.permissions?.canCreateAgents ? 'có' : 'không'} · giao việc ${ag.permissions?.canAssignTasks ? 'có' : 'không'}`,
        `Ngân sách tháng: ${ag.budgetMonthlyCents ? `$${(ag.budgetMonthlyCents / 100).toFixed(2)}` : 'không giới hạn'} · đã dùng $${((ag.spentMonthlyCents ?? 0) / 100).toFixed(2)}`,
        '', 'AGENTS.md:', clip(md || '(trống)', 8000),
      ].join('\n')
    },
  },
  {
    name: 'recent_runs',
    description: 'Các lượt chạy gần nhất của agent (hoặc cả công ty): trạng thái, ticket, lỗi.',
    inputSchema: obj({ agent: S('Tên hoặc id agent (bỏ trống = cả công ty)'), limit: { type: 'number', description: 'Tối đa (mặc định 10, tối đa 30)' } }),
    run: async (ctx, a) => {
      const ag = str(a.agent) ? await findAgent(ctx, str(a.agent)) : null
      if (str(a.agent) && !ag) return `Không thấy agent "${str(a.agent)}"`
      const n = Math.min(30, Math.max(1, Number(a.limit) || 10))
      const runs = await ctx.pc.get<{ agentId: string; status: string; startedAt: string | null; finishedAt: string | null; error: string | null; contextSnapshot?: { issueId?: string } | null }[]>(
        `/companies/${ctx.cid}/heartbeat-runs?limit=${n}${ag ? `&agentId=${ag.id}` : ''}`,
      )
      const agents = await ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`)
      const name = new Map(agents.map((x) => [x.id, x.name]))
      if (!runs.length) return 'Chưa có lượt chạy nào.'
      return runs.map((r) =>
        `${r.startedAt ? vnTime(new Date(r.startedAt)) : '?'} · ${name.get(r.agentId) ?? '?'} · ${r.status}${r.error ? ` · lỗi: ${clip(r.error, 300)}` : ''}`,
      ).join('\n')
    },
  },
  {
    name: 'memory_read',
    description: 'Đọc bộ nhớ. scope "company": bộ nhớ chung của công ty; "project": .coopverse/memory/ trong thư mục project. Bỏ trống file: trả _INDEX.md và danh sách file.',
    inputSchema: obj({ scope: { type: 'string', enum: ['company', 'project'] }, project: S('Tên project (khi scope = project)'), file: S('Đường dẫn file .md trong thư mục nhớ') }, ['scope']),
    run: async (ctx, a) => {
      const dir = await memDirOf(ctx, a)
      if (str(a.file)) {
        try { return await readFile(memPath(dir, str(a.file)), 'utf8') } catch { return `Chưa có file ${str(a.file)}` }
      }
      const files = await listMd(dir)
      let idx = '(chưa có _INDEX.md)'
      try { idx = await readFile(path.join(dir, INDEX), 'utf8') } catch { /* chưa có */ }
      return `${idx}\n\n---\nFile: ${files.length ? files.join(', ') : '(trống)'}`
    },
  },
  {
    name: 'memory_write',
    description: 'Ghi (thay cả file) một note .md trong bộ nhớ. Nhớ cập nhật _INDEX.md khi thêm note mới. Không ghi mật khẩu / khoá / token.',
    inputSchema: obj({ scope: { type: 'string', enum: ['company', 'project'] }, project: S('Tên project (khi scope = project)'), file: S('vd _INDEX.md hoặc quyet-dinh/2026-10-06 Doi agent.md'), content: S('Nội dung đầy đủ của file') }, ['scope', 'file', 'content']),
    run: async (ctx, a) => {
      const content = typeof a.content === 'string' ? a.content : ''
      if (content.length > 30_000) return 'Note quá dài (tối đa 30 000 ký tự): tách thành nhiều note.'
      const dir = await memDirOf(ctx, a)
      const p = memPath(dir, str(a.file))
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, content, 'utf8')
      return `Đã ghi ${str(a.file)}`
    },
  },
  {
    name: 'list_skills',
    description: 'Skill (kỹ năng) cho agent: skill công ty đã có, kho skill có sẵn để cài, và skill của một agent (nếu chỉ định).',
    inputSchema: obj({ agent: S('Tên hoặc id agent (xem skill của agent đó)') }),
    run: async (ctx, a) => {
      const [own, catalog] = await Promise.all([
        ctx.pc.get<PcSkill[]>(`/companies/${ctx.cid}/skills`),
        ctx.pc.get<CatalogSkill[]>('/skills/catalog').catch(() => [] as CatalogSkill[]),
      ])
      const have = new Set(own.map((x) => x.name))
      const out = [
        'Skill công ty đã có (key · tên · số agent dùng):',
        ...own.map((x) => `- ${x.key} · ${x.name} · ${x.attachedAgentCount ?? 0} agent · ${clip(x.description ?? '', 120)}`),
        '', 'Kho skill có thể cài (catalog id · tên · nhóm · hợp với vai trò):',
        ...catalog.filter((x) => !have.has(x.name)).map((x) =>
          `- ${x.id} · ${x.name} · ${x.category}${x.recommendedForRoles?.length ? ` · ${x.recommendedForRoles.join('/')}` : ''} · ${clip(x.description, 140)}`),
      ]
      if (str(a.agent)) {
        const ag = await findAgent(ctx, str(a.agent))
        if (!ag) return `Không thấy agent "${str(a.agent)}"`
        const sk = await ctx.pc.get<{ desiredSkills?: string[]; supported?: boolean }>(`/agents/${ag.id}/skills`)
        out.push('', `Skill của ${ag.name}: ${sk.supported === false ? '(loại agent này không hỗ trợ skill)' : sk.desiredSkills?.length ? sk.desiredSkills.join(', ') : '(chưa có)'}`)
      }
      out.push('', 'Ngoài kho còn cài được từ nguồn khác (link GitHub…) bằng propose_install_skill với source.')
      return out.join('\n')
    },
  },
  {
    name: 'list_connectors',
    description: 'Connector (kết nối app ngoài cho agent: GitHub, Slack, Notion, Google…): app kết nối được (slug, cách đăng nhập) và các kết nối công ty đang có.',
    inputSchema: obj({ search: S('Lọc theo tên app') }),
    run: async (ctx, a) => {
      const [gallery, conns] = await Promise.all([
        ctx.pc.get<{ apps: GalleryApp[] }>(`/companies/${ctx.cid}/tools/gallery`),
        ctx.pc.get<{ connections: { name: string; status: string; healthStatus?: string }[] }>(`/companies/${ctx.cid}/tools/connections`),
      ])
      const q = str(a.search).toLowerCase()
      const lines = ['Kết nối đang có:', ...(conns.connections.length ? conns.connections.map((c) => `- ${c.name} · ${c.status}${c.healthStatus ? ` · ${c.healthStatus}` : ''}`) : ['(chưa có)'])]
      lines.push('', 'App kết nối được (slug · tên · [method: cách đăng nhập, ô cấu hình bắt buộc]):')
      for (const x of gallery.apps) {
        if (q && !x.slug.includes(q) && !x.name.toLowerCase().includes(q)) continue
        const ms = connectorMethods(x)
        if (!ms.length) continue
        const how = (m: GalleryMethod) =>
          (m.auth === 'oauth' ? 'đăng nhập trên web'
            : m.auth === 'api_key' ? `khoá: ${(m.credentialFields ?? []).map((f) => f.label).join(', ')}`
              : m.key === 'generated-url' ? 'dán URL do app tạo' : 'không cần đăng nhập')
          + requiredConfig(m).map((f) => `, cần config.${f.key} (${f.label})`).join('')
        lines.push(`- ${x.slug} · ${x.name} · ${clip(x.description, 90)} · ${ms.map((m) => `[${m.key}: ${how(m)}]`).join(' ')}`)
      }
      return lines.join('\n')
    },
  },
  {
    name: 'list_routines',
    description: 'Việc định kỳ (routine): tiêu đề, id, giao cho ai, lịch chạy, trạng thái.',
    inputSchema: obj({}),
    run: async (ctx) => {
      const [rs, agents] = await Promise.all([
        ctx.pc.get<PcRoutine[]>(`/companies/${ctx.cid}/routines`),
        ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`),
      ])
      if (!rs.length) return 'Chưa có việc định kỳ nào.'
      const name = new Map(agents.map((x) => [x.id, x.name]))
      const out: string[] = []
      for (const r of rs) {
        const triggers = r.triggers ?? (await ctx.pc.get<PcRoutine>(`/routines/${r.id}`).catch(() => null))?.triggers ?? []
        const when = triggers.filter((t) => t.kind === 'schedule')
          .map((t) => `${t.label ? `${t.label} ` : ''}(${t.cronExpression} ${t.timezone ?? ''}${t.enabled ? '' : ', đang tắt'})`).join('; ')
        out.push(`- ${r.title} · id ${r.id} · ${r.status} · ${r.assigneeAgentId ? name.get(r.assigneeAgentId) ?? '?' : 'chưa giao'} · ${when || 'không có lịch'}`)
      }
      return out.join('\n')
    },
  },
  {
    name: 'list_secrets',
    description: 'Bí mật (khoá API, token) đã lưu trong công ty: chỉ tên / key, không bao giờ có giá trị.',
    inputSchema: obj({}),
    run: async (ctx) => {
      const list = await ctx.pc.get<{ name: string; key?: string | null; status?: string; description?: string | null }[]>(`/companies/${ctx.cid}/secrets`)
      if (!list.length) return 'Chưa có bí mật nào.'
      return list.map((x) => `- ${x.name}${x.key ? ` (key ${x.key})` : ''}${x.status ? ` · ${x.status}` : ''}${x.description ? ` · ${clip(x.description, 100)}` : ''}`).join('\n')
    },
  },
  {
    name: 'budget_overview',
    description: 'Hạn mức chi tiêu: trần tháng của công ty và từng agent, đã dùng bao nhiêu.',
    inputSchema: obj({}),
    run: async (ctx) => {
      const [co, agents] = await Promise.all([
        ctx.pc.get<{ budgetMonthlyCents?: number; spentMonthlyCents?: number }>(`/companies/${ctx.cid}`),
        ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`),
      ])
      return [
        `Công ty: trần ${co.budgetMonthlyCents ? usd(co.budgetMonthlyCents) : 'không giới hạn'} · đã dùng tháng này ${usd(co.spentMonthlyCents)}`,
        ...agents.filter((x) => x.status !== 'terminated')
          .map((x) => `- ${x.name}: trần ${x.budgetMonthlyCents ? usd(x.budgetMonthlyCents) : 'không giới hạn'} · đã dùng ${usd(x.spentMonthlyCents)}`),
        'Ghi chú: agent chạy bằng gói Claude / ChatGPT đăng nhập sẵn thì không tính tiền theo token; trần chủ yếu có ý nghĩa khi dùng khoá API.',
      ].join('\n')
    },
  },
  {
    name: 'list_models',
    description: 'Các model chọn được cho một loại agent (adapter), vd claude_local, codex_local, gemini_local.',
    inputSchema: obj({ adapter: S('Loại agent, mặc định claude_local') }),
    run: async (ctx, a) => {
      const type = str(a.adapter) || 'claude_local'
      const ms = await ctx.pc.get<{ id: string; label: string }[]>(`/companies/${ctx.cid}/adapters/${encodeURIComponent(type)}/models`)
      return ms.length ? ms.map((m) => `- ${m.id} · ${m.label}`).join('\n') : 'Không lấy được danh sách model.'
    },
  },
]

export const usd = (cents?: number) => `$${((cents ?? 0) / 100).toFixed(2)}`

// ── Skill / connector / routine ──

export interface PcSkill { id: string; key: string; slug: string; name: string; description: string | null; attachedAgentCount?: number }
export interface CatalogSkill { id: string; name: string; category: string; description: string; recommendedForRoles?: string[] }

export interface GalleryField { key: string; label: string; type?: string; required?: boolean; secret?: boolean; placeholder?: string; hidden?: boolean; advanced?: boolean }
export interface GalleryMethod {
  key: string; label?: string; transport: string; auth: string; purpose?: string
  credentialFields?: GalleryField[]; tenantFields?: GalleryField[]
}
export interface GalleryApp { slug: string; name: string; description: string; methods: GalleryMethod[] }

/** Cách kết nối dùng được qua Trợ lý: app làm công cụ cho agent (MCP từ xa). Kênh chat / email / đăng nhập AI thì chưa. */
export const connectorMethods = (a: GalleryApp) => a.methods.filter((m) => m.transport === 'mcp_remote' && m.purpose !== 'channel')
/** Ô cấu hình (không bí mật) bắt buộc của một cách kết nối, vd tên miền cửa hàng Shopify */
export const requiredConfig = (m: GalleryMethod) => (m.tenantFields ?? []).filter((f) => f.required && !f.hidden)

export interface PcRoutine {
  id: string; title: string; status: string; assigneeAgentId: string | null; projectId: string | null
  triggers?: { id: string; kind: string; label: string | null; enabled: boolean; cronExpression: string | null; timezone: string | null }[]
}
