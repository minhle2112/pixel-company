import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Bộ lọc lời gọi tới Paperclip, dùng chung cho máy chủ dev của Vite (vite.config.ts) và app desktop (desktop/server.ts).
 * Chỉ những endpoint Pixel Company cần mới được đi qua. Không gắn cứng công ty nào: Pixel Company hiện mọi công ty có trên
 * Paperclip của máy này (chọn bằng ô dưới logo).
 */

/** Middleware kiểu Connect: Vite và máy chủ của app desktop đều dùng được */
export type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function allowList() {
  return {
    GET: [
      /^\/api\/health$/,
      /^\/api\/companies$/,
      new RegExp(`^/api/companies/${UUID}/(agents|org|live-runs|heartbeat-runs|issues)$`),
      new RegExp(`^/api/heartbeat-runs/${UUID}(/log|/events)?$`),
      new RegExp(`^/api/agents/${UUID}/runtime-state$`),
      new RegExp(`^/api/issues/${UUID}/(comments|interactions)$`),
      // Agent Chat (tính năng thử nghiệm của Paperclip): đọc cuộc trò chuyện + xem tính năng có đang bật không
      new RegExp(`^/api/companies/${UUID}/chats/${UUID}$`),
      /^\/api\/instance\/settings\/experimental$/,
      // Việc chờ bạn quyết: hộp thư "cần chú ý" + nội dung phiếu duyệt
      new RegExp(`^/api/companies/${UUID}/attention$`),
      new RegExp(`^/api/approvals/${UUID}$`),
      new RegExp(`^/api/approvals/${UUID}/comments$`),
      new RegExp(`^/api/companies/${UUID}/approvals$`),
    ],
    POST: [
      new RegExp(`^/api/agents/${UUID}/(wakeup|pause|resume)$`),
      new RegExp(`^/api/issues/${UUID}/comments$`),
      // Mở cuộc trò chuyện với agent (lần gửi tin đầu tiên)
      new RegExp(`^/api/companies/${UUID}/chats/${UUID}$`),
      // Duyệt tại chỗ: quyết phiếu duyệt, trả lời / xác nhận câu hỏi của agent
      new RegExp(`^/api/approvals/${UUID}/(approve|reject|request-revision)$`),
      new RegExp(`^/api/issues/${UUID}/interactions/${UUID}/(accept|reject|respond)$`),
    ],
    WS: new RegExp(`^/api/companies/${UUID}/events/ws$`),
  }
}

export function deny(res: ServerResponse, why: string) {
  res.statusCode = 403
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: `coopverse: ${why}` }))
}

/**
 * Chặn mọi lời gọi /api không nằm trong allow-list. Lệnh ghi (POST) còn phải đến từ chính trang
 * Pixel Company và mang header x-coopverse, để trang web lạ không mượn proxy ra lệnh cho agent.
 */
export function paperclipGuard(isOwnOrigin: (o: unknown) => boolean): Handler {
  const rules = allowList()
  return (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api')) return next()
    const path = url.split('?')[0]
    const method = (req.method ?? 'GET').toUpperCase()
    const list = method === 'GET' ? rules.GET : method === 'POST' ? rules.POST : null
    if (!list?.some((r) => r.test(path))) return deny(res, 'endpoint không nằm trong danh sách cho phép')
    if (method !== 'GET' && (req.headers['x-coopverse'] !== '1' || !isOwnOrigin(req.headers.origin))) {
      return deny(res, 'lệnh phải gửi từ trang Pixel Company')
    }
    next()
  }
}

/** WebSocket không đi qua middleware nên kiểm riêng: chỉ kênh sự kiện của công ty, và chỉ từ trang Pixel Company */
export function wsAllowed(url: string | undefined, origin: unknown, isOwnOrigin: (o: unknown) => boolean) {
  return allowList().WS.test((url ?? '').split('?')[0]) && isOwnOrigin(origin)
}
