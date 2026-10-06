import type { AskDetail } from './paperclip'
import type { Ledger } from './ledger'
import type { Agent, Ask, Comment, Issue } from './types'

/**
 * Dữ liệu giả cho bản demo (mở http://127.0.0.1:5177/?demo). Một đội nội dung giả: Lead và 7 thành viên;
 * các agent "(demo)" chỉ để thấy bố cục và các trạng thái khác nhau. Một ứng viên Lead đề xuất thuê đang chờ ở sảnh.
 */
export const MOCK_AGENTS: Agent[] = [
  { id: 'seo-lead', name: 'SEO Lead', title: 'Trưởng nhóm SEO', status: 'running', reportsTo: null, task: 'LAB-14 · Audit cannibalization', issueId: 'i14' },
  { id: 'content-seo', name: 'Content SEO', title: 'Viết nội dung SEO', status: 'idle', reportsTo: 'seo-lead' },
  { id: 'demo-research', name: 'Nghiên Cứu', title: 'Tìm chủ đề', status: 'running', reportsTo: 'seo-lead', task: 'LAB-15 · Striking distance', issueId: 'i15', demo: true },
  { id: 'demo-writer', name: 'Viết Bài', title: 'Viết bài EN', status: 'idle', reportsTo: 'seo-lead', demo: true },
  { id: 'demo-editor', name: 'Biên Tập', title: 'Biên tập phản biện', status: 'paused', reportsTo: 'seo-lead', reason: 'Bạn tạm dừng', demo: true },
  { id: 'demo-translate', name: 'Dịch Bài', title: 'Dịch bài DE', status: 'idle', reportsTo: 'seo-lead', demo: true },
  { id: 'demo-image', name: 'Tạo Ảnh', title: 'Tạo ảnh', status: 'error', reportsTo: 'seo-lead', reason: 'Hết hạn mức API ảnh', demo: true },
  { id: 'demo-meta', name: 'Viết Meta', title: 'Viết meta', status: 'running', reportsTo: 'seo-lead', task: 'LAB-12 · Meta cho batch A', issueId: 'i12', demo: true, canHire: false },
  { id: 'cand-link', name: 'Kiểm Tra Link', title: 'Rà link gãy', status: 'paused', reportsTo: 'seo-lead', candidate: true, demo: true },
]

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

const issue = (n: number, title: string, status: string, assigneeId: string | null, min: number, priority = 'medium'): Issue => ({
  id: `i${n}`,
  key: `LAB-${n}`,
  title,
  status,
  assigneeId,
  updatedAt: ago(min),
  completedAt: status === 'done' ? ago(min) : null,
  priority,
})

export const MOCK_ISSUES: Issue[] = [
  issue(16, 'Viết bài DE: Größentabelle erklärt', 'todo', 'demo-writer', 30),
  issue(17, 'Ảnh bìa cho 3 bài guide mới', 'todo', 'demo-image', 55, 'low'),
  issue(18, 'Kiểm tra hreflang EN/DE sau khi publish', 'backlog', null, 400, 'low'),
  issue(14, 'Audit cannibalization: trang A vs trang B', 'in_progress', 'seo-lead', 8, 'high'),
  issue(15, 'Striking distance: 20 truy vấn hạng 8–20', 'in_progress', 'demo-research', 12, 'high'),
  issue(13, 'Review alt text DE (r2)', 'in_review', 'seo-lead', 40),
  issue(19, 'Dịch FAQ sang tiếng Đức', 'blocked', 'demo-translate', 90),
  issue(12, 'Content batch A: blog template strings (EN/DE)', 'done', 'content-seo', 75, 'high'),
  issue(11, 'Action plan: gộp LAB-8/9/10 thành một kế hoạch', 'done', 'seo-lead', 160, 'high'),
  issue(10, 'Blog re-audit: toàn bộ bài guide EN+DE', 'done', 'seo-lead', 230, 'high'),
  issue(9, 'Vì sao trang sản phẩm chính ở trang 2', 'done', 'seo-lead', 380),
  issue(8, 'Keyword audit với GSC', 'done', 'seo-lead', 1300),
]

const ask = (a: Omit<Ask, 'createdAt' | 'inline' | 'href' | 'issueKey'> & { min: number }): Ask => ({
  ...a,
  issueKey: a.issueId ? `LAB-${a.issueId.slice(1)}` : null,
  createdAt: ago(a.min),
  inline: true,
  href: '#',
})

/** Việc chờ bạn quyết trong bản demo: đủ các loại thẻ (phiếu duyệt, xác nhận, câu hỏi, phiếu không gắn agent). */
export const MOCK_ASKS: Ask[] = [
  ask({ id: 'ask-hire', kind: 'approval', type: 'hire_agent', agentId: 'seo-lead', candidateId: 'cand-link', title: 'Hire Agent: Kiểm Tra Link', excerpt: 'Cần một agent rà link gãy sau mỗi đợt đăng bài', issueId: 'i12', min: 6 }),
  ask({ id: 'ask-confirm', kind: 'confirm', type: 'request_confirmation', agentId: 'demo-research', title: 'Chốt danh sách 20 truy vấn', excerpt: 'Danh sách 20 truy vấn hạng 8–20 đã lọc xong, sếp chốt để em viết brief?', issueId: 'i15', min: 3 }),
  ask({ id: 'ask-q', kind: 'questions', type: 'ask_user_questions', agentId: 'demo-writer', title: 'Giọng văn bài DE', excerpt: 'Bài Größentabelle viết giọng nào?', issueId: 'i16', min: 2 }),
  ask({ id: 'ask-budget', kind: 'approval', type: 'budget_override_required', agentId: null, title: 'Tạo Ảnh đã dùng 92% ngân sách tháng', excerpt: 'Cho phép vượt ngân sách để chạy tiếp?', issueId: null, min: 12 }),
]

export const MOCK_ASK_DETAILS: Record<string, AskDetail> = {
  'ask-hire': {
    source: 'approval',
    status: 'pending',
    payload: {
      name: 'Kiểm Tra Link',
      role: 'qa',
      title: 'Rà link gãy, redirect',
      reportsTo: 'seo-lead',
      capabilities: 'Crawl các trang vừa đăng, báo link 404 / redirect vòng',
      adapterType: 'claude_local',
      adapterConfig: { model: 'claude-haiku-4-5' },
      budgetMonthlyCents: 1500,
      permissions: { canCreateAgents: false },
    },
    comments: [
      {
        id: 'hc1', authorAgentId: 'seo-lead', authorType: 'agent', createdAt: ago(6),
        body: '**Vì sao cần:** 4 đợt đăng gần nhất (LAB-9, 10, 11, 12) lần nào nhóm cũng mất ~20 phút soát link gãy.\n\n**Giao gì:** sau mỗi đợt đăng, crawl các trang mới và báo link 404 / redirect vòng.\n\n**Chi phí:** model rẻ (haiku), ước ~$15/tháng.',
      },
    ],
  },
  'ask-confirm': {
    source: 'interaction',
    status: 'pending',
    kind: 'request_confirmation',
    title: 'Chốt danh sách 20 truy vấn',
    summary: null,
    payload: {
      version: 1,
      prompt: 'Danh sách 20 truy vấn hạng 8–20 đã lọc xong, sếp chốt để em viết brief?',
      detailsMarkdown: '- 12 truy vấn về **kích thước**\n- 5 truy vấn so sánh\n- 3 truy vấn hỏi đáp\n\nBỏ các truy vấn thương hiệu đối thủ.',
      acceptLabel: 'Chốt',
      rejectLabel: 'Cần sửa',
      allowDeclineReason: true,
    },
  },
  'ask-q': {
    source: 'interaction',
    status: 'pending',
    kind: 'ask_user_questions',
    title: 'Giọng văn bài DE',
    summary: null,
    payload: {
      version: 1,
      title: 'Giọng văn bài DE',
      submitLabel: 'Gửi',
      questions: [
        {
          id: 'tone', prompt: 'Bài Größentabelle viết giọng nào?', selectionMode: 'single', required: true,
          options: [
            { id: 'du', label: 'Thân mật (du)', description: 'Hợp nhóm khách trẻ, mạng xã hội' },
            { id: 'sie', label: 'Lịch sự (Sie)' },
            { id: 'own', label: 'Ý khác', freeText: true },
          ],
        },
        {
          id: 'extras', prompt: 'Thêm phần nào?', selectionMode: 'multi', required: false, allowOther: true,
          options: [{ id: 'faq', label: 'FAQ' }, { id: 'table', label: 'Bảng so sánh' }, { id: 'video', label: 'Video ngắn' }],
        },
      ],
    },
  },
  'ask-budget': {
    source: 'approval',
    status: 'pending',
    payload: {
      title: 'Tạo Ảnh đã dùng 92% ngân sách tháng',
      summary: 'Agent Tạo Ảnh đã dùng $27.60 / $30.00 ngân sách tháng 10. Chạm 100% thì agent tự dừng.',
      recommendedAction: 'Cho vượt thêm $10 đến hết tháng, hoặc để agent dừng.',
    },
  },
}

export const MOCK_COMMENTS: Record<string, Comment[]> = {
  i12: [
    { id: 'c3', body: '**Review batch A: PASS.** Mình sửa 2 chỗ nhỏ, file của Content giữ nguyên.', createdAt: ago(80), authorAgentId: 'seo-lead', authorType: 'agent' },
  ],
  i14: [
    { id: 'c1', body: 'Ưu tiên trang bán chạy trước, trang còn lại để sau nhé.', createdAt: ago(20), authorAgentId: null, authorType: 'user' },
  ],
  i13: [
    { id: 'c2', body: 'Alt text r2 xong, còn 3 ảnh cần bạn xác nhận nội dung.', createdAt: ago(42), authorAgentId: 'seo-lead', authorType: 'agent' },
  ],
}

/**
 * Sổ EXP giả cho bản demo: đủ các cấp (Lead cấp 8, Tạo Ảnh cấp 7…), và vài chục ticket cũ đã xong
 * để quỹ có sẵn vài trăm Xu thử dọn văn phòng. Viết Bài đang 290 EXP, thêm một lượt chạy là lên cấp 3.
 */
export function mockLedger(): Ledger {
  const now = Date.now()
  const L: Ledger = { v: 1, runs: {}, tickets: {}, approvals: {} }
  // [agent, số lượt chạy, rải trong bao nhiêu ngày gần đây]
  const plan: [string, number, number][] = [
    ['seo-lead', 328, 60], ['content-seo', 92, 20], ['demo-image', 220, 30], ['demo-translate', 65, 25],
    ['demo-research', 42, 6], ['demo-writer', 29, 5], ['demo-editor', 6, 10], ['demo-meta', 3, 3],
  ]
  for (const [agentId, n, days] of plan) {
    for (let i = 0; i < n; i++) {
      // Rải đều nhưng lệch nhau một chút, không cần ngẫu nhiên thật
      const ago = ((i + 0.5) / n) * days * 86_400_000 * (0.9 + 0.2 * (((i * 7919) % 97) / 97))
      L.runs[`${agentId}-r${i}`] = [agentId, now - ago]
    }
  }
  for (const i of MOCK_ISSUES) {
    if (i.status === 'done' && i.assigneeId) L.tickets[i.id] = [i.assigneeId, Date.parse(i.completedAt ?? i.updatedAt), i.priority ?? 'medium', i.key]
  }
  L.approvals['appr-1'] = ['seo-lead', now - 3 * 86_400_000, 'request_board_approval']
  L.approvals['appr-2'] = ['seo-lead', now - 12 * 86_400_000, 'request_board_approval']
  // Ticket cũ đã xong (không còn trong danh sách ticket demo): [agent, số ticket, độ ưu tiên, rải trong bao nhiêu ngày]
  const old: [string, number, string, number][] = [
    ['seo-lead', 5, 'high', 50], ['content-seo', 5, 'medium', 18], ['demo-image', 5, 'medium', 28],
    ['demo-translate', 3, 'low', 22], ['demo-research', 2, 'high', 5],
  ]
  for (const [agentId, n, p, days] of old) {
    for (let i = 0; i < n; i++) L.tickets[`${agentId}-old${i}`] = [agentId, now - ((i + 0.5) / n) * days * 86_400_000, p, `OLD-${i + 1}`]
  }
  return L
}
