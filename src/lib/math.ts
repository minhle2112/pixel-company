export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Hệ số nội suy không phụ thuộc framerate: 1 - e^(-λ·dt). */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt)

/** Nội suy góc theo đường ngắn nhất. */
export function lerpAngle(a: number, b: number, t: number) {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
  return a + d * t
}

/** FNV-1a: chuỗi → số nguyên ổn định (dùng để sinh ngoại hình theo tên). */
export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const pick = <T,>(arr: readonly T[], n: number) => arr[n % arr.length]
export const rand = (a: number, b: number) => a + Math.random() * (b - a)
