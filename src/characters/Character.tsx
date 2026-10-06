import { forwardRef, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh } from 'three'
import { damp } from '../lib/math'
import type { Look } from './look'

export type PoseMode =
  | 'stand' | 'walk' | 'run' | 'sit' | 'type' | 'sleep'
  | 'drink' | 'wave' | 'cheer' | 'play' | 'read' | 'talk' | 'facepalm' | 'raise' | 'cv'

/** Nét mặt: focus = nheo mắt tập trung, shock = mắt tròn miệng chữ O */
export type Mood = 'normal' | 'happy' | 'focus' | 'shock' | 'sleep'

export interface Pose {
  mode: PoseMode
  /** Ngồi (chân gập) dù dáng tay là gì, vd ngồi sofa nói chuyện */
  seat?: boolean
  /** Nâng/hạ người khi ngồi trên ghế cao/thấp hơn ghế văn phòng (m) */
  lift?: number
  mood?: Mood
}

/** Chiều cao hông khi đứng. Khi ngồi, hạ xuống ngang mặt ghế. */
const HIP = 0.55
const SEAT_DROP = -0.08
const SEATED_MODES: PoseMode[] = ['sit', 'type', 'sleep']

function Box({ size, pos, color, rough = 0.8 }: { size: [number, number, number]; pos: [number, number, number]; color: string; rough?: number }) {
  return (
    <mesh position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={rough} flatShading />
    </mesh>
  )
}

/** Mắt / miệng: hộp nhỏ không đổ bóng, co giãn được để đổi nét mặt */
const Face = forwardRef<Mesh, { size: [number, number, number]; pos: [number, number, number]; color: string }>(
  function Face({ size, pos, color }, ref) {
    return (
      <mesh ref={ref} position={pos}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
    )
  },
)

/** `under` = đang đội mũ: bỏ phần tóc nhô lên đỉnh đầu (mái vuốt, búi, xoăn) để không xuyên qua mũ */
function Hair({ style, color, under }: { style: Look['hairStyle']; color: string; under: boolean }) {
  switch (style) {
    case 0: // tóc ngắn
      return (
        <>
          <Box size={[0.47, 0.12, 0.43]} pos={[0, 0.43, -0.01]} color={color} />
          <Box size={[0.47, 0.3, 0.1]} pos={[0, 0.3, -0.17]} color={color} />
        </>
      )
    case 1: // mái vuốt
      return (
        <>
          <Box size={[0.47, 0.14, 0.43]} pos={[0, 0.44, -0.01]} color={color} />
          {!under && <Box size={[0.3, 0.12, 0.22]} pos={[0.04, 0.53, 0.08]} color={color} />}
          <Box size={[0.47, 0.28, 0.1]} pos={[0, 0.3, -0.17]} color={color} />
        </>
      )
    case 2: // tóc dài
      return (
        <>
          <Box size={[0.48, 0.13, 0.44]} pos={[0, 0.43, -0.01]} color={color} />
          <Box size={[0.48, 0.5, 0.12]} pos={[0, 0.2, -0.17]} color={color} />
          <Box size={[0.06, 0.38, 0.3]} pos={[0.235, 0.24, -0.04]} color={color} />
          <Box size={[0.06, 0.38, 0.3]} pos={[-0.235, 0.24, -0.04]} color={color} />
        </>
      )
    case 3: // búi tóc
      return (
        <>
          <Box size={[0.47, 0.12, 0.43]} pos={[0, 0.43, -0.01]} color={color} />
          <Box size={[0.47, 0.26, 0.1]} pos={[0, 0.3, -0.17]} color={color} />
          {!under && <Box size={[0.18, 0.16, 0.18]} pos={[0, 0.55, -0.12]} color={color} />}
        </>
      )
    case 4: // xoăn bồng
      return (
        <>
          {under
            ? <Box size={[0.5, 0.12, 0.46]} pos={[0, 0.43, -0.02]} color={color} />
            : <Box size={[0.56, 0.26, 0.52]} pos={[0, 0.47, -0.03]} color={color} />}
          <Box size={[0.56, 0.36, 0.16]} pos={[0, 0.28, -0.19]} color={color} />
          <Box size={[0.07, 0.26, 0.34]} pos={[0.25, 0.3, -0.05]} color={color} />
          <Box size={[0.07, 0.26, 0.34]} pos={[-0.25, 0.3, -0.05]} color={color} />
        </>
      )
    default: // đầu đinh
      return <Box size={[0.45, 0.05, 0.41]} pos={[0, 0.425, -0.005]} color={color} />
  }
}

/** Nửa bề ngang và đỉnh của từng kiểu tóc: mũ, tai nghe ôm ra ngoài tóc thay vì chìm vào (không nhấp nháy) */
const HAIR_HALF = [0.24, 0.24, 0.265, 0.24, 0.285, 0.225]
const HAIR_TOP = [0.51, 0.6, 0.5, 0.51, 0.6, 0.45]

function Hat({ kind, color, hairStyle }: { kind: Look['hat']; color: string; hairStyle: Look['hairStyle'] }) {
  switch (kind) {
    case 1: // mũ lưỡi trai
      return (
        <>
          <Box size={[0.52, 0.15, 0.48]} pos={[0, 0.5, -0.01]} color={color} />
          <Box size={[0.44, 0.03, 0.2]} pos={[0, 0.44, 0.3]} color={color} />
          <Box size={[0.06, 0.03, 0.06]} pos={[0, 0.59, 0]} color={color} />
        </>
      )
    case 2: // mũ len
      return (
        <>
          <Box size={[0.52, 0.2, 0.48]} pos={[0, 0.52, -0.01]} color={color} />
          <Box size={[0.54, 0.08, 0.5]} pos={[0, 0.43, -0.01]} color="#f2f0ea" />
          <Box size={[0.11, 0.11, 0.11]} pos={[0, 0.66, -0.01]} color="#f2f0ea" />
        </>
      )
    case 3: { // tai nghe: vòng qua đỉnh tóc, hai bên tai nằm ngoài tóc
      const w = (HAIR_HALF[hairStyle] ?? 0.24) + 0.02
      const top = (HAIR_TOP[hairStyle] ?? 0.51) + 0.02
      const arm = top - 0.3
      return (
        <>
          <Box size={[w * 2 + 0.04, 0.04, 0.08]} pos={[0, top, 0]} color="#2a2d35" />
          <Box size={[0.04, arm, 0.08]} pos={[w + 0.02, 0.3 + arm / 2, 0]} color="#2a2d35" />
          <Box size={[0.04, arm, 0.08]} pos={[-w - 0.02, 0.3 + arm / 2, 0]} color="#2a2d35" />
          <Box size={[0.07, 0.16, 0.14]} pos={[w + 0.025, 0.28, 0]} color={color} />
          <Box size={[0.07, 0.16, 0.14]} pos={[-w - 0.025, 0.28, 0]} color={color} />
        </>
      )
    }
    default:
      return null
  }
}

/** Gọng kính: chỉ có viền, không che mắt (vẫn thấy chớp mắt, biểu cảm) */
function Glasses() {
  const c = '#20242c'
  const lens = (x: number) => (
    <>
      <Box size={[0.13, 0.018, 0.02]} pos={[x, 0.27, 0.215]} color={c} />
      <Box size={[0.13, 0.018, 0.02]} pos={[x, 0.17, 0.215]} color={c} />
      <Box size={[0.018, 0.11, 0.02]} pos={[x - 0.056, 0.22, 0.215]} color={c} />
      <Box size={[0.018, 0.11, 0.02]} pos={[x + 0.056, 0.22, 0.215]} color={c} />
    </>
  )
  return (
    <>
      {lens(-0.1)}
      {lens(0.1)}
      <Box size={[0.08, 0.02, 0.02]} pos={[0, 0.245, 0.215]} color={c} />
    </>
  )
}

/**
 * Nhân vật khối kiểu chibi (~1.55 m). Mặt hướng +z. Animation đọc từ pose.current mỗi khung hình.
 */
export function Character({ look, pose }: { look: Look; pose: RefObject<Pose> }) {
  const root = useRef<Group>(null!)
  const upper = useRef<Group>(null!)
  const head = useRef<Group>(null!)
  const legL = useRef<Group>(null!)
  const legR = useRef<Group>(null!)
  const armL = useRef<Group>(null!)
  const armR = useRef<Group>(null!)
  const eyeL = useRef<Mesh>(null!)
  const eyeR = useRef<Mesh>(null!)
  const mouth = useRef<Mesh>(null!)
  const cup = useRef<Group>(null!)
  const book = useRef<Group>(null!)
  const cv = useRef<Group>(null!)
  const t = useRef(Math.random() * 10)
  const blinkAt = useRef(2 + Math.random() * 4)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    t.current += dt
    const time = t.current
    const p = pose.current
    const mode = p?.mode ?? 'stand'
    const seated = !!p?.seat || SEATED_MODES.includes(mode)
    const moving = mode === 'walk' || mode === 'run'

    let rootY = seated ? SEAT_DROP + (p?.lift ?? 0) : 0
    let lL = 0, lR = 0, aL = 0, aR = 0, lean = 0, nod = 0, turn = 0
    // Tay dang ra hai bên (dương = ra ngoài)
    let sL = 0.06, sR = 0.06

    if (moving) {
      const run = mode === 'run'
      const w = run ? 13 : 8.5
      const amp = run ? 0.95 : 0.6
      const s = Math.sin(time * w)
      lL = s * amp; lR = -s * amp
      aL = -s * amp * 0.8; aR = s * amp * 0.8
      rootY = Math.abs(Math.cos(time * w)) * (run ? 0.07 : 0.035)
      lean = run ? 0.18 : 0.04
    } else {
      if (seated) lL = lR = -Math.PI / 2
      switch (mode) {
        case 'stand': {
          const b = Math.sin(time * 1.8)
          aL = b * 0.03; aR = -b * 0.03
          nod = Math.sin(time * 0.7) * 0.04
          if (seated) aL = aR = -0.55
          break
        }
        case 'sit':
          aL = aR = -0.55
          nod = Math.sin(time * 0.6) * 0.05
          break
        case 'type':
          aL = -1.2 + Math.sin(time * 19) * 0.07
          aR = -1.2 + Math.sin(time * 17 + 1.3) * 0.07
          nod = 0.1 + Math.sin(time * 2.1) * 0.04
          sL = sR = 0.02
          break
        case 'sleep':
          lean = 0.42
          aL = aR = -1.35
          nod = 0.5 + Math.sin(time * 1.2) * 0.03
          sL = sR = -0.05
          break
        case 'drink': {
          // Cầm cốc trước ngực, cứ vài giây đưa lên miệng
          const sip = Math.max(0, Math.sin(time * 1.4) - 0.55) / 0.45
          aR = -0.95 - sip * 1.25
          sR = -0.18 - sip * 0.12
          aL = seated ? -0.55 : 0.02
          nod = -sip * 0.18
          break
        }
        case 'wave':
          aR = -2.75
          sR = 0.15 + Math.sin(time * 11) * 0.38
          aL = seated ? -0.55 : 0.05
          nod = -0.06
          turn = Math.sin(time * 3) * 0.1
          break
        case 'raise': {
          // Giơ thẳng tay phải xin bạn chú ý, thỉnh thoảng vẫy nhẹ, mặt ngước lên
          const wig = Math.max(0, Math.sin(time * 2.2)) * Math.sin(time * 12) * 0.12
          aR = -3.0
          sR = 0.08 + wig
          aL = seated ? -0.55 : 0.04
          nod = -0.12
          turn = Math.sin(time * 0.9) * 0.12
          break
        }
        case 'cheer': {
          const b = Math.abs(Math.sin(time * 8))
          aL = aR = -2.85 + b * 0.25
          sL = sR = 0.38
          if (!seated) rootY = b * 0.09
          nod = -0.15
          break
        }
        case 'play':
          // Bi lắc: hai tay cầm cần, xoay qua lại
          aL = -1.25 + Math.sin(time * 7) * 0.22
          aR = -1.25 + Math.sin(time * 7 + 2) * 0.22
          sL = sR = -0.05
          lean = 0.16
          turn = Math.sin(time * 3.5) * 0.18
          nod = 0.25
          break
        case 'cv':
          // Ứng viên cầm hồ sơ trước ngực, đứng chờ, thỉnh thoảng nhìn quanh
          aL = aR = -1.25
          sL = sR = -0.2
          nod = -0.04
          turn = Math.sin(time * 0.45) * 0.22
          break
        case 'read':
          aL = aR = -1.0
          sL = sR = -0.14
          nod = 0.32 + Math.sin(time * 0.5) * 0.03
          turn = Math.sin(time * 0.35) * 0.06
          break
        case 'talk':
          aR = -0.45 - Math.max(0, Math.sin(time * 4.2)) * 0.55
          sR = -0.06 - Math.max(0, Math.sin(time * 2.1)) * 0.2
          aL = seated ? -0.55 : Math.sin(time * 2.7) * 0.08
          nod = Math.sin(time * 6) * 0.06
          turn = Math.sin(time * 1.3) * 0.08
          break
        case 'facepalm':
          // Lỗi: chống tay ôm đầu, lắc nhẹ
          aR = -2.45
          sR = -0.42
          aL = seated ? -1.1 : 0
          nod = 0.28
          lean = seated ? 0.22 : 0.1
          turn = Math.sin(time * 2.4) * 0.12
          break
      }
    }

    const k = damp(14, dt)
    root.current.position.y += (rootY - root.current.position.y) * k
    legL.current.rotation.x += (lL - legL.current.rotation.x) * k
    legR.current.rotation.x += (lR - legR.current.rotation.x) * k
    armL.current.rotation.x += (aL - armL.current.rotation.x) * k
    armR.current.rotation.x += (aR - armR.current.rotation.x) * k
    armL.current.rotation.z += (sL - armL.current.rotation.z) * k
    armR.current.rotation.z += (-sR - armR.current.rotation.z) * k
    upper.current.rotation.x += (lean - upper.current.rotation.x) * k
    head.current.rotation.x += (nod - head.current.rotation.x) * k
    head.current.rotation.y += (turn - head.current.rotation.y) * k

    cup.current.visible = mode === 'drink'
    // Giữ cốc đứng thẳng, chỉ nghiêng nhẹ khi đưa lên uống
    cup.current.rotation.x = -armR.current.rotation.x * 0.75
    book.current.visible = mode === 'read'
    cv.current.visible = mode === 'cv'

    // ── Nét mặt + chớp mắt ──
    const mood: Mood = mode === 'sleep' ? 'sleep' : p?.mood ?? 'normal'
    let eyeH = { sleep: 0.15, focus: 0.7, happy: 0.45, shock: 1.35, normal: 1 }[mood]
    const [mw, mh] = { happy: [1.6, 1.3], shock: [0.7, 3.2], sleep: [0.6, 1], focus: [1, 1], normal: [1, 1] }[mood]
    if (mood !== 'sleep') {
      blinkAt.current -= dt
      if (blinkAt.current < 0) {
        eyeH = 0.1
        if (blinkAt.current < -0.12) blinkAt.current = 2.5 + Math.random() * 4
      }
    }
    const ke = damp(30, dt)
    eyeL.current.scale.y += (eyeH - eyeL.current.scale.y) * ke
    eyeR.current.scale.y = eyeL.current.scale.y
    mouth.current.scale.x += (mw - mouth.current.scale.x) * ke
    mouth.current.scale.y += (mh - mouth.current.scale.y) * ke
  })

  const eye = '#1e2230'
  return (
    <group ref={root}>
      {/* Chân, xoay quanh hông */}
      <group ref={legL} position={[-0.1, HIP, 0]}>
        <Box size={[0.16, 0.5, 0.18]} pos={[0, -0.25, 0]} color={look.pants} />
        <Box size={[0.17, 0.08, 0.25]} pos={[0, -0.51, 0.03]} color="#2a2a30" />
      </group>
      <group ref={legR} position={[0.1, HIP, 0]}>
        <Box size={[0.16, 0.5, 0.18]} pos={[0, -0.25, 0]} color={look.pants} />
        <Box size={[0.17, 0.08, 0.25]} pos={[0, -0.51, 0.03]} color="#2a2a30" />
      </group>

      {/* Thân trên, nghiêng quanh hông */}
      <group ref={upper} position={[0, HIP, 0]}>
        <Box size={[0.44, 0.52, 0.27]} pos={[0, 0.26, 0]} color={look.shirt} />
        <Box size={[0.2, 0.06, 0.02]} pos={[0, 0.49, 0.14]} color="#ffffff" />

        <group ref={armL} position={[-0.29, 0.46, 0]}>
          <Box size={[0.13, 0.42, 0.14]} pos={[0, -0.2, 0]} color={look.shirt} />
          <Box size={[0.11, 0.1, 0.12]} pos={[0, -0.45, 0]} color={look.skin} />
        </group>
        <group ref={armR} position={[0.29, 0.46, 0]}>
          <Box size={[0.13, 0.42, 0.14]} pos={[0, -0.2, 0]} color={look.shirt} />
          <Box size={[0.11, 0.1, 0.12]} pos={[0, -0.45, 0]} color={look.skin} />
          {/* Cốc cà phê trong tay phải */}
          <group ref={cup} position={[0, -0.5, 0.07]} visible={false}>
            <mesh>
              <cylinderGeometry args={[0.055, 0.045, 0.13, 8]} />
              <meshStandardMaterial color="#f4f1ea" roughness={0.6} flatShading />
            </mesh>
            <mesh position={[0, 0.055, 0]}>
              <cylinderGeometry args={[0.057, 0.057, 0.03, 8]} />
              <meshStandardMaterial color="#c4704f" roughness={0.6} flatShading />
            </mesh>
          </group>
        </group>

        {/* Sách cầm hai tay */}
        <group ref={book} position={[0, 0.2, 0.4]} rotation={[-0.75, 0, 0]} visible={false}>
          <Box size={[0.3, 0.03, 0.22]} pos={[0, 0, 0]} color="#c4553f" />
          <Box size={[0.28, 0.035, 0.2]} pos={[0, 0.003, 0]} color="#f4f1ea" />
        </group>

        {/* Hồ sơ ứng viên: bìa giấy, ảnh thẻ, vài dòng chữ */}
        <group ref={cv} position={[0, 0.24, 0.34]} rotation={[-0.2, 0, 0]} visible={false}>
          <Box size={[0.26, 0.34, 0.02]} pos={[0, 0, 0]} color="#e3b860" />
          <Box size={[0.22, 0.29, 0.012]} pos={[0, 0.01, 0.008]} color="#f7f4ec" />
          <Box size={[0.06, 0.075, 0.014]} pos={[-0.06, 0.09, 0.009]} color="#7a8fb8" />
          <Box size={[0.08, 0.014, 0.014]} pos={[0.04, 0.115, 0.009]} color="#5b6270" />
          <Box size={[0.08, 0.01, 0.014]} pos={[0.04, 0.08, 0.009]} color="#9aa3b2" />
          {[0.0, -0.04, -0.08].map((y) => <Box key={y} size={[0.18, 0.01, 0.014]} pos={[0, y, 0.009]} color="#9aa3b2" />)}
        </group>

        <group ref={head} position={[0, 0.52, 0]}>
          <Box size={[0.44, 0.4, 0.4]} pos={[0, 0.21, 0]} color={look.skin} />
          <Face ref={eyeL} size={[0.06, 0.08, 0.02]} pos={[-0.1, 0.22, 0.205]} color={eye} />
          <Face ref={eyeR} size={[0.06, 0.08, 0.02]} pos={[0.1, 0.22, 0.205]} color={eye} />
          <Face ref={mouth} size={[0.08, 0.025, 0.02]} pos={[0, 0.11, 0.205]} color="#b5644f" />
          <Hair style={look.hairStyle} color={look.hair} under={look.hat === 1 || look.hat === 2} />
          <Hat kind={look.hat ?? 0} color={look.hatColor ?? '#e0574f'} hairStyle={look.hairStyle} />
          {look.glasses && <Glasses />}
        </group>
      </group>
    </group>
  )
}
