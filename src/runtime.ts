import { SPAWN } from './world/layout'

/**
 * Trạng thái thay đổi mỗi khung hình. Để ngoài React (không gây re-render).
 */
export const input = { keys: new Set<string>() }

/** Camera góc thứ 3: yaw = 0 nghĩa là camera ở phía nam nhân vật, nhìn về hướng bắc (-z). */
export const cam = { yaw: 0, pitch: 0.5, dist: 6 }

/** facing = π: nhân vật nhìn về hướng bắc (-z). */
export const player = { x: SPAWN.x, z: SPAWN.z, facing: Math.PI }

/** Chỉ dùng khi dev: camera nhìn toàn cảnh từ trên cao. */
export const dev = { overview: false }

/** Vị trí agent, dùng cho va chạm với người chơi và tìm agent gần nhất. */
export const agentPos = new Map<string, { x: number; z: number }>()

/** Chỗ ứng viên đứng ở sảnh: được duyệt thuê xong thì agent đi bộ từ đây về bàn (AgentActor đọc rồi xoá). */
export const lobbyPos = new Map<string, { x: number; z: number }>()
