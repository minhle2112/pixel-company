/**
 * Sổ EXP của một công ty: mọi việc làm được tính điểm mà Pixel Company đã thấy trên Paperclip.
 * Dùng chung cho trang (src/data/exp.ts, src/data/xu.ts) và server nhỏ của Pixel Company (server/coopData.ts, lưu sổ thành file).
 * Thời điểm lưu bằng mili giây.
 */
export interface Ledger {
  v: 1
  /** Lượt chạy thành công: runId → [agentId, lúc xong] */
  runs: Record<string, [string, number]>
  /** Ticket xong: issueId → [agentId người được giao, lúc xong, độ ưu tiên, mã ticket] */
  tickets: Record<string, [string, number, string, string]>
  /** Phiếu agent gửi được duyệt: approvalId → [agentId, lúc duyệt, loại phiếu] */
  approvals: Record<string, [string, number, string]>
  /**
   * Lời khen của bản cũ (nút Khen đã bỏ). Giữ nguyên trong file cho khỏi mất dữ liệu,
   * nhưng không còn tính EXP và không ghi thêm.
   */
  kudos?: unknown[]
}

export const emptyLedger = (): Ledger => ({ v: 1, runs: {}, tickets: {}, approvals: {} })
