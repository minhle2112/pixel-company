import { create } from 'zustand'
import { standUp, takeSpot } from './life/playerUse'
import { input } from './runtime'
import type { NoteDraft, NoteKind } from './data/notify'
import { useDeco } from './ui/decoStore'
import { STATUS_CYCLE, type Agent, type Ask, type ChatInfo, type Company, type Issue } from './data/types'

interface Toast { id: number; text: string }
export interface Note { id: number; kind: NoteKind; text: string }

/** connecting: chưa có dữ liệu · live: đang nhận realtime · offline: mất Paperclip · demo: dữ liệu giả (?demo) */
export type Conn = 'connecting' | 'live' | 'offline' | 'demo'

const NOTE_MS = 9000
const MAX_NOTES = 5

interface CoopState {
  /** Mọi công ty trên Paperclip này, và công ty đang xem (null khi demo hoặc chưa đọc được) */
  companies: Company[]
  company: Company | null
  agents: Agent[]
  issues: Issue[]
  /** Cuộc trò chuyện Agent Chat của bạn với từng agent (đã nhắn ít nhất một lần) */
  chats: ChatInfo[]
  /** Việc đang chờ bạn quyết: phiếu duyệt + câu hỏi của agent */
  asks: Ask[]
  conn: Conn
  /** Đã từng nhận được dữ liệu thật chưa */
  hasData: boolean
  version: string | null
  /** Lúc sẽ thử kết nối lại (ms), khi offline */
  retryAt: number | null
  notes: Note[]
  /** Agent đang được đánh dấu trên minimap */
  ping: { id: string; at: number } | null
  nearId: string | null
  /** Người / bảng đang được rê chuột lên trên bản đồ pixel (id agent, 'player', '#board', '#fame') */
  hoverId: string | null
  /** Agent đang được xem màn hình (camera zoom vào, hiện CLI) */
  focusId: string | null
  /** Đứng trước bảng ticket (bấm E để xem) */
  nearBoard: boolean
  /** Đang xem bảng ticket phóng to */
  boardOpen: boolean
  /** Đứng trước bảng vinh danh (xếp hạng EXP) */
  nearFame: boolean
  /** Đang xem bảng vinh danh phóng to */
  fameOpen: boolean
  /** Đứng gần đồ dùng được (sofa, máy game...): id chỗ trong life/spots.ts */
  nearUse: string | null
  /** Bạn đang ngồi / dùng chỗ này */
  using: string | null
  /** Tủ đồ đang mở cho ai ('player' = bạn, hoặc id agent) */
  wardrobeId: string | null
  settingsOpen: boolean
  /** Bảng mở phòng (phím B): phòng khoá hiện giá, bấm phòng nào để trả Xu mở phòng đó */
  roomsOpen: boolean
  /** Phòng khoá đang chọn (id trong src/world/rooms.ts) */
  roomPick: string | null
  /** Danh sách "Chờ duyệt" (phím Q) đang mở */
  inboxOpen: boolean
  /** Thẻ duyệt nhanh đang mở (id việc chờ): mở từ danh sách, không cần đi tới bàn */
  askId: string | null
  locked: boolean
  /** Ứng viên bạn đã bấm "Yêu cầu sửa" hồ sơ: đứng chờ ở sảnh, chưa có phiếu mới để duyệt */
  revising: Record<string, true>
  toast: Toast | null

  setCompanies: (companies: Company[], company: Company | null) => void
  /** `asks` không truyền = giữ danh sách việc chờ hiện tại */
  setSnapshot: (agents: Agent[], issues: Issue[], chats?: ChatInfo[], asks?: Ask[]) => void
  /** Bỏ một việc chờ ngay khi bạn vừa xử lý xong (không chờ Paperclip đọc lại) */
  removeAsk: (id: string) => void
  toggleInbox: () => void
  openAsk: (id: string) => void
  closeAsk: () => void
  setConn: (conn: Conn, retryAt?: number | null) => void
  setVersion: (v: string | null) => void
  pushNotes: (drafts: NoteDraft[]) => void
  dismissNote: (id: number) => void
  pingAgent: (id: string) => void
  setNear: (id: string | null, board?: boolean, fame?: boolean, use?: string | null) => void
  /** Đứng dậy khỏi chỗ đang dùng (đi tiếp, mở chế độ khác) */
  leaveUse: () => void
  setHover: (id: string | null) => void
  /** Mở thứ của một người: agent → CLI, ứng viên → phiếu thuê, đã nghỉ → báo. Dùng cho phím E, bấm chuột, danh sách nhân sự */
  openAgent: (id: string) => void
  setLocked: (v: boolean) => void
  showToast: (text: string) => void
  openFocus: (id: string) => void
  closeFocus: () => void
  openBoard: () => void
  closeBoard: () => void
  openFame: () => void
  closeFame: () => void
  openWardrobe: (id?: string) => void
  closeWardrobe: () => void
  toggleSettings: () => void
  toggleRooms: () => void
  /** Chế độ trang trí (phím T): cửa hàng, đặt / dời đồ, dời bàn. Trạng thái chi tiết ở src/ui/decoStore.ts */
  toggleDeco: () => void
  pickRoom: (id: string | null) => void
  /** Bấm vào phòng khoá trên bản đồ: mở bảng mở phòng, chọn sẵn phòng đó */
  showRoom: (id: string) => void
  /** Esc: đóng lớp đang mở trên cùng. Trả về false nếu không có gì để đóng. */
  closeTop: () => boolean
  /** Chỉ bản demo: bấm vào tên trong danh sách để đổi trạng thái */
  cycleStatus: (id: string) => void
  interact: () => void
}

let seq = 0

export const useCoop = create<CoopState>((set, get) => ({
  companies: [],
  company: null,
  agents: [],
  issues: [],
  chats: [],
  asks: [],
  conn: 'connecting',
  hasData: false,
  version: null,
  retryAt: null,
  notes: [],
  ping: null,
  nearId: null,
  hoverId: null,
  focusId: null,
  nearBoard: false,
  boardOpen: false,
  nearFame: false,
  fameOpen: false,
  nearUse: null,
  using: null,
  wardrobeId: null,
  settingsOpen: false,
  roomsOpen: false,
  roomPick: null,
  inboxOpen: false,
  askId: null,
  locked: false,
  revising: {},
  toast: null,

  setCompanies: (companies, company) => set({ companies, company }),
  setSnapshot: (agents, issues, chats = [], asks) =>
    set((s) => {
      const list = asks ?? s.asks
      // Việc đang mở đã được xử lý ở nơi khác (vd trong Paperclip): đóng thẻ
      const askId = s.askId && list.some((a) => a.id === s.askId) ? s.askId : null
      // Hết việc chờ thì danh sách coi như đóng: việc mới tới không tự bung ra
      return { agents, issues, chats, asks: list, askId, hasData: true, inboxOpen: s.inboxOpen && list.length > 0 }
    }),
  removeAsk: (id) => set((s) => {
    const asks = s.asks.filter((a) => a.id !== id)
    return { asks, askId: s.askId === id ? null : s.askId, inboxOpen: s.inboxOpen && asks.length > 0 }
  }),
  toggleInbox: () => {
    // Không có việc chờ: không có gì để mở
    if (!get().inboxOpen && !get().asks.length) return
    if (!get().inboxOpen && document.pointerLockElement) document.exitPointerLock()
    set((s) => ({ inboxOpen: !s.inboxOpen }))
  },
  openAsk: (id) => {
    if (document.pointerLockElement) document.exitPointerLock()
    input.keys.clear()
    set({ askId: id, settingsOpen: false })
  },
  closeAsk: () => set({ askId: null }),
  setConn: (conn, retryAt = null) => set({ conn, retryAt }),
  setVersion: (version) => set({ version }),
  pushNotes: (drafts) => {
    if (!drafts.length) return
    const added = drafts.map((d) => ({ ...d, id: ++seq }))
    set((s) => ({ notes: [...s.notes, ...added].slice(-MAX_NOTES) }))
    for (const n of added) setTimeout(() => get().dismissNote(n.id), NOTE_MS)
  },
  dismissNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  pingAgent: (id) => {
    // Mũi tên trên đầu tắt sau 6 s: vạch 📍 trong danh sách nhân sự tắt cùng lúc
    const ping = { id, at: performance.now() }
    set({ ping })
    setTimeout(() => { if (get().ping === ping) set({ ping: null }) }, 6000)
  },
  setNear: (id, board = false, fame = false, use = null) => set({ nearId: id, nearBoard: board, nearFame: fame, nearUse: use }),
  leaveUse: () => {
    if (!get().using) return
    standUp()
    set({ using: null })
  },
  setHover: (id) => set({ hoverId: id }),
  openAgent: (id) => {
    const { agents, asks, openAsk, openFocus, showToast } = get()
    const a = agents.find((x) => x.id === id)
    if (!a) return
    // Mở từ danh sách nhân sự khi đang xem thứ khác: đóng cái đang xem, không chồng hai bảng lên nhau
    set({ focusId: null, boardOpen: false, fameOpen: false, wardrobeId: null, askId: null, inboxOpen: false })
    // Ứng viên ở sảnh: mở hồ sơ (phiếu thuê) để duyệt
    if (a.candidate) {
      const hire = asks.find((x) => x.candidateId === a.id)
      if (hire) return openAsk(hire.id)
      return showToast(get().revising[a.id]
        ? `${a.name} đang sửa hồ sơ theo yêu cầu của bạn. Có bản mới thì phiếu duyệt hiện lại trong danh sách việc chờ.`
        : `Hồ sơ của ${a.name} chưa tải xong, thử lại sau giây lát.`)
    }
    if (a.status === 'terminated') return showToast(`${a.name} đã nghỉ việc, máy đã tắt.`)
    openFocus(a.id)
  },
  setLocked: (v) => set({ locked: v }),
  showToast: (text) => set({ toast: { id: ++seq, text } }),
  // Ứng viên không đổi trạng thái được (nghỉ thì mất khỏi sảnh mà phiếu thuê vẫn còn)
  cycleStatus: (id) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id && !a.candidate ? { ...a, status: STATUS_CYCLE[(STATUS_CYCLE.indexOf(a.status) + 1) % STATUS_CYCLE.length] } : a,
      ),
    })),
  openFocus: (id) => {
    // Nhả chuột để bấm được nút trong CLI
    if (document.pointerLockElement) document.exitPointerLock()
    input.keys.clear()
    set({ focusId: id, settingsOpen: false, inboxOpen: false })
  },
  closeFocus: () => set({ focusId: null }),
  openBoard: () => {
    if (document.pointerLockElement) document.exitPointerLock()
    input.keys.clear()
    set({ boardOpen: true, settingsOpen: false, inboxOpen: false })
  },
  closeBoard: () => set({ boardOpen: false }),
  openFame: () => {
    if (document.pointerLockElement) document.exitPointerLock()
    input.keys.clear()
    set({ fameOpen: true, settingsOpen: false, inboxOpen: false })
  },
  closeFame: () => set({ fameOpen: false }),
  openWardrobe: (id) => {
    if (document.pointerLockElement) document.exitPointerLock()
    input.keys.clear()
    // Mặc định: người đang đứng gần, không thì chính mình
    set((s) => ({ wardrobeId: id ?? s.nearId ?? 'player', settingsOpen: false, inboxOpen: false }))
  },
  closeWardrobe: () => set({ wardrobeId: null }),
  // Bảng cài đặt nhỏ, không che màn hình: vẫn đi lại được khi đang mở
  toggleSettings: () => {
    if (!get().settingsOpen && document.pointerLockElement) document.exitPointerLock()
    if (useDeco.getState().open) useDeco.getState().toggle()
    set((s) => ({ settingsOpen: !s.settingsOpen, wardrobeId: null, roomsOpen: false, roomPick: null }))
  },
  // Như cài đặt: bảng nhỏ bên cạnh, vẫn đi lại được
  toggleRooms: () => {
    if (!get().roomsOpen && document.pointerLockElement) document.exitPointerLock()
    if (useDeco.getState().open) useDeco.getState().toggle()
    set((s) => ({ roomsOpen: !s.roomsOpen, roomPick: null, settingsOpen: false }))
  },
  // Như bảng mở phòng: bảng cửa hàng bên trái, vẫn đi lại được để xem các góc phòng
  toggleDeco: () => {
    if (document.pointerLockElement) document.exitPointerLock()
    set({ roomsOpen: false, roomPick: null, settingsOpen: false })
    useDeco.getState().toggle()
  },
  pickRoom: (id) => set({ roomPick: id }),
  showRoom: (id) => {
    if (document.pointerLockElement) document.exitPointerLock()
    if (useDeco.getState().open) useDeco.getState().toggle()
    set({ roomsOpen: true, roomPick: id, settingsOpen: false })
  },
  closeTop: () => {
    const s = get()
    // Màn hình đang thấy (CLI, bảng to, tủ đồ, phiếu duyệt) đóng trước; bảng mở phòng / trang trí / cài đặt nằm dưới, đang bị ẩn
    if (s.askId) set({ askId: null })
    else if (s.wardrobeId) set({ wardrobeId: null })
    else if (s.focusId) set({ focusId: null })
    else if (s.boardOpen) set({ boardOpen: false })
    else if (s.fameOpen) set({ fameOpen: false })
    else if (s.roomPick) set({ roomPick: null })
    else if (s.inboxOpen) set({ inboxOpen: false })
    else if (s.settingsOpen) set({ settingsOpen: false })
    else if (useDeco.getState().back()) { /* bỏ chỗ đặt thử / món đang cầm / đóng chế độ trang trí */ }
    else if (s.roomsOpen) set({ roomsOpen: false })
    else return false
    return true
  },
  /** Phím E: mở màn hình agent / bảng ticket đang đứng gần, hoặc đóng nếu đang xem */
  interact: () => {
    const { focusId, boardOpen, nearId, nearBoard, closeFocus, openBoard, closeBoard, wardrobeId, askId } = get()
    if (wardrobeId || askId) return
    if (focusId) return closeFocus()
    if (boardOpen) return closeBoard()
    if (get().fameOpen) return get().closeFame()
    if (get().using) return get().leaveUse()
    if (nearBoard) return openBoard()
    if (get().nearFame) return get().openFame()
    const use = get().nearUse
    if (use && !nearId) {
      // Agent vừa giành chỗ đúng lúc bấm: báo cho biết thay vì im lặng
      if (takeSpot(use)) set({ using: use, nearUse: null })
      else get().showToast('Chỗ này có người rồi')
      return
    }
    if (nearId) get().openAgent(nearId)
  },
}))
