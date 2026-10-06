import { useEffect, useState } from 'react'
import { askAnswered } from '../life/director'
import { useCoop } from '../store'
import { MOCK_ASK_DETAILS } from './mock'
import { paperclip, PaperclipError, type ApprovalVerb, type AskAnswer, type AskDetail } from './paperclip'
import { requestRefresh } from './sync'
import type { Ask } from './types'

/** Bạn quyết gì với một việc chờ. */
export type AskAction =
  | { do: 'approval'; verb: ApprovalVerb; note?: string }
  | { do: 'accept' }
  | { do: 'reject'; reason?: string }
  | { do: 'answer'; answers: AskAnswer[] }

export interface AskDetailView { state: 'loading' | 'ready' | 'error'; detail?: AskDetail; error?: string }

/** Đọc nội dung đầy đủ của một việc chờ khi mở thẻ (bản demo: dữ liệu giả). */
export function useAskDetail(ask: Ask): AskDetailView {
  const demo = useCoop((s) => s.conn === 'demo')
  const [view, setView] = useState<AskDetailView>({ state: 'loading' })
  useEffect(() => {
    if (demo) {
      const d = MOCK_ASK_DETAILS[ask.id]
      setView(d ? { state: 'ready', detail: d } : { state: 'error', error: 'Bản demo không có nội dung cho việc này' })
      return
    }
    let off = false
    setView({ state: 'loading' })
    paperclip
      .askDetail(ask)
      .then((detail) => { if (!off) setView({ state: 'ready', detail }) })
      .catch((e) => { if (!off) setView({ state: 'error', error: e instanceof PaperclipError ? e.message : String(e) }) })
    return () => { off = true }
    // Chỉ đọc lại khi đổi sang việc khác (ask là object mới sau mỗi lần đồng bộ)
  }, [ask.id, demo])
  return view
}

const VERB_DONE: Record<ApprovalVerb, string> = {
  approve: 'Đã duyệt',
  reject: 'Đã từ chối',
  'request-revision': 'Đã yêu cầu sửa',
}

/** Kết quả có "tốt" cho agent không (để agent vui hay xụ mặt) */
const isGood = (a: AskAction) => a.do === 'accept' || a.do === 'answer' || (a.do === 'approval' && a.verb === 'approve')

/**
 * Gửi quyết định lên Paperclip. Xong thì bỏ việc khỏi danh sách ngay, báo một dòng, agent phản ứng,
 * rồi đọc lại dữ liệu. Trả về lỗi để hiện trên thẻ (null = ổn).
 */
export async function resolveAsk(ask: Ask, action: AskAction): Promise<string | null> {
  const s = useCoop.getState()
  const demo = s.conn === 'demo'
  const who = s.agents.find((a) => a.id === ask.agentId)?.name
  try {
    if (!demo) {
      if (action.do === 'approval') await paperclip.decideApproval(ask.id, action.verb, action.note)
      else {
        if (!ask.issueId) return 'Câu hỏi không gắn với ticket nào, hãy trả lời trong Paperclip'
        if (action.do === 'accept') await paperclip.acceptAsk(ask.issueId, ask.id)
        else if (action.do === 'reject') await paperclip.rejectAsk(ask.issueId, ask.id, action.reason)
        else await paperclip.answerAsk(ask.issueId, ask.id, action.answers)
      }
    }
  } catch (e) {
    // Đã có người xử lý ở nơi khác (trong Paperclip) hoặc việc không còn nữa
    if (e instanceof PaperclipError && (e.status === 404 || e.status === 409)) {
      s.removeAsk(ask.id)
      s.pushNotes([{ kind: 'info', text: `"${ask.title}" đã được xử lý ở nơi khác` }])
      requestRefresh()
      return null
    }
    return `Không gửi được: ${e instanceof PaperclipError ? e.message : String(e)}`
  }
  const what =
    action.do === 'approval' ? VERB_DONE[action.verb] :
    action.do === 'accept' ? 'Đã xác nhận' :
    action.do === 'reject' ? 'Đã từ chối' : 'Đã trả lời'
  s.removeAsk(ask.id)
  s.pushNotes([{ kind: 'info', text: `${what}: ${ask.title}${who ? ` (${who})` : ''}${demo ? ' (demo)' : ''}` }])
  if (ask.agentId) askAnswered(ask.agentId, isGood(action))
  if (demo && ask.candidateId && action.do === 'approval' && action.verb !== 'request-revision') demoHire(ask.candidateId, action.verb === 'approve')
  // Yêu cầu sửa: ứng viên vẫn ở sảnh chờ nộp lại (Paperclip không còn phiếu "pending"), bấm vào thì báo đang sửa
  const cand = ask.candidateId
  if (cand && action.do === 'approval' && action.verb === 'request-revision') useCoop.setState((st) => ({ revising: { ...st.revising, [cand]: true } }))
  requestRefresh()
  return null
}

/** Bản demo: duyệt thì ứng viên thành nhân viên (đi từ sảnh về bàn trong cụm bàn), từ chối thì rời văn phòng. */
function demoHire(id: string, ok: boolean) {
  const s = useCoop.getState()
  const a = s.agents.find((x) => x.id === id)
  if (!a) return
  const boss = s.agents.find((x) => x.id === a.reportsTo)?.name
  useCoop.setState({
    agents: ok ? s.agents.map((x) => (x.id === id ? { ...x, candidate: undefined, status: 'idle' as const } : x)) : s.agents.filter((x) => x.id !== id),
  })
  s.pushNotes([ok
    ? { kind: 'done', text: `🎉 ${a.name} được nhận vào làm${boss ? `, báo cáo cho ${boss}` : ''} (demo)` }
    : { kind: 'info', text: `Hồ sơ ${a.name} bị từ chối (demo)` }])
}
