import { useState, type ReactNode } from 'react'
import { uiTick } from '../audio/engine'
import { resolveAsk, useAskDetail, type AskAction } from '../data/asks'
import { issueUrl, PAPERCLIP_UI, type ApprovalVerb, type AskAnswer } from '../data/paperclip'
import { candidateCanHire, hireWarnings } from '../data/hire'
import { ago } from '../data/kanban'
import { askLabel, type Agent, type Ask, type Comment } from '../data/types'
import { useCoop } from '../store'
import { Md } from './Md'

// "x phút trước" dùng chung với bảng ticket (làm tròn xuống), để cùng một mốc thì hai nơi ghi giống nhau
export { ago }

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const list = (v: unknown) => (Array.isArray(v) ? v : [])

/** Nút bấm + bước xác nhận: bấm nút chính → hiện câu hỏi lại → Xác nhận mới gửi. */
interface Pending { label: string; body: string; ok: string; cls: string; action: AskAction; needs?: string }

function useResolve(ask: Ask) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async (action: AskAction) => {
    setBusy(true)
    setErr(null)
    const e = await resolveAsk(ask, action)
    // Thành công thì thẻ biến mất (việc đã bỏ khỏi danh sách); lỗi thì giữ thẻ, hiện lỗi
    setBusy(false)
    if (e) setErr(e)
    else uiTick()
  }
  return { pending, setPending, busy, err, setErr, go }
}

/** Hàng xác nhận cuối thẻ. */
function ConfirmRow({ p, busy, err, onOk, onCancel }: { p: Pending; busy: boolean; err: string | null; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="ask-confirm" role="alertdialog" aria-label={p.label}>
      <div className="ask-confirm-text"><b>{p.label}</b> {p.body}</div>
      {err && <div className="t-dialog-err">{err}</div>}
      <div className="ask-btns">
        <button className="t-btn" onClick={onCancel} disabled={busy}>Huỷ</button>
        <button className={`t-btn t-primary ${p.cls}`} onClick={onOk} disabled={busy || !!p.needs} title={p.needs}>
          {busy ? 'Đang gửi…' : p.ok}
        </button>
      </div>
    </div>
  )
}

/** Paperclip không cho xử lý ngay ở ngoài (vd duyệt thao tác nguy hiểm): mở trang của Paperclip. */
function OpenInPaperclip({ ask, why }: { ask: Ask; why: string }) {
  const demo = useCoop((s) => s.conn === 'demo')
  return (
    <div className="ask-note">
      {why}
      {!demo && <a className="t-btn t-link" href={ask.href} target="_blank" rel="noreferrer">Mở trong Paperclip ↗</a>}
    </div>
  )
}

/** Một dòng "nhãn: giá trị" */
const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="ask-row"><span className="ask-k">{k}</span><span className="ask-v">{children}</span></div>
)

const KNOWN_KEYS = new Set([
  'title', 'summary', 'recommendedAction', 'risks', 'reason', 'name', 'role', 'capabilities', 'adapterType',
  'adapterConfig', 'runtimeConfig', 'budgetMonthlyCents', 'desiredSkills', 'metadata', 'reportsTo', 'icon',
  'requestedConfigurationSnapshot', 'source',
])

/** Trường lạ trong phiếu (chữ / số ngắn), để không bỏ sót thông tin; bỏ id và cấu hình máy */
function extraRows(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([k, v]) => !KNOWN_KEYS.has(k) && !/id$/i.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim())
    .slice(0, 8)
    .map(([k, v]) => <Row key={k} k={k}>{String(v).slice(0, 240)}</Row>)
}

// ───────── Phiếu duyệt ─────────

function ApprovalBody({ ask, payload, who, agents, comments = [] }: { ask: Ask; payload: Record<string, unknown>; who?: Agent; agents: Agent[]; comments?: Comment[] }) {
  const r = useResolve(ask)
  const [note, setNote] = useState('')
  const hire = ask.type === 'hire_agent'
  // Paperclip coi mọi phiếu "xin bạn duyệt" là phải mở trang của nó, vì loại này còn dùng cho thao tác công cụ
  // nguy hiểm (cần xem đối số). Phiếu agent tự viết thì duyệt ngay được; phiếu từ cổng công cụ vẫn mở Paperclip.
  const inline = ask.inline || (ask.type === 'request_board_approval' && payload.source !== 'tool_gateway')
  const cfg = rec(payload.adapterConfig)
  const boss = agents.find((a) => a.id === payload.reportsTo)
  const budget = typeof payload.budgetMonthlyCents === 'number' ? `$${(payload.budgetMonthlyCents / 100).toFixed(2)} / tháng` : null
  const risks = list(payload.risks).map(text).filter(Boolean) as string[]
  const skills = list(payload.desiredSkills).map((s) => text(s) ?? text(rec(s).key) ?? text(rec(s).name)).filter(Boolean) as string[]
  // Hồ sơ ứng viên: lý do thuê nằm trong bình luận của agent trên phiếu; cảnh báo khi vượt luật thuê
  const warns = hire ? hireWarnings(agents, ask.agentId, payload) : []
  const overRule = warns.some((w) => w.level === 'red')
  const why = comments.filter((c) => c.authorAgentId)
  const canHire = candidateCanHire(agents, payload)

  const wake = who ? ` Paperclip sẽ đánh thức ${who.name} để làm tiếp (một lượt chạy, tốn token).` : ''
  const choose = (verb: ApprovalVerb) => {
    r.setErr(null)
    const n = note.trim()
    const p: Record<ApprovalVerb, Pending> = {
      approve: {
        label: overRule ? 'Duyệt dù vượt luật thuê?' : hire ? 'Nhận ứng viên này?' : 'Duyệt phiếu này?',
        body: (hire ? `Agent "${text(payload.name) ?? 'mới'}" được tạo, về bàn và bắt đầu nhận việc.` : '') + wake,
        ok: 'Duyệt', cls: 't-btn-wake', action: { do: 'approval', verb, note: n },
      },
      'request-revision': {
        label: 'Yêu cầu sửa?',
        body: `Phiếu quay lại cho ${who?.name ?? 'người gửi'} sửa theo ghi chú của bạn rồi gửi lại.`,
        ok: 'Gửi yêu cầu sửa', cls: 't-btn-resume', action: { do: 'approval', verb, note: n },
      },
      reject: {
        label: 'Từ chối phiếu này?',
        body: hire ? 'Ứng viên rời sảnh, agent không được tạo.' : 'Phiếu đóng lại, agent không được làm việc này.',
        ok: 'Từ chối', cls: 't-btn-reject', action: { do: 'approval', verb, note: n },
      },
    }
    r.setPending(p[verb])
  }

  return (
    <>
      {hire && (
        <div className="ask-rows">
          <Row k="Tên">{text(payload.name) ?? '—'}{text(payload.title) ? ` · ${text(payload.title)}` : ''}</Row>
          {text(payload.role) && <Row k="Vai trò">{text(payload.role)}</Row>}
          <Row k="Báo cáo cho">{boss?.name ?? (payload.reportsTo ? 'agent khác' : 'không ai (cấp cao nhất)')}</Row>
          {text(payload.capabilities) && <Row k="Làm gì">{text(payload.capabilities)}</Row>}
          <Row k="Model">{text(cfg.model) ?? 'mặc định'} <span className="muted">· {text(payload.adapterType) ?? '?'}</span></Row>
          {budget && <Row k="Ngân sách">{budget}</Row>}
          {skills.length > 0 && <Row k="Kỹ năng">{skills.join(', ')}</Row>}
          <Row k="Được thuê tiếp">{canHire === false ? 'Không' : canHire ? 'Có' : 'Không rõ'}</Row>
        </div>
      )}
      {hire && why.length > 0 && (
        <div className="hire-why">
          <b>Lý do{who ? ` của ${who.name}` : ''}</b>
          {why.map((c) => <div key={c.id} className="ask-md"><Md text={c.body} /></div>)}
        </div>
      )}
      {hire && !why.length && !text(payload.reason) && <div className="ask-muted">Agent chưa viết lý do thuê trong bình luận phiếu.</div>}
      {warns.length > 0 && (
        <ul className="hire-warns">
          {warns.map((w) => <li key={w.text} className={`lvl-${w.level}`}>{w.level === 'red' ? '⛔' : '⚠'} {w.text}</li>)}
        </ul>
      )}
      {text(payload.summary) && <div className="ask-md"><Md text={text(payload.summary)!} /></div>}
      {text(payload.reason) && <Row k="Lý do">{text(payload.reason)}</Row>}
      {text(payload.recommendedAction) && <Row k="Đề xuất">{text(payload.recommendedAction)}</Row>}
      {risks.length > 0 && (
        <div className="ask-risks"><b>Rủi ro</b><ul>{risks.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}
      <div className="ask-rows">{extraRows(payload)}</div>

      {!inline ? (
        <OpenInPaperclip ask={ask} why="Phiếu này xin chạy một thao tác công cụ: Paperclip yêu cầu xem kỹ đối số trong trang của nó trước khi duyệt." />
      ) : (
        <>
          <textarea
            className="ask-text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú cho agent (không bắt buộc; bắt buộc khi yêu cầu sửa)"
            rows={2}
            disabled={r.busy}
            aria-label="Ghi chú quyết định"
          />
          {r.pending && r.pending.action.do === 'approval' ? (
            <ConfirmRow
              p={{ ...r.pending, needs: r.pending.action.verb === 'request-revision' && !note.trim() ? 'Viết ghi chú cần sửa gì trước' : undefined }}
              busy={r.busy} err={r.err}
              // Lấy ghi chú lúc bấm Xác nhận (có thể đã sửa sau khi chọn nút)
              onOk={() => r.go({ do: 'approval', verb: (r.pending!.action as { verb: ApprovalVerb }).verb, note: note.trim() })}
              onCancel={() => r.setPending(null)}
            />
          ) : (
            <div className="ask-btns">
              <button className="t-btn t-btn-reject" onClick={() => choose('reject')}>Từ chối</button>
              <button className="t-btn t-btn-resume" onClick={() => choose('request-revision')}>Yêu cầu sửa</button>
              <button className="t-btn t-primary t-btn-wake" onClick={() => choose('approve')}>Duyệt</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ───────── Xin xác nhận ─────────

function ConfirmBody({ ask, payload, who }: { ask: Ask; payload: Record<string, unknown>; who?: Agent }) {
  const r = useResolve(ask)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const target = rec(payload.target)
  const href = text(target.href)
  const needReason = payload.rejectRequiresReason === true
  const askReason = needReason || payload.allowDeclineReason !== false
  // Thao tác công cụ / đề xuất bí mật: Paperclip cần màn hình riêng để xem đối số
  const special = !!payload.toolAction || !!payload.secretProposal
  const yes = text(payload.acceptLabel) ?? 'Đồng ý'
  const no = text(payload.rejectLabel) ?? 'Từ chối'

  return (
    <>
      {text(payload.prompt) && <div className="ask-prompt">{text(payload.prompt)}</div>}
      {text(payload.detailsMarkdown) && <div className="ask-md"><Md text={text(payload.detailsMarkdown)!} /></div>}
      {href && (
        <a className="ask-target" href={href.startsWith('/') ? `${PAPERCLIP_UI}${href}` : href} target="_blank" rel="noreferrer">
          {text(target.label) ?? 'Xem tài liệu'} ↗
        </a>
      )}
      {special || !ask.inline ? (
        <OpenInPaperclip ask={ask} why="Việc này cần xem chi tiết trong Paperclip trước khi trả lời." />
      ) : (
        <>
          {rejecting && askReason && (
            <textarea
              className="ask-text"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={text(payload.declineReasonPlaceholder) ?? (needReason ? 'Lý do (bắt buộc)' : 'Lý do / cần sửa gì (không bắt buộc)')}
              rows={2}
              disabled={r.busy}
              aria-label="Lý do từ chối"
            />
          )}
          {r.pending ? (
            <ConfirmRow
              p={{ ...r.pending, needs: rejecting && needReason && !reason.trim() ? 'Cần ghi lý do' : undefined }}
              busy={r.busy} err={r.err}
              onOk={() => r.go(rejecting ? { do: 'reject', reason } : { do: 'accept' })}
              onCancel={() => { r.setPending(null); setRejecting(false) }}
            />
          ) : (
            <div className="ask-btns">
              <button className="t-btn t-btn-reject" onClick={() => {
                setRejecting(true)
                r.setPending({ label: `${no}?`, body: `${who?.name ?? 'Agent'} sẽ nhận câu trả lời "${no}" và lý do của bạn.`, ok: no, cls: 't-btn-reject', action: { do: 'reject' } })
              }}>{no}</button>
              <button className="t-btn t-primary t-btn-wake" onClick={() => {
                setRejecting(false)
                r.setPending({ label: `${yes}?`, body: who ? `${who.name} sẽ làm tiếp theo xác nhận của bạn.` : '', ok: yes, cls: 't-btn-wake', action: { do: 'accept' } })
              }}>{yes}</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ───────── Câu hỏi có lựa chọn ─────────

interface QOption { id: string; label: string; description?: string | null; freeText?: boolean }
interface Question { id: string; prompt: string; helpText?: string | null; selectionMode: 'single' | 'multi'; required?: boolean; allowOther?: boolean; options: QOption[] }

/** Lựa chọn "Khác…" khi câu hỏi cho phép tự viết */
const OTHER = '__other'

function QuestionsBody({ ask, payload, who }: { ask: Ask; payload: Record<string, unknown>; who?: Agent }) {
  const r = useResolve(ask)
  const qs = list(payload.questions).map(rec).filter((q) => text(q.id) && text(q.prompt)) as unknown as Question[]
  const [sel, setSel] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const pick = (q: Question, id: string, on: boolean) =>
    setSel((s) => {
      const cur = s[q.id] ?? []
      const next = q.selectionMode === 'single' ? (on ? [id] : []) : on ? [...cur, id] : cur.filter((x) => x !== id)
      return { ...s, [q.id]: next }
    })
  /** Ô tự viết đang mở: chọn "Khác…" hoặc chọn phương án có ô viết */
  const writing = (q: Question) => (sel[q.id] ?? []).some((id) => id === OTHER || q.options.find((o) => o.id === id)?.freeText)

  const answers: AskAnswer[] = qs.map((q) => ({
    questionId: q.id,
    optionIds: (sel[q.id] ?? []).filter((id) => id !== OTHER),
    otherText: writing(q) && other[q.id]?.trim() ? other[q.id].trim() : null,
  }))
  const missing = qs.filter((q, i) => q.required && !answers[i].optionIds.length && !answers[i].otherText)

  return (
    <>
      {qs.map((q) => (
        <fieldset key={q.id} className="ask-q" disabled={r.busy}>
          <legend>{q.prompt}{q.required && <span className="ask-req"> *</span>}</legend>
          {q.helpText && <div className="ask-help">{q.helpText}</div>}
          {[...q.options, ...(q.allowOther ? [{ id: OTHER, label: 'Khác…' }] : [])].map((o) => {
            const on = (sel[q.id] ?? []).includes(o.id)
            return (
              <label key={o.id} className={`ask-opt${on ? ' on' : ''}`}>
                <input
                  type={q.selectionMode === 'single' ? 'radio' : 'checkbox'}
                  name={`${ask.id}-${q.id}`}
                  checked={on}
                  onChange={(e) => pick(q, o.id, e.target.checked)}
                />
                <span>
                  {o.label}
                  {'description' in o && o.description && <small>{o.description}</small>}
                </span>
              </label>
            )
          })}
          {writing(q) && (
            <input
              type="text"
              className="ask-other"
              value={other[q.id] ?? ''}
              onChange={(e) => setOther((s) => ({ ...s, [q.id]: e.target.value }))}
              placeholder="Viết câu trả lời của bạn"
              aria-label={`Câu trả lời khác cho: ${q.prompt}`}
            />
          )}
        </fieldset>
      ))}
      {!ask.inline ? (
        <OpenInPaperclip ask={ask} why="Câu hỏi này phải trả lời trong Paperclip." />
      ) : r.pending ? (
        <ConfirmRow p={r.pending} busy={r.busy} err={r.err} onOk={() => r.go({ do: 'answer', answers })} onCancel={() => r.setPending(null)} />
      ) : (
        <div className="ask-btns">
          {missing.length > 0 && <span className="ask-miss">Còn {missing.length} câu bắt buộc</span>}
          <button
            className="t-btn t-primary t-btn-wake"
            disabled={missing.length > 0}
            onClick={() => r.setPending({
              label: 'Gửi câu trả lời?',
              body: who ? `Paperclip sẽ đánh thức ${who.name} đọc câu trả lời và làm tiếp (tốn token).` : '',
              ok: text(payload.submitLabel) ?? 'Gửi', cls: 't-btn-wake', action: { do: 'answer', answers },
            })}
          >
            {text(payload.submitLabel) ?? 'Gửi câu trả lời'}
          </button>
        </div>
      )}
    </>
  )
}

// ───────── Thẻ ─────────

/** Thẻ một việc chờ bạn: nội dung + nút quyết. Dùng ở tab "Duyệt" tại bàn agent, ô chat và thẻ duyệt nhanh. */
export function AskCard({ ask }: { ask: Ask }) {
  const agents = useCoop((s) => s.agents)
  const demo = useCoop((s) => s.conn === 'demo')
  const who = agents.find((a) => a.id === ask.agentId)
  const view = useAskDetail(ask)
  const d = view.detail

  let body: ReactNode = null
  if (view.state === 'loading') body = <div className="ask-muted">Đang mở…</div>
  else if (view.state === 'error' || !d) body = <div className="ask-muted t-errbox">Không đọc được: {view.error}</div>
  else if (d.status !== 'pending') body = <div className="ask-muted">Việc này đã được xử lý.</div>
  else if (ask.kind === 'approval') body = <ApprovalBody ask={ask} payload={d.payload} who={who} agents={agents} comments={d.source === 'approval' ? d.comments : undefined} />
  else if (ask.kind === 'confirm') body = <ConfirmBody ask={ask} payload={d.payload} who={who} />
  else if (ask.kind === 'questions') body = <QuestionsBody ask={ask} payload={d.payload} who={who} />
  else {
    body = (
      <>
        {ask.excerpt && <div className="ask-prompt">{ask.excerpt}</div>}
        <OpenInPaperclip ask={ask} why="Loại câu hỏi này trả lời trong Paperclip." />
      </>
    )
  }

  return (
    <article className={`ask-card kind-${ask.kind}`} aria-label={`${askLabel(ask)}: ${ask.title}`}>
      <div className="ask-head">
        <span className="ask-tag">{askLabel(ask)}</span>
        <span className="ask-who">{who?.name ?? 'Paperclip'} · {ago(ask.createdAt)}</span>
        {ask.issueKey && !demo && (
          <a className="ask-issue" href={issueUrl(ask.issueKey)} target="_blank" rel="noreferrer">{ask.issueKey} ↗</a>
        )}
      </div>
      <div className="ask-title">{ask.title}</div>
      {body}
    </article>
  )
}
