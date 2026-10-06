// Màn hình kết nối Paperclip của app desktop. Chỉ chạy trong app (cần window.coopDesktop từ preload).
'use strict'

const D = window.coopDesktop
const $ = (id) => document.getElementById(id)
const q = new URLSearchParams(location.search)
const stopping = q.has('stopping')

const BUSY = ['checking', 'starting', 'installing', 'stopping']
const OK = ['external', 'running']

let cfg = null
let setupDone = false

function setLaunch(v) {
  for (const r of document.querySelectorAll('input[name=launch]')) r.checked = r.value === v
  for (const el of document.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(v)
}

function launchValue() {
  const r = document.querySelector('input[name=launch]:checked')
  return r ? r.value : 'auto'
}

function fillForm(c) {
  $('url').value = c.paperclipUrl
  $('pcdir').value = c.paperclipDir
  $('datadir').value = c.dataDir
  $('wsl').value = c.wslDistro
  setLaunch(c.launch)
}

function button(text, fn, primary) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  if (primary) b.className = 'primary'
  b.onclick = async () => {
    b.disabled = true
    try { await fn() } finally { b.disabled = false }
  }
  return b
}

function render(s) {
  const dot = $('dot')
  dot.className = 'dot' + (OK.includes(s.phase) ? ' ok' : BUSY.includes(s.phase) ? ' busy' : s.phase === 'error' || s.phase === 'missing' ? ' bad' : '')
  $('msg').textContent = s.message || (setupDone ? 'Chưa kết nối Paperclip.' : 'Chào bạn! Kiểm tra cách kết nối Paperclip bên dưới rồi bấm "Lưu và kết nối".')
  const sub = $('sub')
  sub.textContent = ''
  if (s.phase === 'missing') sub.textContent = 'App sẽ chạy "npm install -g paperclipai" (cần Node.js 24.11 trở lên). Nếu Paperclip đã cài ở thư mục khác, chọn "Tự bật Paperclip trong một thư mục cài riêng" bên dưới.'
  else if (s.phase === 'starting') sub.textContent = 'Lần đầu bật có thể mất một lúc (Paperclip kiểm tra và nâng cấp database của nó).'
  else if (s.phase === 'stopping') sub.textContent = 'Paperclip dừng nhận việc, chờ lượt chạy đang dở kết thúc rồi đóng database. Đừng tắt máy lúc này.'

  const acts = $('actions')
  acts.replaceChildren()
  if (!stopping) {
    if (s.phase === 'missing') acts.append(button('Cài Paperclip', () => D.install(), true))
    if (['error', 'stopped', 'missing'].includes(s.phase)) acts.append(button('Thử lại', () => D.connect(), s.phase !== 'missing'))
    if (OK.includes(s.phase)) acts.append(button('Mở văn phòng', () => D.openApp(false), true))
  }

  const box = $('logbox')
  box.hidden = !s.log || !s.log.length
  if (!box.hidden) {
    const pre = $('log')
    const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8
    pre.textContent = s.log.join('\n')
    if (atEnd) pre.scrollTop = pre.scrollHeight
    if (s.phase === 'error') box.open = true
  }
  for (const el of $('form').elements) el.disabled = BUSY.includes(s.phase)
}

function renderAssets(ok, dir, bundled) {
  $('assets-msg').textContent = bundled
    ? 'Dùng gói hình LimeZu đi kèm app. Muốn dùng bản bạn tự giải nén thì chọn thư mục khác.'
    : ok
    ? `Đã có gói hình LimeZu: ${dir}`
    : 'Chưa có gói hình. Bản pixel vẽ bằng 2 gói của LimeZu (Modern Interiors và Modern Office) bạn mua trên itch.io. Gói có bản quyền nên không đi kèm app: giải nén cả hai vào một thư mục (Modern Office vào thư mục con Modern_Office) rồi chọn thư mục đó.'
  $('pick-assets').textContent = ok ? 'Đổi thư mục…' : 'Chọn thư mục gói hình…'
}

async function load() {
  const info = await D.getSetup()
  cfg = info.config
  setupDone = cfg.setupDone
  $('ver').textContent = `phiên bản ${info.version}`
  fillForm(cfg)
  renderAssets(info.assetsOk, cfg.assetsDir, info.assetsBundled)
  // Màn hình kết nối lần đầu: báo những gì app đoán được
  if (!setupDone && info.detected && info.detected.dataDir) {
    info.state.message = `Đã tìm thấy Paperclip đang chạy (dữ liệu ở ${info.detected.dataDir}). Kiểm tra lại rồi bấm "Lưu và kết nối".`
  } else if (!setupDone && info.detected && info.detected.launch === 'auto') {
    info.state.message = 'Đã tìm thấy lệnh paperclipai trên máy. Kiểm tra lại rồi bấm "Lưu và kết nối".'
  }
  render(info.state)
}

D.onState(render)

for (const r of document.querySelectorAll('input[name=launch]')) r.addEventListener('change', () => setLaunch(launchValue()))

for (const b of document.querySelectorAll('[data-pick]')) {
  b.addEventListener('click', async () => {
    const dir = await D.pickFolder(b.dataset.title)
    if (!dir) return
    $(b.dataset.pick).value = dir
    // Chọn thư mục dữ liệu: app đọc luôn địa chỉ Paperclip trong cấu hình của nó
    if (b.dataset.pick === 'datadir') {
      const c = await D.saveSetup({ dataDir: dir })
      $('url').value = c.paperclipUrl
    }
  })
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault()
  await D.saveSetup({
    paperclipUrl: $('url').value,
    launch: launchValue(),
    paperclipDir: $('pcdir').value,
    dataDir: $('datadir').value,
    wslDistro: $('wsl').value,
  })
  await D.connect()
})

$('demo').addEventListener('click', () => D.openApp(true))
$('openlog').addEventListener('click', () => D.openLog())
$('pick-assets').addEventListener('click', async () => {
  const r = await D.pickAssets()
  if (r.ok) renderAssets(true, r.dir)
  else if (!r.canceled) $('assets-msg').textContent = `Thư mục ${r.picked} chưa đủ hình: cần có 1_Interiors, 2_Characters và Modern_Office\\Modern_Office_16x16.png.`
})

if (stopping) {
  document.body.classList.add('stopping')
  D.getSetup().then((info) => {
    $('ver').textContent = `phiên bản ${info.version}`
    render(info.state)
  })
} else {
  load().then(() => {
    if (q.has('auto')) D.connect()
  })
}
