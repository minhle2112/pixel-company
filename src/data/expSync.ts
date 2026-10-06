import { leveledUp } from '../life/director'
import { useCoop } from '../store'
import { applyLedger, titleOf } from './exp'
import type { Ledger } from './ledger'
import { mockLedger } from './mock'

/** Đọc sổ không dày hơn mức này (dữ liệu Paperclip đổi liên tục lúc agent chạy) */
const MIN_GAP_MS = 4000
/** Đọc định kỳ phòng khi không có gì thúc (vd tuần mới bắt đầu) */
const POLL_MS = 60_000

function onLevelUp(agentId: string, level: number) {
  const name = useCoop.getState().agents.find((a) => a.id === agentId)?.name ?? 'Agent'
  useCoop.getState().pushNotes([{ kind: 'level', text: `⭐ ${name} lên cấp ${level} · ${titleOf(level)}` }])
  leveledUp(agentId, level)
}

const companyId = () => useCoop.getState().company?.id ?? null

async function fetchLedger(cid: string): Promise<Ledger> {
  const r = await fetch(`/coop/exp/${cid}`, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`Pixel Company trả ${r.status}`)
  return ((await r.json()) as { ledger: Ledger }).ledger
}

/**
 * Giữ EXP khớp với Paperclip: đọc sổ (server Pixel Company tự chép việc mới từ Paperclip vào) mỗi khi dữ liệu
 * Pixel Company vừa đọc lại (agent / ticket đổi), tối đa mỗi 4 giây một lần. Bản demo dùng sổ giả.
 */
export function startExpSync(): () => void {
  if (new URLSearchParams(location.search).has('demo')) {
    applyLedger(mockLedger(), onLevelUp)
    return () => {}
  }
  let stopped = false
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let busy = false

  async function run() {
    const cid = companyId()
    if (stopped || !cid || busy) return
    busy = true
    last = Date.now()
    try {
      const ledger = await fetchLedger(cid)
      if (!stopped && cid === companyId()) applyLedger(ledger, onLevelUp)
    } catch { /* thử lại lần sau */ }
    busy = false
  }
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(run, Math.max(0, last + MIN_GAP_MS - Date.now()))
  }

  const unsub = useCoop.subscribe((s, p) => {
    if (s.issues !== p.issues || s.agents !== p.agents || s.company !== p.company) kick()
  })
  kick()
  const poll = setInterval(kick, POLL_MS)
  return () => {
    stopped = true
    unsub()
    clearTimeout(timer)
    clearInterval(poll)
  }
}
