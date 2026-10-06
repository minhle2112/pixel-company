export type AgentStatus = 'running' | 'idle' | 'paused' | 'error' | 'terminated'

/** Dạng agent mà thế giới 3D dùng. Adapter Paperclip (`paperclip.ts`) map dữ liệu thật sang dạng này. */
export interface Agent {
  id: string
  name: string
  title: string
  status: AgentStatus
  reportsTo: string | null
  /** Ticket đang làm, dạng "LAB-14 · tiêu đề" */
  task?: string
  /** Ticket và run đang chạy (giai đoạn 3 dùng để mở log) */
  issueId?: string
  runId?: string
  /** Lý do tạm dừng / lỗi từ Paperclip */
  reason?: string
  /** Lượt chạy hiện tại là để trả lời chat (không phải làm ticket) */
  chatting?: boolean
  /** Agent giả chỉ để demo bố cục */
  demo?: boolean
  /** Ứng viên: phiếu thuê chưa được duyệt (Paperclip `pending_approval`). Đứng ở sảnh, không có bàn. */
  candidate?: boolean
  /** Được phép đề xuất thuê agent (Paperclip `permissions.canCreateAgents`) */
  canHire?: boolean
}

/** Một công ty trên Paperclip (mỗi công ty là một văn phòng riêng). */
export interface Company {
  id: string
  name: string
  /** Tiền tố mã ticket, vd LAB */
  prefix: string
  /** Agent thuê agent mới phải chờ bạn duyệt (`requireBoardApprovalForNewAgents`) */
  hireApproval?: boolean
}

/** Ticket rút gọn từ Paperclip. */
export interface Issue {
  id: string
  key: string
  title: string
  status: string
  assigneeId: string | null
  updatedAt: string
  completedAt?: string | null
  /** critical | high | medium | low */
  priority?: string
}

/**
 * Cuộc trò chuyện (Agent Chat của Paperclip) giữa bạn và một agent. Trong Paperclip đây là một ticket đặc biệt,
 * nên Pixel Company tách nó ra khỏi danh sách ticket (không lên bảng, không sinh thông báo ticket).
 */
export interface ChatInfo {
  issueId: string
  agentId: string
  key: string
  /** active = agent đang trả lời · waiting = chờ bạn nhắn */
  state: 'active' | 'waiting'
}

/** Một tin trong cuộc trò chuyện. */
export interface ChatMessage {
  id: string
  from: 'me' | 'agent' | 'system'
  body: string
  createdAt: string
  /** Tin của mình vừa gửi, chưa được Paperclip xác nhận */
  sending?: boolean
}

/** Câu hỏi / yêu cầu duyệt agent gửi trong chat, đang chờ bạn trả lời. */
export interface ChatAsk {
  id: string
  title: string
  text: string
}

/**
 * Một việc đang chờ bạn quyết (lấy từ hộp thư "cần chú ý" của Paperclip):
 * - approval: phiếu duyệt (thuê agent, chiến lược CEO, vượt ngân sách, xin board duyệt)
 * - confirm / questions: agent hỏi bạn trong một ticket (xác nhận, hoặc vài câu hỏi có lựa chọn)
 * - other: loại hiếm (chấm từng mục, gợi ý ticket, checklist…), chỉ mở được trong Paperclip
 */
export type AskKind = 'approval' | 'confirm' | 'questions' | 'other'

export interface Ask {
  /** Id phiếu duyệt hoặc id câu hỏi */
  id: string
  kind: AskKind
  /** Loại gốc của Paperclip: kiểu phiếu (hire_agent…) hoặc kiểu câu hỏi (request_confirmation…) */
  type: string
  /** Agent gửi (giơ tay ở bàn); null = phiếu của hệ thống, vd vượt ngân sách */
  agentId: string | null
  title: string
  /** Một đoạn ngắn để xem trước */
  excerpt: string
  /** Ticket chứa câu hỏi (với phiếu duyệt: ticket gắn kèm nếu có) */
  issueId: string | null
  issueKey: string | null
  createdAt: string
  /** Paperclip cho xử lý ngay; false = phải mở trang của Paperclip (vd duyệt thao tác nguy hiểm) */
  inline: boolean
  /** Trang của việc này trong Paperclip */
  href: string
  /** Phiếu thuê: id agent ứng viên (đang đứng ở sảnh) */
  candidateId?: string | null
}

export const APPROVAL_LABEL: Record<string, string> = {
  hire_agent: 'Thuê agent mới',
  approve_ceo_strategy: 'Duyệt chiến lược',
  budget_override_required: 'Vượt ngân sách',
  request_board_approval: 'Xin bạn duyệt',
}

export const ASK_KIND_LABEL: Record<AskKind, string> = {
  approval: 'Phiếu duyệt',
  confirm: 'Xin xác nhận',
  questions: 'Câu hỏi',
  other: 'Cần bạn quyết',
}

/** Nhãn ngắn cho một việc chờ: "Thuê agent mới", "Câu hỏi"… */
export const askLabel = (a: Ask) => (a.kind === 'approval' ? APPROVAL_LABEL[a.type] ?? ASK_KIND_LABEL.approval : ASK_KIND_LABEL[a.kind])

/** Comment rút gọn của ticket. */
export interface Comment {
  id: string
  body: string
  createdAt: string
  authorAgentId: string | null
  authorType: string
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'Đang làm',
  idle: 'Rảnh',
  paused: 'Tạm dừng',
  error: 'Lỗi',
  terminated: 'Đã nghỉ',
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  running: '#3ccf6e',
  idle: '#f2b544',
  paused: '#8a94a6',
  error: '#ef5a4c',
  terminated: '#5b6270',
}

export const STATUS_CYCLE: AgentStatus[] = ['running', 'idle', 'paused', 'error', 'terminated']

export const ISSUE_STATUS_LABEL: Record<string, string> = {
  backlog: 'Tồn đọng',
  todo: 'Cần làm',
  in_progress: 'Đang làm',
  in_review: 'Chờ duyệt',
  done: 'Xong',
  blocked: 'Bị chặn',
  cancelled: 'Đã huỷ',
}
