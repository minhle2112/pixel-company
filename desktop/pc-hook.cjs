/**
 * Nạp vào tiến trình Paperclip do Pixel Company bật (`node --require pc-hook.cjs paperclipai run`).
 *
 * Trên Windows không gửi được Ctrl+C / SIGTERM thật cho một tiến trình ẩn: "kill" của Node là TerminateProcess,
 * cắt ngang cả database. Vì vậy Pixel Company nhắn qua kênh IPC, hook này gọi lại đúng đường tắt SIGTERM mà Paperclip
 * đã đăng ký: dừng nhận việc, chờ lượt chạy đang dở, đóng database theo thứ tự.
 *
 * Pixel Company bị đóng đột ngột (kênh IPC đứt) cũng tắt gọn như vậy, để không còn Paperclip chạy ngầm không ai thấy.
 */
'use strict'

let asked = false
function shutdown() {
  if (asked) return
  asked = true
  // Paperclip chỉ đăng ký đường tắt khi máy chủ đã mở cổng. Đang khởi động (Postgres, nâng cấp database…) mà thoát
  // ngang thì hỏng việc dở dang và để lại Postgres mồ côi: chờ tới lúc có đường tắt rồi mới gọi.
  const fire = () => {
    if (process.listenerCount('SIGTERM') === 0) return false
    process.emit('SIGTERM', 'SIGTERM')
    return true
  }
  if (fire()) return
  const t = setInterval(() => { if (fire()) clearInterval(t) }, 250)
}

// Tiến trình con do Paperclip fork (vd worker của plugin) thừa hưởng `--require` này: chỉ chạy ở tiến trình đầu tiên.
// Xoá biến ngay để các tiến trình con sinh sau không còn thấy nó.
const mine = process.env.COOPVERSE_PC_HOOK === '1'
delete process.env.COOPVERSE_PC_HOOK

if (mine && typeof process.send === 'function') {
  process.on('message', (m) => {
    if (m === 'coopverse:shutdown') shutdown()
  })
  process.on('disconnect', shutdown)
  // Kênh IPC không giữ tiến trình sống: Paperclip tự quyết khi nào thoát
  if (process.channel && typeof process.channel.unref === 'function') process.channel.unref()
}
