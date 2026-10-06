import { useMemo } from 'react'
import { create } from 'zustand'
import { PLAYER_ID } from '../characters/look'
import { hash } from '../lib/math'
import type { Parts } from './chars'

/**
 * Ngoại hình pixel: chọn bộ phận trong "Character Generator" của LimeZu theo tên agent (ổn định giữa các lần mở),
 * tuỳ chỉnh trong tủ đồ thì lưu trên trình duyệt.
 */

/** Màu da tự nhiên (bỏ các màu xanh / hồng / vàng kiểu nhân vật giả tưởng) */
export const BODIES = [1, 2, 3, 4, 7]
export const EYES = [1, 2, 3, 4, 5, 6, 7]
/** Số màu của từng kiểu đồ (Outfit_XX_YY) */
export const OUTFIT_COLORS: Record<number, number> = {
  1: 10, 2: 4, 3: 4, 4: 3, 5: 5, 6: 4, 7: 4, 8: 3, 9: 3, 10: 5, 11: 4, 12: 3, 13: 4, 14: 5, 15: 3, 16: 3, 17: 3,
  18: 4, 19: 4, 20: 3, 21: 4, 22: 4, 23: 4, 24: 4, 25: 5, 26: 3, 27: 3, 28: 4, 29: 4, 30: 3, 31: 5, 32: 5, 33: 3,
}
/** Đồ mặc đi làm (bỏ áo đấu, đồ bơi, đồ ninja...) */
export const OFFICE_OUTFITS = [1, 2, 3, 4, 7, 10, 11, 12, 13, 14, 17, 18, 20, 21, 26, 27, 29]
/** Vest cho lead */
export const LEAD_OUTFITS = [5, 6, 22]
/** Kiểu tóc 1–26 có 7 màu; 27–29 (tóc hồng kiểu anime) chỉ 6 màu */
export const HAIR_STYLES = 29
export const hairColors = (style: number) => (style >= 27 ? 6 : 7)
/** Kiểu tóc tự chọn cho agent (bỏ 3 kiểu anime) */
const AUTO_HAIR = 26

/** Phụ kiện hợp văn phòng: tên file trong Accessories/16x16 (không đuôi) */
export const ACCESSORIES: { id: string; label: string }[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `Accessory_15_Glasses_0${n}`, label: `Kính ${n}` })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `Accessory_11_Beanie_0${n}`, label: `Mũ len ${n}` })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `Accessory_04_Snapback_0${n}`, label: `Mũ lưỡi trai ${n}` })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `Accessory_13_Beard_0${n}`, label: `Râu quai nón ${n}` })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `Accessory_12_Mustache_0${n}`, label: `Ria mép ${n}` })),
]

const pick = <T,>(a: readonly T[], h: number) => a[h % a.length]

/** Mặc định theo tên. Lead mặc vest và đeo kính. */
export function partsFor(name: string, isLead: boolean): Parts {
  const h = hash(name)
  const outfit = isLead ? pick(LEAD_OUTFITS, h >>> 4) : pick(OFFICE_OUTFITS, h >>> 4)
  const hair = 1 + ((h >>> 9) % AUTO_HAIR)
  const extra = (h >>> 20) % 6
  return {
    body: pick(BODIES, h),
    eyes: pick(EYES, h >>> 2),
    outfit: [outfit, 1 + ((h >>> 7) % OUTFIT_COLORS[outfit])],
    hair: [hair, 1 + ((h >>> 14) % 6)],
    // Kính chỉ dành cho lead (nhận ra lead từ xa); người khác thỉnh thoảng có râu
    acc: isLead
      ? `Accessory_15_Glasses_0${1 + ((h >>> 23) % 6)}`
      : extra === 0 ? `Accessory_13_Beard_0${1 + ((h >>> 23) % 5)}` : extra === 1 ? `Accessory_12_Mustache_0${1 + ((h >>> 23) % 5)}` : null,
  }
}

/** Bạn (người chơi) */
export const PLAYER_PARTS: Parts = { body: 1, eyes: 1, outfit: [5, 1], hair: [3, 3], acc: null }

// ───────────────────── Tuỳ chỉnh (lưu trên trình duyệt) ─────────────────────

const KEY = 'coopverse.pixelLooks.v1'
type Custom = Record<string, Partial<Parts>>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const inList = (v: unknown, list: readonly number[]) => typeof v === 'number' && list.includes(v)
const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi

/** Chỉ giữ trường hợp lệ: dữ liệu cũ / hỏng trong localStorage không được làm hỏng hình nhân vật */
function clean(v: unknown): Partial<Parts> {
  if (!isObj(v)) return {}
  const out: Partial<Parts> = {}
  if (inList(v.body, BODIES)) out.body = v.body as number
  if (inList(v.eyes, EYES)) out.eyes = v.eyes as number
  const o = v.outfit
  if (Array.isArray(o) && isInt(o[0], 1, 33) && isInt(o[1], 1, OUTFIT_COLORS[o[0] as number])) out.outfit = [o[0], o[1]]
  const hr = v.hair
  if (Array.isArray(hr) && isInt(hr[0], 1, HAIR_STYLES) && isInt(hr[1], 1, hairColors(hr[0] as number))) out.hair = [hr[0], hr[1]]
  if (v.acc === null || ACCESSORIES.some((a) => a.id === v.acc)) out.acc = v.acc as string | null
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

interface PixelLooks {
  custom: Custom
  setParts: (id: string, patch: Partial<Parts>) => void
  reset: (id: string) => void
}

export const usePixelLooks = create<PixelLooks>((set, get) => {
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(get().custom))
    } catch {
      /* trình duyệt chặn bộ nhớ: chỉ giữ trong phiên */
    }
  }
  return {
    custom: load(),
    setParts: (id, patch) => {
      set((s) => ({ custom: { ...s.custom, [id]: { ...s.custom[id], ...clean(patch) } } }))
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

export const baseParts = (id: string, name: string, isLead: boolean) => (id === PLAYER_ID ? PLAYER_PARTS : partsFor(name, isLead))

/** Bộ phận cuối cùng = mặc định + phần đã tuỳ chỉnh. Dùng ngoài React. */
export function partsOf(id: string, name: string, isLead: boolean): Parts {
  return { ...baseParts(id, name, isLead), ...usePixelLooks.getState().custom[id] }
}

/** Hook: bộ phận nhân vật, cập nhật ngay khi chỉnh trong tủ đồ */
export function useParts(id: string, name: string, isLead: boolean): Parts {
  const mine = usePixelLooks((s) => s.custom[id])
  return useMemo(() => ({ ...baseParts(id, name, isLead), ...mine }), [id, name, isLead, mine])
}

/** Bộ ngẫu nhiên cho nút 🎲 */
export function randomParts(): Parts {
  const r = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
  const outfit = r(OFFICE_OUTFITS.concat(LEAD_OUTFITS))
  const hair = 1 + Math.floor(Math.random() * AUTO_HAIR)
  return {
    body: r(BODIES),
    eyes: r(EYES),
    outfit: [outfit, 1 + Math.floor(Math.random() * OUTFIT_COLORS[outfit])],
    hair: [hair, 1 + Math.floor(Math.random() * hairColors(hair))],
    acc: Math.random() < 0.4 ? r(ACCESSORIES).id : null,
  }
}
