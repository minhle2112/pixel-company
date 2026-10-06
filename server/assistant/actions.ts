import path from 'node:path'
import {
  clip, connectorMethods, findAgent, findProject, folderProblem, initProjectMemory, liveProjects, obj, OPEN, pick, projectFolder, requiredConfig, S, str, usd,
  type CatalogSkill, type GalleryApp, type GalleryMethod, type Pc, type PcAgent, type PcIssue, type PcRoutine, type PcSkill,
  type ProposalDraft, type ProposalField, type Tool, type ToolCtx,
} from './tools'

/**
 * Các việc làm thay đổi công ty (thuê agent, tạo / giao ticket, skill, connector, việc định kỳ, hạn mức, bí mật…).
 * Mỗi việc có hai nửa:
 * - công cụ `propose_*` cho Trợ lý: kiểm tra, đổi tên → id, rồi chỉ hiện thẻ đề xuất;
 * - `apply`: chạy khi người dùng bấm Duyệt (server/assistant/index.ts), gọi API Paperclip thật.
 * Giá trị bí mật (khoá API, token) người dùng gõ vào ô trên thẻ lúc duyệt: đi thẳng vào `apply`, không lưu, không báo lại cho model.
 */

export interface ApplyCtx {
  cid: string
  pc: Pc
  /** CLAUDE_CONFIG_DIR của Trợ lý: agent claude_local mới dùng chung đăng nhập khi công ty chưa có agent mẫu */
  claudeConfigDir?: string
}

export type ApplyResult =
  | { result: string }
  /** Cần người dùng làm tiếp (đăng nhập trên web): thẻ hiện link + nút "Xong rồi" → `cont` */
  | { wait: { link: string; note: string; data?: Record<string, unknown> } }

interface Action {
  kind: string
  tool: Tool
  apply: (ctx: ApplyCtx, data: Record<string, unknown>, values: Record<string, string>) => Promise<ApplyResult>
  cont?: (ctx: ApplyCtx, data: Record<string, unknown>) => Promise<ApplyResult>
}

const ROLES = ['ceo', 'cto', 'cmo', 'cfo', 'security', 'engineer', 'designer', 'pm', 'qa', 'devops', 'researcher', 'general']
const ADAPTERS = ['claude_local', 'codex_local', 'gemini_local', 'opencode_local', 'cursor']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const MODEL = /^[a-zA-Z0-9._\-[\]/:]{1,80}$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,119}$/
const TZ = 'Asia/Ho_Chi_Minh'
const PRIO_VN: Record<string, string> = { critical: 'khẩn', high: 'cao', medium: 'vừa', low: 'thấp' }

const PROPOSED = (id: string) => `Đã hiện thẻ đề xuất (id ${id}). Chờ người dùng bấm Duyệt; đừng nói là đã làm xong.`
const arr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined)
const A = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
const E = (values: string[], description: string) => ({ type: 'string', enum: values, description })
const cents = (dollars: number) => Math.round(dollars * 100)
const agentsOf = (ctx: Pick<ToolCtx, 'pc' | 'cid'>) => ctx.pc.get<PcAgent[]>(`/companies/${ctx.cid}/agents`)
const staffOf = async (ctx: Pick<ToolCtx, 'pc' | 'cid'>) => (await agentsOf(ctx)).filter((a) => a.status !== 'terminated')

/** Lead = agent không báo cáo cho ai trong công ty. Pixel Company chỉ có 2 tầng: Lead và thành viên của Lead. */
const isRoot = (a: PcAgent, all: PcAgent[]) => !a.reportsTo || !all.some((x) => x.id === a.reportsTo)

function needAgents(all: PcAgent[], refs: string[]) {
  const out: PcAgent[] = []
  for (const r of refs) {
    const a = pick(all, r)
    if (!a) throw new Error(`Không thấy agent "${r}"`)
    if (!out.includes(a)) out.push(a)
  }
  return out
}

async function needAgent(ctx: Pick<ToolCtx, 'pc' | 'cid'>, ref: string) {
  if (!ref) throw new Error('Thiếu agent')
  const a = await findAgent(ctx, ref)
  if (!a) throw new Error(`Không thấy agent "${ref}"`)
  return a
}

async function issueByKey(ctx: Pick<ToolCtx, 'pc' | 'cid'>, key: string) {
  if (!key) throw new Error('Thiếu mã ticket')
  const i = await ctx.pc.get<PcIssue & { companyId: string }>(`/issues/${encodeURIComponent(key)}`).catch(() => null)
  if (!i || i.companyId !== ctx.cid) throw new Error(`Không thấy ticket ${key} trong công ty này`)
  return i
}

// ── Project ──

const createProject: Action = {
  kind: 'create_project',
  tool: {
    name: 'propose_create_project',
    description: 'Đề xuất tạo project mới gắn với một thư mục trên máy (agent làm ticket của project sẽ chạy trong thư mục đó). Khi duyệt, Pixel Company còn tạo .coopverse/memory/ và nhắc bộ nhớ trong CLAUDE.md của thư mục.',
    inputSchema: obj({ name: S('Tên project ngắn gọn'), folder: S('Đường dẫn đầy đủ tới thư mục'), description: S('1–3 câu: project này là gì, mục tiêu') }, ['name', 'folder']),
    run: async (ctx, a) => {
      const name = str(a.name)
      const folder = path.normalize(str(a.folder))
      if (!name) throw new Error('Thiếu tên project')
      const bad = folderProblem(folder)
      if (bad) throw new Error(`Thư mục không dùng được: ${bad}`)
      const ps = await liveProjects(ctx.pc, ctx.cid)
      const same = ps.find((p) => projectFolder(p) && path.normalize(projectFolder(p)!).toLowerCase() === folder.toLowerCase())
      if (same) throw new Error(`Thư mục này đã là project "${same.name}" rồi`)
      if (ps.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`Đã có project tên "${name}", chọn tên khác`)
      const desc = str(a.description)
      return PROPOSED(ctx.propose({
        kind: 'create_project',
        title: `Tạo project "${name}"`,
        lines: [`Thư mục: ${folder}`, ...(desc ? [desc] : []), 'Kèm bộ nhớ chung .coopverse/memory/ và nhắc trong CLAUDE.md'],
        data: { name, folder, description: desc },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    const name = String(d.name)
    const folder = path.normalize(String(d.folder))
    const bad = folderProblem(folder)
    if (bad) throw new Error(bad)
    await ctx.pc.post(`/companies/${ctx.cid}/projects`, {
      name, description: typeof d.description === 'string' && d.description ? d.description : null, status: 'in_progress',
      workspace: { name, sourceType: 'local_path', cwd: folder, isPrimary: true },
    })
    let extra: string[] = []
    try { extra = await initProjectMemory(folder, name) } catch (e) { extra = [`chưa tạo được bộ nhớ: ${e instanceof Error ? e.message : e}`] }
    return { result: `Đã tạo project ${name} (${folder})${extra.length ? ` · ${extra.join(', ')}` : ''}` }
  },
}

// ── Thuê agent ──

/**
 * Cấu hình chạy cho agent mới: lệnh chạy chép từ một agent cùng loại (công ty này trước, rồi công ty khác trên máy).
 * Biến môi trường thì không chép được (Paperclip trả giá trị đã che), nên agent claude_local dùng chung thư mục đăng nhập
 * Claude với Trợ lý (CLAUDE_CONFIG_DIR của Pixel Company; không đặt thì là đăng nhập mặc định của máy).
 */
async function adapterTemplate(ctx: ApplyCtx, type: string) {
  type Full = PcAgent & { adapterConfig?: Record<string, unknown> | null }
  let src = (await ctx.pc.get<Full[]>(`/companies/${ctx.cid}/agents`)).find((a) => a.adapterType === type && a.status !== 'terminated')
  if (!src) {
    const cos = await ctx.pc.get<{ id: string; status?: string }[]>('/companies').catch(() => [])
    for (const c of cos) {
      if (c.id === ctx.cid || c.status === 'archived') continue
      src = (await ctx.pc.get<Full[]>(`/companies/${c.id}/agents`).catch(() => [] as Full[])).find((a) => a.adapterType === type && a.status !== 'terminated')
      if (src) break
    }
  }
  const from = (src?.adapterConfig ?? {}) as Record<string, unknown>
  const cfg: Record<string, unknown> = {}
  for (const k of ['command', 'engine', 'extraArgs']) if (from[k] !== undefined) cfg[k] = from[k]
  if (type === 'claude_local' && ctx.claudeConfigDir) cfg.env = { CLAUDE_CONFIG_DIR: { type: 'plain', value: ctx.claudeConfigDir } }
  return { cfg, from: src?.name ?? null }
}

const hireAgent: Action = {
  kind: 'hire_agent',
  tool: {
    name: 'propose_hire_agent',
    description: 'Đề xuất thuê (tạo) một agent mới. Sơ đồ Pixel Company chỉ 2 tầng: Lead (không báo cáo cho ai, có thể được quyền thuê) và thành viên báo cáo cho một Lead (không được thuê). Agent mới chỉ chạy khi được giao ticket. Viết sẵn AGENTS.md (hướng dẫn làm việc) cho agent.',
    inputSchema: obj({
      name: S('Tên agent, ngắn, vd "Frontend Dev"'),
      role: E(ROLES, 'Vai trò'),
      title: S('Chức danh hiển thị, vd "Lập trình viên giao diện"'),
      reports_to: S('Tên Lead mà agent báo cáo (bỏ trống = agent thành Lead mới)'),
      adapter: E(ADAPTERS, 'Loại agent (CLI chạy agent), mặc định claude_local'),
      model: S('Model, vd claude-sonnet-5-5 (mặc định), claude-opus-5-5, claude-haiku-4-5'),
      effort: E(EFFORTS, 'Mức suy nghĩ (claude_local), mặc định high'),
      instructions: S('Nội dung AGENTS.md đầy đủ (markdown): vai trò, phạm vi, cách làm, cách báo cáo, quy tắc bộ nhớ'),
      can_hire: { type: 'boolean', description: 'Cho phép tự đề xuất thuê thêm người (chỉ Lead)' },
      budget_usd: { type: 'number', description: 'Trần chi tiêu USD / tháng (0 hoặc bỏ trống = không giới hạn)' },
      skills: A('Skill công ty gắn cho agent (key hoặc tên, xem list_skills)'),
    }, ['name', 'role', 'instructions']),
    run: async (ctx, a) => {
      const name = str(a.name)
      const role = str(a.role)
      if (!name) throw new Error('Thiếu tên')
      if (!ROLES.includes(role)) throw new Error(`role phải là một trong: ${ROLES.join(', ')}`)
      const adapter = str(a.adapter) || 'claude_local'
      if (!ADAPTERS.includes(adapter)) throw new Error(`adapter phải là một trong: ${ADAPTERS.join(', ')}`)
      const model = str(a.model) || (adapter === 'claude_local' ? 'claude-sonnet-5-5' : '')
      if (model && !MODEL.test(model)) throw new Error('Tên model không hợp lệ')
      const effort = adapter === 'claude_local' ? str(a.effort) || 'high' : ''
      if (effort && !EFFORTS.includes(effort)) throw new Error(`effort phải là một trong: ${EFFORTS.join(', ')}`)
      const instructions = typeof a.instructions === 'string' ? a.instructions.trim() : ''
      if (instructions.length < 40) throw new Error('AGENTS.md quá ngắn: viết rõ vai trò, phạm vi, cách làm')
      if (instructions.length > 40_000) throw new Error('AGENTS.md quá dài (tối đa 40 000 ký tự)')
      const all = await staffOf(ctx)
      if (all.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`Đã có agent tên "${name}"`)
      let boss: PcAgent | null = null
      if (str(a.reports_to)) {
        boss = pick(all, str(a.reports_to))
        if (!boss) throw new Error(`Không thấy agent "${str(a.reports_to)}"`)
        if (!isRoot(boss, all)) throw new Error(`${boss.name} là thành viên, không phải Lead. Pixel Company không có agent con: người mới phải báo cáo cho một Lead.`)
      }
      const canHire = bool(a.can_hire) ?? false
      if (canHire && boss) throw new Error('Chỉ Lead (không báo cáo cho ai) mới được quyền thuê người')
      const budget = num(a.budget_usd) ?? 0
      if (budget < 0) throw new Error('Trần chi tiêu không âm')
      let skills: PcSkill[] = []
      const wanted = arr(a.skills)
      if (wanted.length) {
        const own = await ctx.pc.get<PcSkill[]>(`/companies/${ctx.cid}/skills`)
        skills = wanted.map((r) => {
          const s = own.find((x) => x.key === r) ?? pick(own, r)
          if (!s) throw new Error(`Công ty chưa có skill "${r}" (cài trước bằng propose_install_skill)`)
          return s
        })
      }
      const title = str(a.title)
      return PROPOSED(ctx.propose({
        kind: 'hire_agent',
        title: `Thuê ${name}${title ? ` (${title})` : ''}`,
        lines: [
          `Vai trò ${role}${boss ? ` · báo cáo cho ${boss.name}` : ' · Lead (không báo cáo cho ai)'}${canHire ? ' · được đề xuất thuê người' : ''}`,
          `${adapter}${model ? ` · ${model}` : ''}${effort ? ` · effort ${effort}` : ''} · chỉ chạy khi được giao ticket`,
          `Trần chi tiêu: ${budget ? `$${budget}/tháng` : 'không giới hạn'}`,
          ...(skills.length ? [`Skill: ${skills.map((s) => s.name).join(', ')}`] : []),
        ],
        detail: `AGENTS.md\n\n${instructions}`,
        data: { name, role, title, reportsTo: boss?.id ?? null, adapter, model, effort, instructions, canHire, budgetCents: cents(budget), skills: skills.map((s) => s.key) },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    const adapter = String(d.adapter)
    const tpl = await adapterTemplate(ctx, adapter)
    const adapterConfig: Record<string, unknown> = { ...tpl.cfg }
    if (d.model) adapterConfig.model = d.model
    if (d.effort) adapterConfig.effort = d.effort
    const skills = (d.skills as string[] | undefined) ?? []
    const r = await ctx.pc.post<{ agent: { id: string; name: string; status: string }; approval?: { id: string; status: string } | null }>(`/companies/${ctx.cid}/agent-hires`, {
      name: d.name, role: d.role, title: d.title || null, reportsTo: d.reportsTo ?? null,
      adapterType: adapter, adapterConfig,
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1, sessionCompaction: { enabled: true, maxSessionRuns: 5, maxSessionAgeHours: 24 } } },
      instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': String(d.instructions) } },
      budgetMonthlyCents: Number(d.budgetCents) || 0,
      permissions: { canCreateAgents: !!d.canHire },
      ...(skills.length ? { desiredSkills: skills } : {}),
    })
    const id = r.agent.id
    // Công ty bắt duyệt người mới: thẻ này chính là lần duyệt
    if (r.approval && r.approval.status === 'pending') {
      await ctx.pc.post(`/approvals/${r.approval.id}/approve`, { decisionNote: 'Duyệt trong Pixel Company (thẻ đề xuất của Trợ lý)' })
    }
    const notes: string[] = []
    try { await ctx.pc.patch(`/agents/${id}/permissions`, { canCreateAgents: !!d.canHire, canAssignTasks: true }) } catch (e) { notes.push(`chưa đặt được quyền: ${e instanceof Error ? e.message : e}`) }
    if (adapter === 'claude_local') notes.push(ctx.claudeConfigDir ? 'dùng chung đăng nhập Claude với lễ tân' : 'dùng đăng nhập Claude mặc định của máy')
    return { result: `Đã thuê ${r.agent.name}${notes.length ? ` · ${notes.join(' · ')}` : ''}` }
  },
}

// ── Sửa agent ──

const updateAgent: Action = {
  kind: 'update_agent',
  tool: {
    name: 'propose_update_agent',
    description: 'Đề xuất sửa một agent: chức danh, model, mức suy nghĩ, báo cáo cho ai, quyền thuê người, tạm dừng / chạy lại. (Hạn mức dùng propose_set_budget, AGENTS.md dùng propose_edit_agent_instructions.)',
    inputSchema: obj({
      agent: S('Tên hoặc id agent'),
      title: S('Chức danh mới'),
      model: S('Model mới'),
      effort: E(EFFORTS, 'Mức suy nghĩ mới (claude_local)'),
      reports_to: S('Lead mới (ghi "none" để agent thành Lead)'),
      can_hire: { type: 'boolean', description: 'Quyền đề xuất thuê người (chỉ Lead)' },
      state: E(['pause', 'resume'], 'Tạm dừng / chạy lại'),
    }, ['agent']),
    run: async (ctx, a) => {
      const all = await staffOf(ctx)
      const ag = pick(all, str(a.agent))
      if (!ag) throw new Error(`Không thấy agent "${str(a.agent)}"`)
      const lines: string[] = []
      const data: Record<string, unknown> = { id: ag.id }
      const title = str(a.title)
      if (title) { data.title = title; lines.push(`Chức danh: ${ag.title || '(trống)'} → ${title}`) }
      const model = str(a.model)
      if (model) {
        if (!MODEL.test(model)) throw new Error('Tên model không hợp lệ')
        data.model = model
        lines.push(`Model: ${ag.adapterConfig?.model ?? '(mặc định)'} → ${model}`)
      }
      const effort = str(a.effort)
      if (effort) {
        if (!EFFORTS.includes(effort)) throw new Error(`effort phải là một trong: ${EFFORTS.join(', ')}`)
        data.effort = effort
        lines.push(`Mức suy nghĩ: ${ag.adapterConfig?.effort ?? '(mặc định)'} → ${effort}`)
      }
      let root = isRoot(ag, all)
      const rt = str(a.reports_to)
      if (rt) {
        if (rt.toLowerCase() === 'none') { data.reportsTo = null; root = true; lines.push('Thành Lead (không báo cáo cho ai)') }
        else {
          const boss = pick(all, rt)
          if (!boss) throw new Error(`Không thấy agent "${rt}"`)
          if (boss.id === ag.id) throw new Error('Agent không thể báo cáo cho chính mình')
          if (!isRoot(boss, all)) throw new Error(`${boss.name} là thành viên, không phải Lead`)
          if (all.some((x) => x.reportsTo === ag.id)) throw new Error(`${ag.name} đang có thành viên: chuyển thành viên đi trước`)
          data.reportsTo = boss.id
          root = false
          lines.push(`Báo cáo cho ${boss.name}`)
        }
      }
      const canHire = bool(a.can_hire)
      if (canHire !== undefined) {
        if (canHire && !root) throw new Error('Chỉ Lead mới được quyền thuê người')
        data.canHire = canHire
        lines.push(canHire ? 'Được đề xuất thuê người' : 'Không được thuê người')
      } else if (data.reportsTo && ag.permissions?.canCreateAgents) {
        data.canHire = false
        lines.push('Bỏ quyền thuê người (thành viên không được thuê)')
      }
      const state = str(a.state)
      if (state === 'pause') { data.state = 'pause'; lines.push('Tạm dừng: không nhận việc mới cho tới khi chạy lại') }
      if (state === 'resume') { data.state = 'resume'; lines.push('Chạy lại') }
      if (!lines.length) throw new Error('Không có gì để sửa')
      return PROPOSED(ctx.propose({ kind: 'update_agent', title: `Sửa ${ag.name}`, lines, data }).id)
    },
  },
  apply: async (ctx, d) => {
    const id = String(d.id)
    const patch: Record<string, unknown> = {}
    if (d.title) patch.title = d.title
    if ('reportsTo' in d) patch.reportsTo = d.reportsTo
    const cfg: Record<string, unknown> = {}
    if (d.model) cfg.model = d.model
    if (d.effort) cfg.effort = d.effort
    if (Object.keys(cfg).length) patch.adapterConfig = cfg
    if (Object.keys(patch).length) await ctx.pc.patch(`/agents/${id}`, patch)
    if (typeof d.canHire === 'boolean') await ctx.pc.patch(`/agents/${id}/permissions`, { canCreateAgents: d.canHire, canAssignTasks: true })
    if (d.state === 'pause') await ctx.pc.post(`/agents/${id}/pause`, {})
    if (d.state === 'resume') await ctx.pc.post(`/agents/${id}/resume`, {})
    return { result: 'Đã sửa xong' }
  },
}

const editInstructions: Action = {
  kind: 'edit_instructions',
  tool: {
    name: 'propose_edit_agent_instructions',
    description: 'Đề xuất thay nội dung AGENTS.md (hướng dẫn làm việc) của một agent. Đọc bản hiện tại bằng agent_detail trước, rồi gửi bản ĐẦY ĐỦ mới.',
    inputSchema: obj({ agent: S('Tên hoặc id agent'), content: S('Toàn bộ nội dung AGENTS.md mới'), summary: S('1–2 câu: sửa gì, vì sao') }, ['agent', 'content', 'summary']),
    run: async (ctx, a) => {
      const ag = await needAgent(ctx, str(a.agent))
      const content = typeof a.content === 'string' ? a.content.trim() : ''
      if (content.length < 40) throw new Error('Nội dung quá ngắn')
      if (content.length > 40_000) throw new Error('Quá dài (tối đa 40 000 ký tự)')
      let old = ''
      try { old = (await ctx.pc.get<{ content?: string }>(`/agents/${ag.id}/instructions-bundle/file?path=AGENTS.md`)).content ?? '' } catch { /* chưa có */ }
      if (old.trim() === content) throw new Error('Nội dung giống hệt bản hiện tại')
      return PROPOSED(ctx.propose({
        kind: 'edit_instructions',
        title: `Sửa AGENTS.md của ${ag.name}`,
        lines: [str(a.summary) || 'Cập nhật hướng dẫn', `${old.length.toLocaleString('vi-VN')} → ${content.length.toLocaleString('vi-VN')} ký tự`],
        detail: content,
        data: { id: ag.id, content },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    await ctx.pc.put(`/agents/${String(d.id)}/instructions-bundle/file`, { path: 'AGENTS.md', content: String(d.content) })
    return { result: 'Đã lưu AGENTS.md mới (áp dụng từ lượt chạy sau)' }
  },
}

// ── Ticket ──

interface TicketIn { title: string; description: string; projectId: string | null; projectName: string | null; assigneeId: string | null; assigneeName: string | null; priority: string; parentId: string | null; parentKey: string | null }

const createIssues: Action = {
  kind: 'create_issues',
  tool: {
    name: 'propose_create_issues',
    description: 'Đề xuất tạo một hoặc nhiều ticket (tối đa 10) trong một thẻ. Ticket có agent được giao thì agent bắt đầu làm ngay khi duyệt (tốn hạn mức); không giao thì nằm ở backlog. Ticket nên gắn project để agent làm trong thư mục của project.',
    inputSchema: obj({
      tickets: {
        type: 'array', minItems: 1, maxItems: 10,
        items: obj({
          title: S('Tiêu đề ngắn, bắt đầu bằng động từ'),
          description: S('Markdown: bối cảnh, việc cần làm, tiêu chí xong, file / chỗ liên quan'),
          project: S('Tên hoặc id project'),
          assignee: S('Tên agent được giao (bỏ trống = chưa giao)'),
          priority: E(PRIORITIES, 'Mặc định medium'),
          parent: S('Mã ticket cha nếu là việc con, vd COO-12'),
        }, ['title', 'description']),
      },
    }, ['tickets']),
    run: async (ctx, a) => {
      const raw = Array.isArray(a.tickets) ? (a.tickets as Record<string, unknown>[]) : []
      if (!raw.length) throw new Error('Không có ticket nào')
      if (raw.length > 10) throw new Error('Tối đa 10 ticket mỗi thẻ')
      const [all, projects] = await Promise.all([staffOf(ctx), liveProjects(ctx.pc, ctx.cid)])
      const list: TicketIn[] = []
      for (const t of raw) {
        const title = str(t.title)
        if (!title) throw new Error('Ticket thiếu tiêu đề')
        const p = str(t.project) ? pick(projects, str(t.project)) : null
        if (str(t.project) && !p) throw new Error(`Không thấy project "${str(t.project)}"`)
        const ag = str(t.assignee) ? pick(all, str(t.assignee)) : null
        if (str(t.assignee) && !ag) throw new Error(`Không thấy agent "${str(t.assignee)}"`)
        const priority = str(t.priority) || 'medium'
        if (!PRIORITIES.includes(priority)) throw new Error(`priority phải là một trong: ${PRIORITIES.join(', ')}`)
        const parent = str(t.parent) ? await issueByKey(ctx, str(t.parent)) : null
        list.push({
          title, description: typeof t.description === 'string' ? t.description.trim() : '', priority,
          projectId: p?.id ?? null, projectName: p?.name ?? null, assigneeId: ag?.id ?? null, assigneeName: ag?.name ?? null,
          parentId: parent?.id ?? null, parentKey: parent?.identifier ?? null,
        })
      }
      const assigned = list.filter((t) => t.assigneeId).length
      return PROPOSED(ctx.propose({
        kind: 'create_issues',
        title: list.length === 1 ? `Tạo ticket "${clip(list[0].title, 60)}"` : `Tạo ${list.length} ticket`,
        lines: [
          ...list.map((t) => `${t.title} · ${t.assigneeName ? `giao ${t.assigneeName}` : 'chưa giao'}${t.projectName ? ` · ${t.projectName}` : ''} · ưu tiên ${PRIO_VN[t.priority]}${t.parentKey ? ` · con của ${t.parentKey}` : ''}`),
          ...(assigned ? [`${assigned} ticket có người nhận: agent bắt đầu làm ngay khi duyệt`] : []),
        ],
        detail: list.map((t) => `### ${t.title}\n${t.description || '(không có mô tả)'}`).join('\n\n'),
        data: { tickets: list },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    const made: string[] = []
    for (const t of d.tickets as TicketIn[]) {
      try {
        const i = await ctx.pc.post<PcIssue>(`/companies/${ctx.cid}/issues`, {
          title: t.title, description: t.description || null, priority: t.priority,
          projectId: t.projectId, parentId: t.parentId, assigneeAgentId: t.assigneeId,
          status: t.assigneeId ? 'todo' : 'backlog',
        })
        made.push(`${i.identifier}${t.assigneeName ? ` → ${t.assigneeName}` : ''}`)
      } catch (e) {
        throw new Error(`${made.length ? `Đã tạo ${made.join(', ')}; ` : ''}ticket "${t.title}" lỗi: ${e instanceof Error ? e.message : e}`)
      }
    }
    return { result: `Đã tạo ${made.join(', ')}` }
  },
}

const ISSUE_SET = ['backlog', 'todo', 'blocked', 'done', 'cancelled']
const ISSUE_VN: Record<string, string> = { backlog: 'backlog', todo: 'cần làm', blocked: 'bị chặn', done: 'xong', cancelled: 'huỷ' }

const updateIssue: Action = {
  kind: 'update_issue',
  tool: {
    name: 'propose_update_issue',
    description: 'Đề xuất sửa một ticket: giao / đổi người làm, đổi trạng thái (backlog, todo, blocked, done, cancelled), ưu tiên, tiêu đề, mô tả, hoặc thêm bình luận (agent được giao đọc bình luận ở lượt sau).',
    inputSchema: obj({
      key: S('Mã ticket, vd COO-12'),
      assignee: S('Agent mới (ghi "none" để bỏ giao)'),
      status: E(ISSUE_SET, 'Trạng thái mới'),
      priority: E(PRIORITIES, 'Ưu tiên mới'),
      title: S('Tiêu đề mới'),
      description: S('Mô tả mới (thay cả mô tả cũ)'),
      comment: S('Bình luận thêm vào ticket (ghi dưới tên người dùng)'),
    }, ['key']),
    run: async (ctx, a) => {
      const i = await issueByKey(ctx, str(a.key))
      const lines: string[] = []
      const data: Record<string, unknown> = { id: i.id }
      const as = str(a.assignee)
      if (as) {
        if (as.toLowerCase() === 'none') { data.assigneeAgentId = null; lines.push('Bỏ giao') }
        else {
          const ag = await needAgent(ctx, as)
          data.assigneeAgentId = ag.id
          lines.push(`Giao cho ${ag.name}${OPEN.has(i.status) ? ' (agent bắt đầu làm ngay)' : ''}`)
        }
      }
      const st = str(a.status)
      if (st) {
        if (!ISSUE_SET.includes(st)) throw new Error(`status phải là một trong: ${ISSUE_SET.join(', ')}`)
        data.status = st
        lines.push(`Trạng thái: ${i.status} → ${ISSUE_VN[st]}`)
      }
      const pr = str(a.priority)
      if (pr) {
        if (!PRIORITIES.includes(pr)) throw new Error(`priority phải là một trong: ${PRIORITIES.join(', ')}`)
        data.priority = pr
        lines.push(`Ưu tiên: ${PRIO_VN[pr]}`)
      }
      if (str(a.title)) { data.title = str(a.title); lines.push(`Tiêu đề mới: ${str(a.title)}`) }
      let detail: string | undefined
      if (typeof a.description === 'string' && a.description.trim()) { data.description = a.description.trim(); lines.push('Thay mô tả'); detail = `Mô tả mới\n\n${a.description.trim()}` }
      if (typeof a.comment === 'string' && a.comment.trim()) {
        data.comment = a.comment.trim()
        lines.push('Thêm bình luận')
        detail = `${detail ? `${detail}\n\n` : ''}Bình luận\n\n${a.comment.trim()}`
      }
      if (!lines.length) throw new Error('Không có gì để sửa')
      return PROPOSED(ctx.propose({ kind: 'update_issue', title: `Sửa ${i.identifier}: ${clip(i.title, 50)}`, lines, detail, data }).id)
    },
  },
  apply: async (ctx, d) => {
    const { id, ...patch } = d
    await ctx.pc.patch(`/issues/${String(id)}`, patch)
    return { result: 'Đã cập nhật ticket' }
  },
}

// ── Skill ──

const installSkill: Action = {
  kind: 'install_skill',
  tool: {
    name: 'propose_install_skill',
    description: 'Đề xuất cài một skill vào công ty (từ kho: catalog_id; hoặc từ nguồn ngoài: source = link GitHub…), có thể gắn luôn cho vài agent.',
    inputSchema: obj({
      catalog_id: S('Id trong kho skill (xem list_skills)'),
      source: S('Nguồn ngoài kho: link GitHub tới thư mục skill (có SKILL.md)'),
      agents: A('Agent được gắn skill sau khi cài'),
      reason: S('Vì sao cần skill này (1 câu)'),
    }),
    run: async (ctx, a) => {
      const id = str(a.catalog_id)
      const source = str(a.source)
      if (!id === !source) throw new Error('Cần đúng một trong catalog_id hoặc source')
      let label = source
      if (id) {
        const cat = await ctx.pc.get<CatalogSkill[]>('/skills/catalog')
        const s = cat.find((x) => x.id === id) ?? pick(cat, id)
        if (!s) throw new Error(`Kho không có skill "${id}"`)
        label = `${s.name} (kho Paperclip)`
        a.catalog_id = s.id
      } else if (!/^https?:\/\//i.test(source) && !/^[\w.-]+\/[\w.-]+/.test(source)) {
        throw new Error('source phải là link (https://…) hoặc owner/repo')
      }
      const ags = needAgents(await staffOf(ctx), arr(a.agents))
      return PROPOSED(ctx.propose({
        kind: 'install_skill',
        title: `Cài skill ${id ? label.replace(' (kho Paperclip)', '') : clip(source, 50)}`,
        lines: [
          `Nguồn: ${label}`,
          ...(str(a.reason) ? [str(a.reason)] : []),
          ags.length ? `Gắn cho: ${ags.map((x) => x.name).join(', ')}` : 'Chưa gắn cho agent nào',
          ...(source ? ['Skill ngoài kho: chỉ cài khi bạn tin nguồn này'] : []),
        ],
        data: { catalogId: a.catalog_id || null, source: source || null, agents: ags.map((x) => x.id) },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    let keys: string[]
    if (d.catalogId) {
      const r = await ctx.pc.post<{ skill: PcSkill; action: string }>(`/companies/${ctx.cid}/skills/install-catalog`, { catalogSkillId: d.catalogId })
      keys = [r.skill.key]
    } else {
      const r = await ctx.pc.post<{ imported: PcSkill[]; warnings?: string[] }>(`/companies/${ctx.cid}/skills/import`, { source: d.source })
      keys = r.imported.map((s) => s.key)
      if (!keys.length) throw new Error(`Không tìm thấy skill nào ở nguồn này${r.warnings?.length ? `: ${r.warnings.join('; ')}` : ''}`)
    }
    for (const id of (d.agents as string[]) ?? []) await ctx.pc.post(`/agents/${id}/skills/sync`, { mode: 'add', desiredSkills: keys })
    return { result: `Đã cài ${keys.join(', ')}${(d.agents as string[])?.length ? ` và gắn cho ${(d.agents as string[]).length} agent` : ''}` }
  },
}

const agentSkills: Action = {
  kind: 'agent_skills',
  tool: {
    name: 'propose_agent_skills',
    description: 'Đề xuất gắn / gỡ skill (đã có trong công ty) cho một agent.',
    inputSchema: obj({ agent: S('Tên hoặc id agent'), add: A('Skill gắn thêm (key hoặc tên)'), remove: A('Skill gỡ ra (key hoặc tên)') }, ['agent']),
    run: async (ctx, a) => {
      const ag = await needAgent(ctx, str(a.agent))
      const own = await ctx.pc.get<PcSkill[]>(`/companies/${ctx.cid}/skills`)
      const res = (r: string) => {
        const s = own.find((x) => x.key === r) ?? pick(own, r)
        if (!s) throw new Error(`Công ty chưa có skill "${r}"`)
        return s
      }
      const add = arr(a.add).map(res)
      const remove = arr(a.remove).map(res)
      if (!add.length && !remove.length) throw new Error('Không có gì để gắn / gỡ')
      return PROPOSED(ctx.propose({
        kind: 'agent_skills',
        title: `Skill của ${ag.name}`,
        lines: [...(add.length ? [`Gắn: ${add.map((s) => s.name).join(', ')}`] : []), ...(remove.length ? [`Gỡ: ${remove.map((s) => s.name).join(', ')}`] : [])],
        data: { id: ag.id, add: add.map((s) => s.key), remove: remove.map((s) => s.key) },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    const add = d.add as string[]
    const remove = d.remove as string[]
    if (add.length) await ctx.pc.post(`/agents/${String(d.id)}/skills/sync`, { mode: 'add', desiredSkills: add })
    if (remove.length) await ctx.pc.post(`/agents/${String(d.id)}/skills/sync`, { mode: 'remove', desiredSkills: remove })
    return { result: 'Đã cập nhật skill (áp dụng từ lượt chạy sau)' }
  },
}

// ── Connector ──

interface Catalog { id: string; status: string }

/** Bật mọi công cụ đang dùng được của kết nối cho agent (giống mặc định của Paperclip khi kết nối app) */
async function finishConnection(ctx: ApplyCtx, connectionId: string, agents: string[]): Promise<ApplyResult> {
  await ctx.pc.post(`/tool-connections/${connectionId}/catalog/refresh`, {}).catch(() => null)
  const cat = await ctx.pc.get<Catalog[] | { entries?: Catalog[]; catalog?: Catalog[] }>(`/tool-connections/${connectionId}/catalog`)
  const list = Array.isArray(cat) ? cat : cat.entries ?? cat.catalog ?? []
  const active = list.filter((e) => e.status === 'active').map((e) => e.id)
  if (!active.length) throw new Error('Kết nối chưa có công cụ nào dùng được (đã đăng nhập xong chưa?). Đăng nhập rồi bấm lại "Xong rồi".')
  await ctx.pc.post(`/companies/${ctx.cid}/tools/apps/${connectionId}/finish`, {
    enabledCatalogEntryIds: active, askFirstCatalogEntryIds: [],
    access: agents.length ? { agentIds: agents } : 'all_agents',
  })
  return { result: `Đã kết nối, bật ${active.length} công cụ cho ${agents.length ? `${agents.length} agent` : 'mọi agent'}` }
}

const connectApp: Action = {
  kind: 'connect_app',
  tool: {
    name: 'propose_connect_app',
    description: 'Đề xuất kết nối một app (connector) để agent dùng làm công cụ: chọn app trong list_connectors (app + method), hoặc url của một MCP server từ xa. Khoá / token người dùng tự gõ vào ô bảo mật trên thẻ; app đăng nhập kiểu web thì thẻ hiện link đăng nhập.',
    inputSchema: obj({
      app: S('slug app (xem list_connectors)'),
      method: S('method key (bỏ trống = cách đầu tiên)'),
      url: S('URL MCP server từ xa (khi app không có trong danh sách)'),
      name: S('Tên hiển thị cho kết nối'),
      config: { type: 'object', additionalProperties: { type: 'string' }, description: 'Ô cấu hình bắt buộc không bí mật của method (vd storeDomain)' },
      agents: A('Chỉ cho các agent này dùng (bỏ trống = mọi agent)'),
    }),
    run: async (ctx, a) => {
      const slug = str(a.app)
      const url = str(a.url)
      if (!slug === !url) throw new Error('Cần đúng một trong app hoặc url')
      const ags = needAgents(await staffOf(ctx), arr(a.agents))
      const config: Record<string, string> = {}
      if (a.config && typeof a.config === 'object') for (const [k, v] of Object.entries(a.config)) if (typeof v === 'string' && v.trim()) config[k] = v.trim()
      const fields: ProposalField[] = []
      const lines: string[] = []
      let title: string
      let data: Record<string, unknown>
      if (slug) {
        const g = await ctx.pc.get<{ apps: GalleryApp[] }>(`/companies/${ctx.cid}/tools/gallery`)
        const app = g.apps.find((x) => x.slug === slug) ?? pick(g.apps.map((x) => ({ ...x, id: x.slug })), slug)
        if (!app) throw new Error(`Không có app "${slug}" (xem list_connectors)`)
        const ms = connectorMethods(app)
        if (!ms.length) throw new Error(`${app.name} chưa kết nối được qua lễ tân (chỉ hỗ trợ app làm công cụ cho agent)`)
        const m: GalleryMethod | undefined = str(a.method) ? ms.find((x) => x.key === str(a.method)) : ms[0]
        if (!m) throw new Error(`${app.name} không có method "${str(a.method)}". Có: ${ms.map((x) => x.key).join(', ')}`)
        const miss = requiredConfig(m).filter((f) => !config[f.key])
        if (miss.length) throw new Error(`Cần hỏi người dùng: ${miss.map((f) => `config.${f.key} (${f.label})`).join(', ')}`)
        for (const f of m.credentialFields ?? []) fields.push({ key: f.key, label: f.label, secret: f.secret !== false || f.type === 'password', optional: !f.required, placeholder: f.placeholder })
        if (m.key === 'generated-url') fields.push({ key: '__link', label: `URL MCP do ${app.name} tạo (có chứa khoá)`, secret: true, placeholder: 'https://…' })
        title = `Kết nối ${app.name}`
        lines.push(m.label ?? m.key)
        if (m.auth === 'oauth') lines.push('Duyệt xong sẽ có link để bạn đăng nhập trên web')
        if (fields.length) lines.push('Bạn tự nhập khoá vào ô bên dưới: lễ tân không thấy, Pixel Company không lưu, gửi thẳng vào kho bí mật')
        data = { galleryKey: app.slug, methodKey: m.key, name: str(a.name) || app.name, config }
      } else {
        if (!/^https:\/\/\S+$/i.test(url)) throw new Error('URL phải bắt đầu bằng https://')
        title = `Kết nối MCP ${str(a.name) || new URL(url).host}`
        lines.push(url, 'Nếu server cần đăng nhập, duyệt xong sẽ có link đăng nhập')
        data = { link: url, name: str(a.name) || new URL(url).host, config }
      }
      lines.push(ags.length ? `Cho: ${ags.map((x) => x.name).join(', ')}` : 'Cho mọi agent trong công ty')
      return PROPOSED(ctx.propose({ kind: 'connect_app', title, lines, fields, data: { ...data, agents: ags.map((x) => x.id) } }).id)
    },
  },
  apply: async (ctx, d, values) => {
    const credentialValues: Record<string, string> = {}
    let link = typeof d.link === 'string' ? d.link : undefined
    for (const [k, v] of Object.entries(values)) {
      if (k === '__link') link = v
      else credentialValues[k] = v
    }
    const r = await ctx.pc.post<{ connectionId: string; auth?: { kind: string; startUrl: string | null; manualClientRequired?: boolean } | null }>(`/companies/${ctx.cid}/tools/apps/connect`, {
      ...(d.galleryKey ? { galleryKey: d.galleryKey, connectionMethodKey: d.methodKey } : {}),
      ...(link ? { link } : {}),
      name: d.name,
      ...(Object.keys(credentialValues).length ? { credentialValues } : {}),
      ...(d.config && Object.keys(d.config as object).length ? { configValues: d.config } : {}),
    })
    const agents = (d.agents as string[]) ?? []
    if (r.auth?.kind === 'oauth') {
      if (r.auth.manualClientRequired || !r.auth.startUrl) throw new Error('App này cần tự đăng ký OAuth client, chưa làm được qua lễ tân: mở Paperclip → Tools để kết nối')
      return { wait: { link: r.auth.startUrl, note: 'Mở link, đăng nhập và cho phép truy cập, rồi bấm "Xong rồi"', data: { connectionId: r.connectionId } } }
    }
    return finishConnection(ctx, r.connectionId, agents)
  },
  cont: (ctx, d) => finishConnection(ctx, String(d.connectionId), (d.agents as string[]) ?? []),
}

// ── Việc định kỳ ──

const CRON = /^\s*(\S+\s+){4}\S+\s*$/

const createRoutine: Action = {
  kind: 'create_routine',
  tool: {
    name: 'propose_create_routine',
    description: 'Đề xuất tạo việc định kỳ: đến giờ Paperclip tự tạo ticket và giao cho agent (tốn hạn mức mỗi lần chạy). Lịch theo cron 5 trường (phút giờ ngày tháng thứ), giờ Việt Nam.',
    inputSchema: obj({
      title: S('Tiêu đề ticket mỗi lần chạy'),
      description: S('Mô tả việc cần làm mỗi lần (markdown)'),
      assignee: S('Agent làm'),
      project: S('Project (để agent chạy trong thư mục project)'),
      cron: S('Cron 5 trường, vd "0 8 * * 1-5" = 8:00 thứ 2–6'),
      when: S('Lịch bằng lời, vd "8h sáng thứ 2–6"'),
      priority: E(PRIORITIES, 'Mặc định medium'),
    }, ['title', 'description', 'assignee', 'cron', 'when']),
    run: async (ctx, a) => {
      const title = str(a.title)
      if (!title) throw new Error('Thiếu tiêu đề')
      const ag = await needAgent(ctx, str(a.assignee))
      const p = str(a.project) ? await findProject(ctx, str(a.project)) : null
      if (str(a.project) && !p) throw new Error(`Không thấy project "${str(a.project)}"`)
      const cron = str(a.cron)
      if (!CRON.test(cron)) throw new Error('cron phải có đúng 5 trường, vd "0 8 * * 1-5"')
      const priority = str(a.priority) || 'medium'
      if (!PRIORITIES.includes(priority)) throw new Error(`priority phải là một trong: ${PRIORITIES.join(', ')}`)
      const desc = typeof a.description === 'string' ? a.description.trim() : ''
      return PROPOSED(ctx.propose({
        kind: 'create_routine',
        title: `Việc định kỳ "${clip(title, 50)}"`,
        lines: [`${str(a.when) || cron} (cron ${cron}, giờ VN)`, `Giao ${ag.name}${p ? ` · ${p.name}` : ''} · ưu tiên ${PRIO_VN[priority]}`, 'Mỗi lần chạy tạo một ticket mới, tốn hạn mức'],
        detail: desc || undefined,
        data: { title, description: desc, assigneeAgentId: ag.id, projectId: p?.id ?? null, cron, when: str(a.when), priority },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    const r = await ctx.pc.post<{ id: string }>(`/companies/${ctx.cid}/routines`, {
      title: d.title, description: d.description || null, assigneeAgentId: d.assigneeAgentId, projectId: d.projectId, priority: d.priority, status: 'active',
    })
    try {
      await ctx.pc.post(`/routines/${r.id}/triggers`, { kind: 'schedule', cronExpression: d.cron, timezone: TZ, label: d.when || null })
    } catch (e) {
      await ctx.pc.patch(`/routines/${r.id}`, { status: 'paused' }).catch(() => null)
      throw new Error(`Đã tạo việc nhưng chưa đặt được lịch (để tạm dừng): ${e instanceof Error ? e.message : e}`)
    }
    return { result: 'Đã tạo việc định kỳ' }
  },
}

const updateRoutine: Action = {
  kind: 'update_routine',
  tool: {
    name: 'propose_update_routine',
    description: 'Đề xuất sửa việc định kỳ: tạm dừng / chạy lại / lưu trữ, đổi lịch, đổi người làm.',
    inputSchema: obj({
      routine: S('Tiêu đề hoặc id việc định kỳ (xem list_routines)'),
      status: E(['active', 'paused', 'archived'], 'Trạng thái mới'),
      cron: S('Lịch mới (cron 5 trường)'),
      when: S('Lịch mới bằng lời'),
      assignee: S('Agent mới'),
    }, ['routine']),
    run: async (ctx, a) => {
      const rs = await ctx.pc.get<PcRoutine[]>(`/companies/${ctx.cid}/routines`)
      const r = pick(rs.map((x) => ({ ...x, name: x.title })), str(a.routine))
      if (!r) throw new Error(`Không thấy việc định kỳ "${str(a.routine)}"`)
      const lines: string[] = []
      const data: Record<string, unknown> = { id: r.id }
      const st = str(a.status)
      if (st) {
        if (!['active', 'paused', 'archived'].includes(st)) throw new Error('status: active, paused hoặc archived')
        data.status = st
        lines.push({ active: 'Chạy lại', paused: 'Tạm dừng', archived: 'Lưu trữ (ngừng hẳn)' }[st]!)
      }
      const cron = str(a.cron)
      if (cron) {
        if (!CRON.test(cron)) throw new Error('cron phải có đúng 5 trường')
        const full = r.triggers ?? (await ctx.pc.get<PcRoutine>(`/routines/${r.id}`)).triggers ?? []
        const t = full.find((x) => x.kind === 'schedule')
        Object.assign(data, { cron, when: str(a.when), triggerId: t?.id ?? null })
        lines.push(`Lịch mới: ${str(a.when) || cron} (cron ${cron})`)
      }
      if (str(a.assignee)) {
        const ag = await needAgent(ctx, str(a.assignee))
        data.assigneeAgentId = ag.id
        lines.push(`Giao ${ag.name}`)
      }
      if (!lines.length) throw new Error('Không có gì để sửa')
      return PROPOSED(ctx.propose({ kind: 'update_routine', title: `Sửa việc định kỳ "${clip(r.title, 50)}"`, lines, data }).id)
    },
  },
  apply: async (ctx, d) => {
    const patch: Record<string, unknown> = {}
    if (d.status) patch.status = d.status
    if (d.assigneeAgentId) patch.assigneeAgentId = d.assigneeAgentId
    if (Object.keys(patch).length) await ctx.pc.patch(`/routines/${String(d.id)}`, patch)
    if (d.cron) {
      if (d.triggerId) await ctx.pc.patch(`/routine-triggers/${String(d.triggerId)}`, { cronExpression: d.cron, timezone: TZ, ...(d.when ? { label: d.when } : {}) })
      else await ctx.pc.post(`/routines/${String(d.id)}/triggers`, { kind: 'schedule', cronExpression: d.cron, timezone: TZ, label: d.when || null })
    }
    return { result: 'Đã sửa việc định kỳ' }
  },
}

// ── Hạn mức, bí mật, công ty ──

const setBudget: Action = {
  kind: 'set_budget',
  tool: {
    name: 'propose_set_budget',
    description: 'Đề xuất đặt trần chi tiêu USD / tháng cho cả công ty hoặc một agent (0 = không giới hạn). Chạm trần thì agent bị tạm dừng.',
    inputSchema: obj({ target: S('"company" hoặc tên agent'), usd_per_month: { type: 'number', description: 'Số USD mỗi tháng, 0 = bỏ trần' } }, ['target', 'usd_per_month']),
    run: async (ctx, a) => {
      const v = num(a.usd_per_month)
      if (v === undefined || v < 0 || v > 1_000_000) throw new Error('usd_per_month phải từ 0 tới 1 000 000')
      const t = str(a.target)
      const isCo = !t || t.toLowerCase() === 'company'
      let who = 'công ty'
      let now: number | undefined
      let agentId: string | null = null
      if (isCo) now = (await ctx.pc.get<{ budgetMonthlyCents?: number }>(`/companies/${ctx.cid}`)).budgetMonthlyCents
      else {
        const ag = await needAgent(ctx, t)
        who = ag.name
        now = ag.budgetMonthlyCents
        agentId = ag.id
      }
      return PROPOSED(ctx.propose({
        kind: 'set_budget',
        title: `Hạn mức của ${who}`,
        lines: [`${now ? usd(now) : 'không giới hạn'} → ${v ? `$${v}/tháng` : 'không giới hạn'}`],
        data: { agentId, cents: cents(v) },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    const body = { budgetMonthlyCents: Number(d.cents) || 0 }
    if (d.agentId) await ctx.pc.patch(`/agents/${String(d.agentId)}/budgets`, body)
    else await ctx.pc.patch(`/companies/${ctx.cid}/budgets`, body)
    return { result: 'Đã đặt hạn mức' }
  },
}

const addSecret: Action = {
  kind: 'add_secret',
  tool: {
    name: 'propose_add_secret',
    description: 'Đề xuất lưu một bí mật (khoá API, token…) vào kho bí mật của công ty và cấp cho agent dưới dạng biến môi trường. Người dùng tự gõ giá trị vào ô bảo mật trên thẻ; bạn không bao giờ thấy giá trị. Đừng bao giờ bảo người dùng dán khoá vào chat.',
    inputSchema: obj({
      name: S('Tên dễ hiểu, vd "Khoá OpenAI"'),
      env: S('Tên biến môi trường agent đọc, vd OPENAI_API_KEY'),
      description: S('Dùng để làm gì'),
      agents: A('Agent được dùng bí mật này'),
    }, ['name', 'env']),
    run: async (ctx, a) => {
      const name = str(a.name)
      const env = str(a.env)
      if (!name) throw new Error('Thiếu tên')
      if (!ENV_KEY.test(env)) throw new Error('env phải là tên biến môi trường hợp lệ, vd OPENAI_API_KEY')
      const existing = await ctx.pc.get<{ name: string; key?: string | null }[]>(`/companies/${ctx.cid}/secrets`)
      if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase() || s.key?.toLowerCase() === env.toLowerCase())) throw new Error(`Đã có bí mật "${name}" / ${env}`)
      const ags = needAgents(await staffOf(ctx), arr(a.agents))
      return PROPOSED(ctx.propose({
        kind: 'add_secret',
        title: `Lưu bí mật "${name}"`,
        lines: [
          `Agent đọc qua biến ${env}`,
          ags.length ? `Cấp cho: ${ags.map((x) => x.name).join(', ')}` : 'Chưa cấp cho agent nào',
          ...(str(a.description) ? [str(a.description)] : []),
          'Bạn tự nhập giá trị vào ô bên dưới: lễ tân không thấy, Pixel Company không lưu, gửi thẳng vào kho bí mật',
        ],
        fields: [{ key: 'value', label: name, secret: true }],
        data: { name, env, description: str(a.description), agents: ags.map((x) => x.id) },
      }).id)
    },
  },
  apply: async (ctx, d, values) => {
    if (!values.value) throw new Error('Chưa nhập giá trị')
    const s = await ctx.pc.post<{ id: string }>(`/companies/${ctx.cid}/secrets`, {
      name: d.name, key: d.env, value: values.value, description: d.description || null,
    })
    const done: string[] = []
    for (const id of (d.agents as string[]) ?? []) {
      const ag = await ctx.pc.get<{ name: string; adapterConfig?: { env?: Record<string, unknown> } | null }>(`/agents/${id}`)
      const env = { ...(ag.adapterConfig?.env ?? {}), [String(d.env)]: { type: 'secret_ref', secretId: s.id, version: 'latest' } }
      await ctx.pc.patch(`/agents/${id}`, { adapterConfig: { env } })
      done.push(ag.name)
    }
    return { result: `Đã lưu bí mật${done.length ? `, cấp cho ${done.join(', ')}` : ''}` }
  },
}

const updateCompany: Action = {
  kind: 'update_company',
  tool: {
    name: 'propose_update_company',
    description: 'Đề xuất đổi tên / mô tả công ty.',
    inputSchema: obj({ name: S('Tên mới'), description: S('Mô tả mới (công ty làm gì, mục tiêu)') }),
    run: async (ctx, a) => {
      const name = str(a.name)
      const description = typeof a.description === 'string' ? a.description.trim() : ''
      if (!name && !description) throw new Error('Không có gì để sửa')
      const co = await ctx.pc.get<{ name: string }>(`/companies/${ctx.cid}`)
      return PROPOSED(ctx.propose({
        kind: 'update_company',
        title: 'Sửa thông tin công ty',
        lines: [...(name ? [`Tên: ${co.name} → ${name}`] : []), ...(description ? [`Mô tả: ${clip(description, 200)}`] : [])],
        data: { ...(name ? { name } : {}), ...(description ? { description } : {}) },
      }).id)
    },
  },
  apply: async (ctx, d) => {
    await ctx.pc.patch(`/companies/${ctx.cid}`, d)
    return { result: 'Đã sửa thông tin công ty' }
  },
}

const ACTIONS: Action[] = [
  createProject, hireAgent, updateAgent, editInstructions, createIssues, updateIssue,
  installSkill, agentSkills, connectApp, createRoutine, updateRoutine, setBudget, addSecret, updateCompany,
]

export const ACTION_TOOLS: Tool[] = ACTIONS.map((a) => a.tool)
export const actionOf = (kind: string) => ACTIONS.find((a) => a.kind === kind) ?? null
export type { ProposalDraft }
