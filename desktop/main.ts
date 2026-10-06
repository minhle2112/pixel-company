import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { importLedgers } from '../server/coopData'
import { assetsOk } from '../server/limezu'
import { config, dataDir, logDir, normUrl, resolveAssets, saveConfig, type DesktopConfig } from './config'
import { detect, health, Paperclip, setHookPath, urlFromPcConfig, type Detected } from './paperclip'
import { startServer, type Server } from './server'

/**
 * Pixel Company bản desktop (Windows). Một cửa sổ, một máy chủ nhỏ trên 127.0.0.1 (desktop/server.ts) và Paperclip có sẵn
 * của máy (desktop/paperclip.ts). Đóng cửa sổ: nếu chính app đã bật Paperclip thì tắt gọn nó trước khi thoát.
 */

const REPO = 'minhle2112/pixel-company'

// Thử nghiệm: dùng thư mục dữ liệu app riêng, không đụng cấu hình thật
if (process.env.COOPVERSE_USER_DATA) app.setPath('userData', process.env.COOPVERSE_USER_DATA)
// App trước tên Coopverse (lưu ở %APPDATA%\Coopverse): máy đã cài bản cũ thì dùng tiếp thư mục đó, giữ văn phòng, Xu, cấu hình
else {
  const legacy = path.join(app.getPath('appData'), 'Coopverse')
  if (!existsSync(app.getPath('userData')) && existsSync(legacy)) app.setPath('userData', legacy)
}
// Đã có một Pixel Company đang mở: thoát hẳn ngay (app.quit() không dừng phần còn lại của file này)
if (!app.requestSingleInstanceLock()) app.exit(0)
app.setAppUserModelId('io.github.minhle2112.pixelcompany')
Menu.setApplicationMenu(null)

const root = app.getAppPath()
setHookPath(app.isPackaged ? path.join(process.resourcesPath, 'pc-hook.cjs') : path.join(root, 'pc-hook.cjs'))

const pc = new Paperclip()
let srv: Server
let win: BrowserWindow | null = null
let detected: Detected | null = null
let closing = false
let quitting = false

const target = () => pc.state.url || normUrl(config().paperclipUrl)
/** Hình LimeZu đóng kèm bản phát hành (npm run dist:win:art); bản build không kèm hình thì không có thư mục này */
const bundledArt = path.join(root, 'limezu')
/** Thư mục gói hình người dùng tự chọn (nếu đủ hình), không thì hình đi kèm app */
const assetsDir = () => (assetsOk(config().assetsDir) ? config().assetsDir : assetsOk(bundledArt) ? bundledArt : config().assetsDir)
const setupUrl = (q = '') => `${srv.origin}/__desktop/setup.html${q}`

function send() {
  win?.webContents.send('pc:state', pc.state)
}

pc.on('state', () => {
  send()
  // Paperclip báo địa chỉ thật (đọc từ cấu hình của nó): nhớ lại cho lần sau
  if (pc.alive && pc.state.url && pc.state.url !== config().paperclipUrl) saveConfig({ paperclipUrl: pc.state.url })
})

// ── Cửa sổ ──────────────────────────────────────────────────────────────────────────────────────────

function onScreen(b: DesktopConfig['bounds']) {
  if (!b) return false
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80
  })
}

function createWindow() {
  const b = config().bounds
  const w = new BrowserWindow({
    ...(b && onScreen(b) ? { x: b.x, y: b.y, width: b.width, height: b.height } : { width: 1440, height: 900 }),
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#16131f',
    title: 'Pixel Company',
    icon: path.join(root, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(root, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  if (b?.max) w.maximize()
  w.once('ready-to-show', () => w.show())

  const own = (url: string) => url.startsWith(`${srv.origin}/`)
  // Liên kết ra ngoài (trang Paperclip, itch.io…) mở bằng trình duyệt
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (own(url)) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  // Pixel art: không cho phóng to trang bằng Ctrl + lăn chuột / chụm 2 ngón
  w.webContents.on('did-finish-load', () => { void w.webContents.setVisualZoomLevelLimits(1, 1) })
  w.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return
    if (i.key === 'F11') {
      w.setFullScreen(!w.isFullScreen())
      e.preventDefault()
    } else if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')) {
      w.webContents.reload()
      e.preventDefault()
    } else if (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')) {
      w.webContents.toggleDevTools()
      e.preventDefault()
    } else if (i.control && ['=', '+', '-', '0'].includes(i.key)) {
      e.preventDefault()
    }
  })

  w.on('close', (e) => {
    saveConfig({ bounds: { ...w.getNormalBounds(), max: w.isMaximized() } })
    if (quitting || !pc.state.ours) return
    e.preventDefault()
    void shutdownThenQuit()
  })
  w.on('closed', () => { win = null })
  return w
}

// ── Đóng app: tắt gọn Paperclip do app bật ────────────────────────────────────────────────────────────

/** Số lượt chạy của agent đang chạy / chờ chạy, trên mọi công ty */
async function liveRuns(url: string): Promise<number> {
  try {
    const get = async <T>(p: string) => {
      const r = await fetch(`${url}/api${p}`, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as T
    }
    const companies = await get<{ id: string }[]>('/companies')
    const runs = await Promise.all(companies.map((c) => get<unknown[]>(`/companies/${c.id}/live-runs`).catch(() => [])))
    return runs.reduce((n, r) => n + r.length, 0)
  } catch {
    return 0
  }
}

async function shutdownThenQuit() {
  if (closing || !win) return
  closing = true
  const w = win
  const n = pc.state.phase === 'running' ? await liveRuns(pc.state.url) : 0
  if (n > 0) {
    const r = await dialog.showMessageBox(w, {
      type: 'warning',
      title: 'Agent đang làm việc',
      message: `${n} lượt chạy của agent đang dở.`,
      detail: 'Đóng Pixel Company sẽ tắt Paperclip (do Pixel Company bật), các agent bị ngắt giữa chừng và việc đó có thể phải chạy lại. Dữ liệu đã lưu của Paperclip không bị mất.',
      buttons: ['Tắt Paperclip và đóng', 'Huỷ'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (r.response !== 0) {
      closing = false
      return
    }
  }
  await w.loadURL(setupUrl('?stopping'))
  let ok = await pc.stop()
  while (!ok) {
    const r = await dialog.showMessageBox(w, {
      type: 'warning',
      title: 'Paperclip chưa tắt xong',
      message: 'Paperclip vẫn đang kết thúc việc sau 90 giây.',
      detail: 'Chờ thêm là cách an toàn nhất. Buộc tắt sẽ cắt ngang ngay: việc đang dở bị huỷ, database của Paperclip tự phục hồi ở lần bật sau.',
      buttons: ['Chờ thêm', 'Buộc tắt'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (r.response === 1) {
      await pc.kill()
      break
    }
    ok = await pc.stop()
  }
  quitting = true
  app.quit()
}

// ── Kiểm tra bản mới (chỉ báo, không tự tải) ─────────────────────────────────────────────────────────

interface Update { status: 'new' | 'latest' | 'none' | 'error'; current: string; latest?: string; url?: string }

const ver = (s: string) => s.replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0)
const newer = (a: string, b: string) => {
  const x = ver(a)
  const y = ver(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

async function checkUpdate(): Promise<Update> {
  const current = app.getVersion()
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Pixel Company' },
      signal: AbortSignal.timeout(8000),
    })
    if (r.status === 404) return { status: 'none', current }
    if (!r.ok) return { status: 'error', current }
    const j = (await r.json()) as { tag_name: string; html_url: string }
    return newer(j.tag_name, current) ? { status: 'new', current, latest: j.tag_name.replace(/^v/i, ''), url: j.html_url } : { status: 'latest', current }
  } catch {
    return { status: 'error', current }
  }
}

async function notifyUpdate() {
  const u = await checkUpdate()
  if (u.status !== 'new' || !u.latest || u.latest === config().skipVersion || !win) return
  const r = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Có bản Pixel Company mới',
    message: `Pixel Company ${u.latest} đã có (bạn đang dùng ${u.current}).`,
    detail: 'Tải bản mới ở trang phát hành trên GitHub: file cài (cài đè lên bản cũ) hoặc bản zip (giải nén đè lên thư mục cũ). Cài đặt và dữ liệu của bạn được giữ nguyên.',
    buttons: ['Mở trang tải về', 'Để sau', 'Bỏ qua bản này'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (r.response === 0 && u.url) void shell.openExternal(u.url)
  if (r.response === 2) saveConfig({ skipVersion: u.latest })
}

// ── IPC ─────────────────────────────────────────────────────────────────────────────────────────────

/** Chỉ trang của chính app được gọi (khung chính, không phải iframe) */
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent) =>
  !!e.senderFrame && e.senderFrame === e.sender.mainFrame && e.senderFrame.url.startsWith(`${srv.origin}/`)
/** Kênh đổi cách bật Paperclip / chạy lệnh: chỉ màn hình kết nối được gọi */
const fromSetup = (e: IpcMainInvokeEvent) => trusted(e) && e.senderFrame!.url.startsWith(`${srv.origin}/__desktop/setup.html`)

function handle<A extends unknown[]>(ch: string, fn: (e: IpcMainInvokeEvent, ...a: A) => unknown, setupOnly = false) {
  ipcMain.handle(ch, (e, ...a) => {
    if (!(setupOnly ? fromSetup(e) : trusted(e))) throw new Error('coopverse: không được phép')
    return fn(e, ...(a as A))
  })
}

/** Thư mục trên máy này (không nhận đường dẫn mạng \\máy\chia-sẻ: app sẽ chạy mã trong đó bằng node) */
const localDir = (v: string) => {
  const s = v.trim()
  return /^(\\\\|\/\/)/.test(s) ? '' : s
}

async function openApp(demo = false) {
  await win?.loadURL(`${srv.origin}/${demo ? '?demo' : ''}`)
}

async function connect() {
  saveConfig({ setupDone: true })
  await pc.ensure(config())
  if (pc.alive) await openApp()
  return pc.state
}

function setupIpc() {
  ipcMain.on('desktop:info', (e) => {
    e.returnValue = trusted(e) ? { version: app.getVersion(), paperclipUrl: target() } : null
  })
  handle('setup:get', () => ({
    config: config(),
    state: pc.state,
    detected,
    assetsOk: assetsOk(assetsDir()),
    assetsBundled: assetsDir() === bundledArt,
    version: app.getVersion(),
    logFile: path.join(logDir(), 'paperclip.log'),
  }), true)
  handle('setup:save', (_e, patch: Partial<DesktopConfig>) => {
    const p: Partial<DesktopConfig> = {}
    if (typeof patch.paperclipUrl === 'string') p.paperclipUrl = normUrl(patch.paperclipUrl)
    if (patch.launch && ['auto', 'folder', 'wsl', 'none'].includes(patch.launch)) p.launch = patch.launch
    if (typeof patch.paperclipDir === 'string') p.paperclipDir = localDir(patch.paperclipDir)
    if (typeof patch.dataDir === 'string') p.dataDir = localDir(patch.dataDir)
    if (typeof patch.wslDistro === 'string') p.wslDistro = patch.wslDistro.trim().replace(/[^\w.-]/g, '')
    // Thư mục dữ liệu có cấu hình Paperclip: lấy luôn địa chỉ thật trong đó
    if (p.dataDir !== undefined) {
      const c = { ...config(), ...p }
      const fromCfg = urlFromPcConfig(p.dataDir, c.launch === 'folder' && c.paperclipDir ? c.paperclipDir : undefined)
      if (fromCfg) p.paperclipUrl = fromCfg
    }
    return saveConfig(p)
  }, true)
  handle('pick-folder', async (_e, title: string) => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { title: String(title || 'Chọn thư mục'), properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }, true)
  handle('pc:connect', () => connect(), true)
  handle('pc:install', async () => {
    if (await pc.install()) {
      saveConfig({ launch: 'auto' })
      return connect()
    }
    return pc.state
  }, true)
  handle('open-app', (_e, demo: boolean) => openApp(!!demo))
  handle('open-setup', () => win?.loadURL(setupUrl()))
  handle('pick-assets', async () => {
    if (!win) return { ok: false }
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục gói hình LimeZu', properties: ['openDirectory'] })
    if (r.canceled) return { ok: false, canceled: true }
    const dir = resolveAssets(r.filePaths[0])
    if (!dir) return { ok: false, picked: r.filePaths[0] }
    saveConfig({ assetsDir: dir })
    return { ok: true, dir }
  })
  handle('import-exp', async () => {
    if (!win) return { ok: false }
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục .coopverse cũ (có các file exp-….json)', properties: ['openDirectory', 'showHiddenFiles'] })
    if (r.canceled) return { ok: false, canceled: true }
    try {
      return { ok: true, count: await importLedgers(r.filePaths[0], dataDir()) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('check-update', () => checkUpdate())
  handle('open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  handle('open-log', () => shell.openPath(path.join(logDir(), 'paperclip.log')), true)
}

// ── Khởi động ───────────────────────────────────────────────────────────────────────────────────────

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.on('window-all-closed', () => app.quit())

void app.whenReady().then(async () => {
  srv = await startServer({
    webDir: path.join(root, 'web'),
    setupDir: path.join(root, 'setup'),
    dataDir: dataDir(),
    target,
    assets: assetsDir,
  })
  setupIpc()
  win = createWindow()

  const cfg = config()
  if (!cfg.setupDone) {
    // Lần đầu: đoán Paperclip của máy rồi để người dùng xác nhận trên màn hình kết nối
    detected = await detect()
    const patch: Partial<DesktopConfig> = {}
    if (detected.url) patch.paperclipUrl = detected.url
    if (detected.launch) patch.launch = detected.launch
    if (detected.paperclipDir) patch.paperclipDir = detected.paperclipDir
    if (detected.dataDir) patch.dataDir = detected.dataDir
    saveConfig(patch)
    await win.loadURL(setupUrl())
  } else if (await health(normUrl(cfg.paperclipUrl))) {
    await connect()
  } else {
    // Màn hình kết nối tự bật Paperclip và báo tiến độ
    await win.loadURL(setupUrl('?auto'))
  }
  setTimeout(() => void notifyUpdate(), 8000)
})
