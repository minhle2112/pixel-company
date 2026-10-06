import { create } from 'zustand'

/**
 * Chế độ trang trí (phím T / nút sofa): đang cầm món gì, chọn món nào, chỗ đặt thử đang chờ bấm ✓.
 * Tách khỏi store chính để bản đồ (src/pixel/Decorate.tsx) và bảng cửa hàng (src/ui/Shop.tsx) dùng chung.
 */

export type Draft =
  /** Món mới từ cửa hàng: đặt thử rồi bấm ✓ mới trả Xu */
  | { kind: 'new'; item: string; rot: number }
  /** Món đã mua (đang đặt hoặc trong kho): đặt chỗ mới, miễn phí */
  | { kind: 'move'; uid: string; item: string; rot: number }
  /** Bàn làm việc của một chỗ ngồi */
  | { kind: 'desk'; slot: string; yaw: number }

/** Chỗ đặt thử đang chờ bạn bấm ✓ (mua) hoặc ✕ (bỏ) */
export type Pending = { kind: 'item'; item: string; c: number; r: number; rot: number }

interface DecoState {
  open: boolean
  draft: Draft | null
  /** Món đang chọn trên bản đồ: uid đồ đã mua, hoặc `desk:<id chỗ ngồi>` */
  sel: string | null
  pending: Pending | null
  /** Việc đang gửi lên server */
  busy: boolean
  toggle: () => void
  setDraft: (d: Draft | null) => void
  select: (id: string | null) => void
  setPending: (p: Pending | null) => void
  setBusy: (b: boolean) => void
  /** Esc: bỏ lớp trên cùng (chỗ đặt thử → món đang cầm → món đang chọn → đóng chế độ). false = không có gì để bỏ */
  back: () => boolean
}

export const useDeco = create<DecoState>((set, get) => ({
  open: false,
  draft: null,
  sel: null,
  pending: null,
  busy: false,
  toggle: () => set((s) => ({ open: !s.open, draft: null, sel: null, pending: null })),
  setDraft: (draft) => set({ draft, pending: null, sel: null }),
  select: (sel) => set({ sel, draft: null, pending: null }),
  setPending: (pending) => set({ pending }),
  setBusy: (busy) => set({ busy }),
  back: () => {
    const s = get()
    if (s.pending) set({ pending: null })
    else if (s.draft) set({ draft: null })
    else if (s.sel) set({ sel: null })
    else if (s.open) set({ open: false })
    else return false
    return true
  },
}))
