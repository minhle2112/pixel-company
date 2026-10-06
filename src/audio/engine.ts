import { useSettings } from '../settings'
import { LofiSynth } from './lofi'

/**
 * Âm thanh tự tổng hợp bằng Web Audio, không dùng file nào.
 * Trình duyệt chỉ cho phát tiếng sau khi người dùng bấm/gõ lần đầu → unlockAudio() gắn vào sự kiện đó.
 */
let ctx: AudioContext | null = null
let sfxBus: GainNode
let musicBus: GainNode
let noise: AudioBuffer
let lofi: LofiSynth | null = null
/** Nhạc nhỏ lại khi agent đang đọc câu trả lời chat */
let ducked = false

export const audioCtx = () => ctx

/** Bộ đệm tiếng ồn trắng 1 giây, dùng chung cho gõ phím, bước chân, trống. */
export function makeNoise(c: BaseAudioContext, sec = 1) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return b
}

function applySettings() {
  if (!ctx) return
  const s = useSettings.getState()
  const t = ctx.currentTime
  sfxBus.gain.setTargetAtTime(s.sfx ? s.sfxVol : 0, t, 0.05)
  musicBus.gain.setTargetAtTime(s.music ? s.musicVol * 0.55 * (ducked ? 0.25 : 1) : 0, t, 0.3)
  if (s.music && !lofi) {
    lofi = new LofiSynth(ctx, musicBus)
    lofi.start()
  } else if (!s.music && lofi) {
    // Dừng ngay (tự giảm dần 0,3 s): bật lại nhanh không bị hai bản nhạc chồng nhau
    lofi.stop()
    lofi = null
  }
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = new AC({ latencyHint: 'interactive' })
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -10
    comp.ratio.value = 4
    comp.connect(ctx.destination)
    sfxBus = ctx.createGain()
    musicBus = ctx.createGain()
    sfxBus.gain.value = 0
    musicBus.gain.value = 0
    sfxBus.connect(comp)
    musicBus.connect(comp)
    noise = makeNoise(ctx)
    useSettings.subscribe(applySettings)
    applySettings()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
}

/** Hạ nhạc nền khi đọc to câu trả lời chat, trả lại khi đọc xong. */
export function duckMusic(on: boolean) {
  if (ducked === on) return
  ducked = on
  applySettings()
}

/** Ban đêm nhạc trầm hơn (lọc bớt âm cao). night: 0 = ngày, 1 = đêm. */
export function setMusicNight(night: number) {
  lofi?.setNight(night)
}

const ready = () => !!ctx && ctx.state === 'running' && useSettings.getState().sfx

// ───────────────────── Vị trí nghe (người chơi + hướng camera) ─────────────────────

export const listener = { x: 0, z: 0, rx: 1, rz: 0 }

/** Âm lượng và cân bằng trái/phải theo khoảng cách tới người chơi. Trả null nếu quá xa. */
function place(x: number, z: number, ref: number, max: number) {
  const dx = x - listener.x, dz = z - listener.z
  const d = Math.hypot(dx, dz)
  if (d > max) return null
  const gain = 1 / (1 + (d / ref) ** 2) * (1 - d / max)
  const pan = d < 0.3 ? 0 : Math.max(-1, Math.min(1, (dx * listener.rx + dz * listener.rz) / d)) * 0.75
  return { gain, pan }
}

/** Nối nguồn → gain (→ pan) → bus hiệu ứng. Trả về nút gain để đặt bao. */
function chain(c: AudioContext, pan = 0) {
  const g = c.createGain()
  if (pan) {
    const p = c.createStereoPanner()
    p.pan.value = pan
    g.connect(p).connect(sfxBus)
  } else g.connect(sfxBus)
  return g
}

function noiseHit(c: AudioContext, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, pan = 0) {
  const src = c.createBufferSource()
  src.buffer = noise
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = chain(c, pan)
  g.gain.setValueAtTime(peak, t)
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
  src.connect(f).connect(g)
  src.start(t, Math.random() * 0.8, dur + 0.02)
}

function tone(c: AudioContext, t: number, freq: number, dur: number, peak: number, type: OscillatorType = 'sine', pan = 0, attack = 0.004) {
  const o = c.createOscillator()
  o.type = type
  o.frequency.value = freq
  const g = chain(c, pan)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0006, t + dur)
  o.connect(g)
  o.start(t)
  o.stop(t + dur + 0.05)
  return o
}

// ───────────────────── Các tiếng ─────────────────────

/** Tiếng gõ phím ở vị trí (x, z). heavy = phím cách / enter. */
export function keyClick(x: number, z: number, heavy = false) {
  if (!ready()) return
  const at = place(x, z, 2.2, 11)
  if (!at || at.gain < 0.01) return
  const c = ctx!, t = c.currentTime + Math.random() * 0.01
  const v = at.gain * (0.55 + Math.random() * 0.3)
  if (heavy) noiseHit(c, t, 0.05, 'bandpass', 900 + Math.random() * 300, 1.2, 0.5 * v, at.pan)
  else noiseHit(c, t, 0.022, 'bandpass', 2600 + Math.random() * 1800, 1.6, 0.42 * v, at.pan)
  tone(c, t, heavy ? 520 : 1700 + Math.random() * 600, 0.012, 0.05 * v, 'square', at.pan, 0.001)
}

/** Bước chân (người chơi hoặc agent ở gần). */
export function footstep(x: number, z: number, loud = 1) {
  if (!ready()) return
  const at = place(x, z, 1.5, 7)
  if (!at) return
  const c = ctx!, t = c.currentTime
  noiseHit(c, t, 0.07, 'lowpass', 260 + Math.random() * 120, 0.7, 0.32 * at.gain * loud, at.pan)
  tone(c, t, 70 + Math.random() * 15, 0.08, 0.12 * at.gain * loud, 'sine', at.pan, 0.003)
}

/** "Pop" nhẹ khi một bong bóng chat hiện ra. */
export function bubblePop(x: number, z: number) {
  if (!ready()) return
  const at = place(x, z, 3, 14)
  if (!at) return
  const c = ctx!, t = c.currentTime
  const o = tone(c, t, 520, 0.09, 0.09 * at.gain, 'sine', at.pan, 0.003)
  o.frequency.exponentialRampToValueAtTime(980, t + 0.06)
}

/** Chuông tinh kiểu Rhodes: sóng sin + bội âm lệch, tắt dần. */
function bell(c: AudioContext, t: number, f: number, peak: number, dur = 1.1) {
  tone(c, t, f, dur, peak, 'sine')
  tone(c, t, f * 2.76, dur * 0.4, peak * 0.22, 'sine')
  tone(c, t, f * 5.4, dur * 0.15, peak * 0.06, 'sine')
}

export type Ting = 'done' | 'start' | 'warn' | 'error' | 'info' | 'ask' | 'level'

/** Tiếng thông báo, khác nhau theo loại. */
export function ting(kind: Ting) {
  if (!ready()) return
  const c = ctx!, t = c.currentTime + 0.01
  switch (kind) {
    case 'done': // hợp âm rải đi lên, vui
      ;[1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(c, t + i * 0.085, f, 0.11 - i * 0.012, 1.2))
      break
    case 'start':
      bell(c, t, 880, 0.08, 0.7)
      bell(c, t + 0.09, 1318.5, 0.07, 0.9)
      break
    case 'info':
      bell(c, t, 1174.7, 0.07, 0.8)
      break
    case 'level': // kèn nhỏ lên cấp: rải nhanh lên rồi ngân hợp âm trưởng
      ;[784, 987.8, 1174.7, 1568].forEach((f, i) => bell(c, t + i * 0.07, f, 0.09, 0.6))
      ;[1568, 1975.5, 2349.3].forEach((f) => bell(c, t + 0.34, f, 0.07, 1.6))
      break
    case 'ask': // "kính coong" đi lên: có người cần bạn
      bell(c, t, 784, 0.09, 0.9)
      bell(c, t + 0.14, 1174.7, 0.09, 1.1)
      bell(c, t + 0.28, 1568, 0.06, 1.2)
      break
    case 'warn': // hai nốt đi xuống
      bell(c, t, 987.8, 0.09, 0.8)
      bell(c, t + 0.16, 784, 0.09, 1.0)
      break
    case 'error': {
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      lp.connect(sfxBus)
      for (const [i, f] of [233, 220].entries()) {
        const o = c.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = f
        const g = c.createGain()
        const s = t + i * 0.2
        g.gain.setValueAtTime(0, s)
        g.gain.linearRampToValueAtTime(0.07, s + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0005, s + 0.28)
        o.connect(g).connect(lp)
        o.start(s)
        o.stop(s + 0.3)
      }
      break
    }
  }
}

/** Tiếng "vút" khi mở / đóng CLI, bảng ticket, tủ đồ. */
export function whoosh(open: boolean) {
  if (!ready()) return
  const c = ctx!, t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noise
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 1.4
  f.frequency.setValueAtTime(open ? 700 : 2600, t)
  f.frequency.exponentialRampToValueAtTime(open ? 2600 : 700, t + 0.16)
  const g = chain(c)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.16, t + 0.05)
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2)
  src.connect(f).connect(g)
  src.start(t, Math.random() * 0.5, 0.25)
}

/** Tiếng bấm nút nhỏ trong bảng cài đặt / tủ đồ. */
export function uiTick() {
  if (!ready()) return
  const c = ctx!
  tone(c, c.currentTime, 1400, 0.05, 0.06, 'triangle')
}
