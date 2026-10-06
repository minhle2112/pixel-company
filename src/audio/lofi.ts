/**
 * Nhạc lofi tự sinh: hợp âm Rhodes, bass, trống boom-bap đánh lệch nhịp (swing), giai điệu ngũ cung thưa,
 * tiếng rè đĩa than và tiếng băng chao nhẹ. Không có hai lượt giống hệt nhau.
 * Nhận context + đầu ra từ ngoài để test được bằng OfflineAudioContext.
 */

const BPM = 74
const STEP = 60 / BPM / 4 // một nốt móc kép
const SWING = 0.17 // nốt móc kép lẻ đến trễ 17% bước

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

interface Chord { bass: number; notes: number[] }
const PROGS: Chord[][] = [
  // Fmaj7 → Em7 → Dm7 → Cmaj7
  [
    { bass: 41, notes: [57, 60, 64, 65] },
    { bass: 40, notes: [55, 59, 62, 64] },
    { bass: 38, notes: [53, 57, 60, 62] },
    { bass: 36, notes: [52, 55, 59, 60] },
  ],
  // Am9 → Dm9 → G13 → Cmaj9
  [
    { bass: 45, notes: [55, 60, 64, 71] },
    { bass: 38, notes: [53, 57, 60, 64] },
    { bass: 43, notes: [53, 59, 64, 65] },
    { bass: 36, notes: [52, 55, 59, 62] },
  ],
  // Dm7 → G7 → Em7 → Am7
  [
    { bass: 38, notes: [53, 57, 60, 64] },
    { bass: 43, notes: [53, 55, 59, 62] },
    { bass: 40, notes: [55, 59, 62, 64] },
    { bass: 45, notes: [55, 60, 64, 67] },
  ],
]
/** Ngũ cung La thứ cho giai điệu */
const PENTA = [69, 72, 74, 76, 79, 81]

// Trống: 16 bước một ô nhịp
const KICK = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
const KICK_ALT = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]

export class LofiSynth {
  private c: BaseAudioContext
  private input: GainNode
  private tone: BiquadFilterNode
  private keysBus: GainNode
  private drumBus: GainNode
  private wobble: GainNode
  private noise: AudioBuffer
  private crackle: AudioBufferSourceNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nextT = 0
  private step = 0
  private bar = 0
  private prog = PROGS[0]
  private lfo: OscillatorNode

  constructor(c: BaseAudioContext, out: AudioNode) {
    this.c = c
    this.input = c.createGain()
    this.input.gain.value = 0
    // Toàn bài đi qua bộ lọc thấp ("ấm") + nén nhẹ
    this.tone = c.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.frequency.value = 3600
    this.tone.Q.value = 0.5
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    this.input.connect(this.tone).connect(comp).connect(out)

    // Vang/delay nhẹ cho keys + giai điệu
    this.keysBus = c.createGain()
    this.keysBus.connect(this.input)
    const delay = c.createDelay(1)
    delay.delayTime.value = STEP * 3
    const fb = c.createGain()
    fb.gain.value = 0.28
    const dlp = c.createBiquadFilter()
    dlp.type = 'lowpass'
    dlp.frequency.value = 1800
    this.keysBus.connect(delay)
    delay.connect(dlp).connect(fb).connect(delay)
    dlp.connect(this.input)

    this.drumBus = c.createGain()
    const dl = c.createBiquadFilter()
    dl.type = 'lowpass'
    dl.frequency.value = 5200
    this.drumBus.gain.value = 0.8
    this.drumBus.connect(dl).connect(this.input)

    // Băng chao: LFO chậm đẩy cao độ lên xuống vài cent
    this.lfo = c.createOscillator()
    this.lfo.frequency.value = 0.35
    this.wobble = c.createGain()
    this.wobble.gain.value = 7
    this.lfo.connect(this.wobble)
    this.lfo.start()

    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }

  /** Tiếng rè đĩa than: nền ồn rất nhỏ + tiếng lách tách ngẫu nhiên, lặp 4 giây. */
  private startCrackle() {
    const c = this.c
    const len = c.sampleRate * 4
    const b = c.createBuffer(1, len, c.sampleRate)
    const d = b.getChannelData(0)
    let brown = 0
    for (let i = 0; i < len; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995
      d[i] = brown * 0.6
      if (Math.random() < 0.00035) {
        const amp = 0.25 + Math.random() * 0.5
        for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += amp * (Math.random() * 2 - 1) * Math.exp(-k / 6)
      }
    }
    const src = c.createBufferSource()
    src.buffer = b
    src.loop = true
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 700
    const g = c.createGain()
    g.gain.value = 0.09
    src.connect(hp).connect(g).connect(this.input)
    src.start()
    this.crackle = src
  }

  start() {
    const t = this.c.currentTime + 0.1
    this.input.gain.setValueAtTime(0, t)
    this.input.gain.linearRampToValueAtTime(1, t + 2.5)
    this.nextT = t
    this.startCrackle()
    if (this.c instanceof AudioContext) {
      this.timer = setInterval(() => this.scheduleUntil(this.c.currentTime + (document.hidden ? 1.6 : 0.35)), 60)
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const t = this.c.currentTime
    this.input.gain.cancelScheduledValues(t)
    this.input.gain.setTargetAtTime(0, t, 0.3)
    setTimeout(() => {
      this.crackle?.stop()
      this.lfo.stop()
      this.input.disconnect()
    }, 1500)
  }

  /** Đêm: lọc bớt âm cao cho nhạc trầm, mềm hơn. */
  setNight(n: number) {
    if (!Number.isFinite(n)) return
    this.tone.frequency.setTargetAtTime(3600 - n * 1500, this.c.currentTime, 1)
  }

  /** Lên lịch mọi nốt tới thời điểm `until` (giây của context). */
  scheduleUntil(until: number) {
    // Máy khựng (hoặc tab bị hãm timer) làm lịch tụt lại sau: bỏ qua các bước đã lỡ thay vì phát dồn một lúc.
    // Nhảy đúng số bước nguyên để giữ nhịp ô.
    const now = this.c.currentTime
    if (this.nextT < now - 0.05) {
      const skip = Math.ceil((now - this.nextT) / STEP)
      for (let i = 0; i < skip; i++) this.advance()
    }
    while (this.nextT < until) {
      const s = this.step % 16
      const t = this.nextT + (s % 2 ? STEP * SWING : 0)
      this.playStep(s, t)
      this.advance()
    }
  }

  private advance() {
    this.nextT += STEP
    this.step++
    if (this.step % 16 === 0) {
      this.bar++
      // Mỗi 8 ô nhịp có thể đổi vòng hợp âm
      if (this.bar % 8 === 0 && Math.random() < 0.6) this.prog = PROGS[Math.floor(Math.random() * PROGS.length)]
    }
  }

  private playStep(s: number, t: number) {
    const chord = this.prog[this.bar % 4]
    const fill = this.bar % 4 === 3
    // Trống (ô nhịp cuối mỗi 16 ô bỏ trống cho "thở")
    const breakBar = this.bar % 16 === 15
    if (!breakBar) {
      if ((fill ? KICK_ALT : KICK)[s]) this.kick(t)
      if (SNARE[s]) this.snare(t)
      if (s % 2 === 0) this.hat(t, s % 4 === 0 ? 0.11 : 0.07)
      else if (Math.random() < 0.18) this.hat(t, 0.04)
    }
    // Hợp âm: đánh ở phách 1, đánh lại nhẹ ở bước 10 (khi hứng)
    if (s === 0) this.chord(chord.notes, t, 0.085, STEP * 15)
    if (s === 10 && Math.random() < 0.45) this.chord(chord.notes.slice(1), t, 0.05, STEP * 6)
    // Bass
    if (s === 0) this.bass(chord.bass, t, STEP * 7)
    if (s === 8 && Math.random() < 0.7) this.bass(chord.bass + (Math.random() < 0.3 ? 7 : 0), t, STEP * 5)
    if (s === 14 && Math.random() < 0.25) this.bass(chord.bass + 12, t, STEP * 2)
    // Giai điệu thưa
    if (this.bar % 2 === 1 && s % 2 === 0 && Math.random() < 0.16) {
      const n = PENTA[Math.floor(Math.random() * PENTA.length)]
      this.lead(n, t, STEP * (2 + Math.floor(Math.random() * 4)))
    }
  }

  private chord(notes: number[], t: number, vel: number, dur: number) {
    notes.forEach((n, i) => this.rhodes(n, t + i * 0.018 + Math.random() * 0.01, vel * (0.85 + Math.random() * 0.3), dur))
  }

  private rhodes(n: number, t: number, vel: number, dur: number) {
    const c = this.c
    const f = midi(n)
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vel, t + 0.012)
    g.gain.setTargetAtTime(vel * 0.35, t + 0.02, 0.5)
    g.gain.setTargetAtTime(0, t + dur, 0.25)
    g.connect(this.keysBus)
    const body = c.createOscillator()
    body.type = 'sine'
    body.frequency.value = f
    const tine = c.createOscillator()
    tine.type = 'sine'
    tine.frequency.value = f * 2
    const tg = c.createGain()
    tg.gain.setValueAtTime(0.35, t)
    tg.gain.exponentialRampToValueAtTime(0.01, t + 0.35)
    this.wobble.connect(body.detune)
    this.wobble.connect(tine.detune)
    body.connect(g)
    tine.connect(tg).connect(g)
    const end = t + dur + 1.5
    body.start(t)
    tine.start(t)
    body.stop(end)
    tine.stop(end)
    body.onended = () => { this.wobble.disconnect(body.detune); this.wobble.disconnect(tine.detune) }
  }

  private bass(n: number, t: number, dur: number) {
    const c = this.c
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = midi(n)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.32, t + 0.015)
    g.gain.setTargetAtTime(0.18, t + 0.03, 0.2)
    g.gain.setTargetAtTime(0, t + dur, 0.06)
    o.connect(lp).connect(g).connect(this.input)
    o.start(t)
    o.stop(t + dur + 0.5)
  }

  private lead(n: number, t: number, dur: number) {
    const c = this.c
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = midi(n)
    this.wobble.connect(o.detune)
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.045, t + 0.03)
    g.gain.setTargetAtTime(0, t + dur, 0.12)
    o.connect(g).connect(this.keysBus)
    o.start(t)
    o.stop(t + dur + 0.8)
    o.onended = () => this.wobble.disconnect(o.detune)
  }

  private kick(t: number) {
    const c = this.c
    const o = c.createOscillator()
    o.frequency.setValueAtTime(118, t)
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12)
    const g = c.createGain()
    g.gain.setValueAtTime(0.55, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38)
    o.connect(g).connect(this.drumBus)
    o.start(t)
    o.stop(t + 0.4)
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, peak: number) {
    const c = this.c
    const src = c.createBufferSource()
    src.buffer = this.noise
    const f = c.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    const g = c.createGain()
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    src.connect(f).connect(g).connect(this.drumBus)
    src.start(t, Math.random() * 0.7, dur + 0.02)
  }

  private snare(t: number) {
    this.noiseHit(t, 0.2, 'bandpass', 1700, 0.3)
    const o = this.c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = 185
    const g = this.c.createGain()
    g.gain.setValueAtTime(0.18, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    o.connect(g).connect(this.drumBus)
    o.start(t)
    o.stop(t + 0.1)
  }

  private hat(t: number, peak: number) {
    this.noiseHit(t, 0.035, 'highpass', 7200, peak)
  }
}
