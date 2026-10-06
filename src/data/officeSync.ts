import { create } from 'zustand'
import { roomOpened } from '../life/director'
import { useCoop } from '../store'
import { useExp } from './exp'
import { apply, fitHouse, type Action, type PlaceOpts } from './decor'
import { emptyOffice, normOffice, spentXu, type OfficeState } from './officeState'
import { isOpen, roomById } from '../world/rooms'
import { earnings, xuGained, type Earnings } from './xu'

/**
 * Văn phòng phía trang: phòng đã mở, đồ + Xu. Xu kiếm được tính lại từ sổ EXP mỗi khi sổ đổi; Xu đã tiêu nằm trong
 * trạng thái văn phòng (server Pixel Company lưu file, bản demo lưu trong trình duyệt).
 */

/** "+25 Xu" bay lên trên đầu agent vừa xong ticket */
export interface XuPop { id: number; amount: number; at: number }

interface OfficeStore {
  office: OfficeState
  ready: boolean
  earned: Earnings
  pops: Record<string, XuPop>
}

const noEarnings = (): Earnings => ({ total: 0, byAgent: {}, byTicket: {} })

export const useOffice = create<OfficeStore>(() => ({ office: emptyOffice(), ready: false, earned: noEarnings(), pops: {} }))

/** Số Xu còn trong quỹ */
export const useBalance = () => useOffice((s) => s.earned.total - spentXu(s.office))

const DEMO_KEY = 'coopverse.demo.office'
export const isDemo = () => new URLSearchParams(location.search).has('demo')
const companyId = () => useCoop.getState().company?.id ?? null

let seq = 0

/** Sổ EXP đổi: tính lại Xu; ticket mới (trừ lần đầu) thì hiện "+Xu" trên đầu agent */
function onLedger() {
  const { ledger, ready } = useExp.getState()
  if (!ready) return
  const prev = useOffice.getState().earned
  const next = earnings(ledger)
  const pops = { ...useOffice.getState().pops }
  if (prev.total || Object.keys(prev.byTicket).length) {
    for (const [id, amount] of xuGained(prev, next, ledger)) pops[id] = { id: ++seq, amount, at: Date.now() }
  }
  useOffice.setState({ earned: next, pops })
}

function loadDemo(): OfficeState {
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    // Nhà đã sửa (trang thiết kế nhà): đồ hết chỗ cất kho, phòng không còn thì trả Xu
    if (raw) return fitHouse(normOffice(JSON.parse(raw) as Partial<OfficeState>))
  } catch { /* trình duyệt chặn bộ nhớ: bắt đầu lại từ đầu */ }
  return fitHouse(emptyOffice())
}

async function fetchOffice(cid: string): Promise<OfficeState> {
  const r = await fetch(`/coop/office/${cid}`, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`Pixel Company trả ${r.status}`)
  return normOffice(((await r.json()) as { office: OfficeState }).office)
}

export function startOfficeSync(): () => void {
  const unLedger = useExp.subscribe((s, p) => { if (s.ledger !== p.ledger || s.ready !== p.ready) onLedger() })
  onLedger()
  if (isDemo()) {
    useOffice.setState({ office: loadDemo(), ready: true })
    return unLedger
  }
  let stopped = false
  let cid: string | null = null
  const load = async () => {
    const id = companyId()
    if (!id || id === cid) return
    cid = id
    useOffice.setState({ office: emptyOffice(), ready: false, earned: noEarnings(), pops: {} })
    onLedger()
    try {
      const o = await fetchOffice(id)
      if (!stopped && id === companyId()) useOffice.setState({ office: o, ready: true })
    } catch {
      // Thử lại lần sau khi công ty / dữ liệu đổi
      if (id === cid) cid = null
    }
  }
  const unCompany = useCoop.subscribe((s, p) => { if (s.company !== p.company || s.issues !== p.issues) void load() })
  void load()
  return () => {
    stopped = true
    unLedger()
    unCompany()
  }
}

/**
 * Gửi một lệnh văn phòng (mở phòng, mua, dời, cất, bán, dời bàn, đồ để bàn: src/data/decor.ts). Bản demo làm ngay trong trình duyệt;
 * bản thật gửi server Pixel Company (server kiểm lại Xu và chỗ đặt). Lỗi (chưa đủ Xu, vướng, mất kết nối) thì ném ra để giao diện báo.
 * `opts.blocked`: ô bàn làm việc (chỉ trang biết) để kiểm trước khi gửi.
 */
export async function act(a: Action, opts: PlaceOpts = {}): Promise<OfficeState> {
  const s = useOffice.getState()
  const have = s.earned.total - spentXu(s.office)
  // Kiểm ở trang trước (cả phần server không biết: bàn làm việc), báo lỗi ngay không cần chờ mạng
  const levelOf = (id: string) => useExp.getState().stats[id]?.level ?? 1
  const local = apply(s.office, a, have, Date.now(), () => `local-${Date.now()}-${++seq}`, { levelOf, ...opts })
  if ('error' in local) throw new Error(local.error)
  let next: OfficeState
  if (isDemo()) {
    next = local.office
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(next)) } catch { /* chỉ giữ trong phiên */ }
  } else {
    const cid = companyId()
    if (!cid) throw new Error('Chưa chọn công ty')
    const r = await fetch(`/coop/office/${cid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-coopverse': '1' },
      body: JSON.stringify(a),
    })
    const body = (await r.json().catch(() => ({}))) as { office?: OfficeState; error?: string }
    if (!r.ok || !body.office) throw new Error(body.error ?? `Pixel Company trả ${r.status}`)
    next = normOffice(body.office)
  }
  useOffice.setState({ office: next })
  return next
}

/** Bản demo: thêm Xu để thử mua đồ (ghi như một khoản tặng trong trình duyệt, sổ EXP và cấp agent không đổi) */
export function demoGift(xu: number) {
  if (!isDemo()) return
  const o = useOffice.getState().office
  const next: OfficeState = { ...o, spent: [...o.spent, { id: `gift-${Date.now()}-${++seq}`, at: Date.now(), kind: 'gift', ref: 'demo', xu: -xu }] }
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(next)) } catch { /* chỉ giữ trong phiên */ }
  useOffice.setState({ office: next })
}

/** Trả Xu mở một phòng */
export async function openRoom(id: string): Promise<void> {
  const room = roomById.get(id)
  if (!room) throw new Error('Không có phòng này')
  if (isOpen(useOffice.getState().office, id)) return
  await act({ action: 'room', room: id })
  roomOpened(room)
}

/** Bản demo: bắt đầu lại văn phòng như lúc đầu (nút trong bảng Mở phòng) */
export function resetDemoOffice() {
  if (!isDemo()) return
  try { localStorage.removeItem(DEMO_KEY) } catch { /* bỏ qua */ }
  useOffice.setState({ office: emptyOffice() })
}
