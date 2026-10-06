import { useMemo } from 'react'
import { create } from 'zustand'
import { hash, pick } from '../lib/math'

export interface Look {
  skin: string
  hair: string
  shirt: string
  pants: string
  /** 0 ngắn · 1 mái vuốt · 2 dài · 3 búi · 4 xoăn bồng · 5 đầu đinh */
  hairStyle: 0 | 1 | 2 | 3 | 4 | 5
  glasses: boolean
  /** 0 không · 1 mũ lưỡi trai · 2 mũ len · 3 tai nghe */
  hat: 0 | 1 | 2 | 3
  hatColor: string
}

export const SKIN = ['#f5d1b0', '#e9b48f', '#d39a72', '#b97c55', '#8d5a3b', '#f2c6a0']
export const HAIR = ['#2b2121', '#4a3226', '#7a4b2a', '#c98b3d', '#1f2a3a', '#a33b2b', '#e8d38a', '#5a5f6b']
export const SHIRT = ['#4f9d94', '#e0784f', '#6c8ed8', '#d65f7c', '#8fbf5a', '#9b7bd0', '#f0b84d', '#5ab0d6', '#2d4a7c', '#f2f0ea', '#2f3340']
export const PANTS = ['#2f3746', '#3b4a6b', '#4a3f38', '#2a4a4a', '#c9b48a', '#6b6f78']
export const HAT_COLORS = ['#e0574f', '#2f3340', '#f0b84d', '#4f9d94', '#6c8ed8', '#f2f0ea', '#d65f7c']

/** Ngoại hình ổn định theo tên. Lead mặc áo xanh navy và đeo kính, vài người đeo tai nghe. */
export function lookFor(name: string, isLead: boolean): Look {
  const h = hash(name)
  return {
    skin: pick(SKIN, h),
    hair: pick(HAIR, h >>> 3),
    shirt: isLead ? '#2d4a7c' : pick(SHIRT.slice(0, 8), h >>> 6),
    pants: pick(PANTS.slice(0, 4), h >>> 9),
    hairStyle: ((h >>> 12) % 4) as Look['hairStyle'],
    glasses: isLead || (h >>> 15) % 4 === 0,
    hat: !isLead && (h >>> 18) % 5 === 0 ? 3 : 0,
    hatColor: pick(HAT_COLORS, h >>> 21),
  }
}

/** Màu lấy đúng từ bảng màu để tủ đồ đánh dấu được ô đang chọn */
export const PLAYER_LOOK: Look = {
  skin: '#f2c6a0',
  hair: '#2b2121',
  shirt: '#f0b84d',
  pants: '#2f3746',
  hairStyle: 1,
  glasses: false,
  hat: 0,
  hatColor: '#e0574f',
}

/** Mã nhân vật của bạn trong kho ngoại hình */
export const PLAYER_ID = 'player'

// ───────────────────── Ngoại hình tuỳ chỉnh (lưu trên trình duyệt) ─────────────────────

const KEY = 'coopverse.looks.v1'
type Custom = Record<string, Partial<Look>>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const isInt = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max

/** Chỉ giữ những trường hợp lệ: dữ liệu cũ/hỏng trong localStorage không được làm sập app. */
function clean(v: unknown): Partial<Look> {
  if (!isObj(v)) return {}
  const out: Partial<Look> = {}
  for (const k of ['skin', 'hair', 'shirt', 'pants', 'hatColor'] as const) if (isColor(v[k])) out[k] = v[k] as string
  if (isInt(v.hairStyle, 5)) out.hairStyle = v.hairStyle as Look['hairStyle']
  if (isInt(v.hat, 3)) out.hat = v.hat as Look['hat']
  if (typeof v.glasses === 'boolean') out.glasses = v.glasses
  return out
}

function load(): Custom {
  try {
    const raw = localStorage.getItem(KEY)
    const j: unknown = raw ? JSON.parse(raw) : null
    if (!isObj(j)) return {}
    const out: Custom = {}
    for (const [id, v] of Object.entries(j)) {
      const c = clean(v)
      if (Object.keys(c).length) out[id] = c
    }
    return out
  } catch {
    return {}
  }
}

interface LooksState {
  custom: Custom
  setLook: (id: string, patch: Partial<Look>) => void
  reset: (id: string) => void
}

export const useLooks = create<LooksState>((set, get) => {
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(get().custom))
    } catch {
      /* trình duyệt chặn bộ nhớ: chỉ giữ trong phiên */
    }
  }
  return {
    custom: load(),
    setLook: (id, patch) => {
      set((s) => ({ custom: { ...s.custom, [id]: { ...s.custom[id], ...patch } } }))
      save()
    },
    reset: (id) => {
      set((s) => {
        const custom = { ...s.custom }
        delete custom[id]
        return { custom }
      })
      save()
    },
  }
})

export const baseLook = (id: string, name: string, isLead: boolean) => (id === PLAYER_ID ? PLAYER_LOOK : lookFor(name, isLead))

/** Ngoại hình cuối cùng = mặc định theo tên + phần đã tuỳ chỉnh. Dùng ngoài React (canvas bảng kanban...). */
export function lookOf(id: string, name: string, isLead: boolean, custom = useLooks.getState().custom): Look {
  return { ...baseLook(id, name, isLead), ...custom[id] }
}

/** Hook: ngoại hình của một người, cập nhật ngay khi chỉnh trong tủ đồ. */
export function useLook(id: string, name: string, isLead: boolean): Look {
  const mine = useLooks((s) => s.custom[id])
  return useMemo(() => ({ ...baseLook(id, name, isLead), ...mine }), [id, name, isLead, mine])
}

/** Bộ đồ ngẫu nhiên cho nút 🎲 */
export function randomLook(): Look {
  const r = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
  return {
    skin: r(SKIN),
    hair: r(HAIR),
    shirt: r(SHIRT),
    pants: r(PANTS),
    hairStyle: Math.floor(Math.random() * 6) as Look['hairStyle'],
    glasses: Math.random() < 0.3,
    hat: (Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * 3)) as Look['hat'],
    hatColor: r(HAT_COLORS),
  }
}
