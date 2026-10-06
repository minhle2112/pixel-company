import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { logDir, normUrl, type DesktopConfig } from './config'

/**
 * Bật / tắt Paperclip có sẵn trên máy. App KHÔNG mang theo Paperclip riêng: luôn chạy đúng bản và đúng thư mục dữ liệu
 * người dùng đang dùng, nên không có chuyện hai bản khác phiên bản nâng cấp database của nhau.
 *
 * Tắt: chỉ tắt Paperclip do chính app bật. Gửi tín hiệu qua kênh IPC tới `pc-hook.cjs` (nạp vào tiến trình Paperclip
 * bằng `--require`), hook gọi lại đường tắt SIGTERM của Paperclip: Paperclip dừng nhận việc, chờ lượt chạy đang dở,
 * rồi đóng database đúng thứ tự. Không "giết" tiến trình trừ khi người dùng đồng ý sau khi chờ quá lâu.
 *
 * Nhật ký: Paperclip ghi thẳng vào file (không qua ống nối với app), app chỉ đọc theo. Nếu app bị đóng đột ngột,
 * Paperclip không bị lỗi "ống gãy" khi in ra màn hình, nên vẫn tự tắt gọn được (pc-hook.cjs bắt sự kiện mất kết nối).
 */

const run = promisify(execFile)

export type Phase =
  | 'idle'
  | 'checking'
  /** Paperclip đang chạy, không phải do app bật (app sẽ không tắt nó) */
  | 'external'
  | 'starting'
  /** Paperclip do app bật, đã sẵn sàng */
  | 'running'
  /** Không tìm thấy Paperclip trên máy */
  | 'missing'
  | 'installing'
  | 'stopping'
  | 'stopped'
  | 'error'

export interface PcState { phase: Phase; message: string; url: string; ours: boolean; log: string[] }

const LOG_KEEP = 120
const START_TIMEOUT_MS = 180_000
/** Node tối thiểu Paperclip cần */
const NODE_MIN = [24, 11]

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')

export async function health(url: string, ms = 2500): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(ms) })
    return r.ok
  } catch {
    return false
  }
}

const expand = (p: string) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p)

/**
 * Thư mục gốc của một bản Paperclip, tìm giống Paperclip: `-d` (mở rộng ~, đường dẫn tương đối tính từ thư mục chạy),
 * rồi biến PAPERCLIP_HOME, rồi ~/.paperclip. `cwd` = thư mục app chạy Paperclip.
 */
export function pcHome(dataDir: string, cwd = os.homedir()) {
  if (dataDir) return path.resolve(cwd, expand(dataDir))
  const env = process.env.PAPERCLIP_HOME
  return env ? path.resolve(expand(env)) : path.join(os.homedir(), '.paperclip')
}

const instanceDir = (home: string) => path.join(home, 'instances', process.env.PAPERCLIP_INSTANCE_ID || 'default')

/** Các chỗ Paperclip tìm file cấu hình, theo thứ tự ưu tiên */
function configCandidates(dataDir: string, cwd: string): string[] {
  const out: string[] = []
  if (process.env.PAPERCLIP_CONFIG) out.push(path.resolve(cwd, expand(process.env.PAPERCLIP_CONFIG)))
  // Không có -d: Paperclip còn tìm .paperclip/config.json kiểu cũ từ thư mục chạy đi ngược lên
  if (!dataDir) {
    for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
      out.push(path.join(d, '.paperclip', 'config.json'))
      if (path.dirname(d) === d) break
    }
  }
  out.push(path.join(instanceDir(pcHome(dataDir, cwd)), 'config.json'))
  return out
}

/** File cấu hình Paperclip đang dùng (đã tồn tại), hoặc null nếu bản này chưa từng thiết lập */
export function pcConfigFile(dataDir: string, cwd = os.homedir()): string | null {
  return configCandidates(dataDir, cwd).find((f) => existsSync(f)) ?? null
}

interface PcConfig { server?: { host?: string; port?: number }; database?: { embeddedPostgresDataDir?: string } }

function readPcConfig(dataDir: string, cwd = os.homedir()): PcConfig | null {
  const f = pcConfigFile(dataDir, cwd)
  if (!f) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as PcConfig
  } catch {
    return null
  }
}

const hostOf = (h: string | undefined) => (!h || h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h)

/** Địa chỉ Paperclip ghi trong file cấu hình của nó (host + cổng), hoặc null */
export function urlFromPcConfig(dataDir: string, cwd = os.homedir()): string | null {
  const c = readPcConfig(dataDir, cwd)
  return c?.server?.port ? `http://${hostOf(c.server.host)}:${c.server.port}` : null
}

/** Tiến trình còn sống không (kill 0 chỉ hỏi, không gửi gì) */
function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** `runtime-info.json`: Paperclip ghi pid + cổng khi máy chủ đã chạy */
function runtimeInfo(home: string): { pid: number; url: string } | null {
  try {
    const r = JSON.parse(readFileSync(path.join(instanceDir(home), 'runtime-info.json'), 'utf8')) as { pid?: number; host?: string; port?: number }
    return r.pid && r.port ? { pid: r.pid, url: `http://${hostOf(r.host)}:${r.port}` } : null
  } catch {
    return null
  }
}

/** Tiến trình cha + tên của nó */
async function parentOf(pid: number): Promise<{ pid: number; name: string } | null> {
  const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; if ($q) { "$($q.ProcessId) $($q.Name)" } }`
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15_000 })
    const m = /^(\d+)\s+(.+)$/.exec(stdout.trim())
    return m ? { pid: Number(m[1]), name: m[2].trim() } : null
  } catch {
    return null
  }
}

/**
 * Có Paperclip nào khác đang chạy (hoặc đang khởi động) trên cùng thư mục dữ liệu không. Paperclip KHÔNG từ chối bật
 * lần hai: nó dùng chung Postgres và nhảy sang cổng khác, thành hai máy chủ chạy agent hai lần. Vì vậy app phải tự kiểm.
 * - runtime-info.json có pid còn sống: máy chủ đang chạy
 * - db/postmaster.pid có pid còn sống mà tiến trình cha là node còn sống: Paperclip đang khởi động (chưa mở cổng)
 * Postgres mồ côi (cha đã chết) thì không tính: Paperclip tự dùng lại nó như khi bạn tự bật.
 */
async function otherPaperclip(dataDir: string, cwd: string): Promise<{ pid: number; url: string | null } | null> {
  const home = pcHome(dataDir, cwd)
  const rt = runtimeInfo(home)
  if (rt && alive(rt.pid)) return rt
  const pgDir = readPcConfig(dataDir, cwd)?.database?.embeddedPostgresDataDir || path.join(instanceDir(home), 'db')
  try {
    const pg = Number.parseInt(readFileSync(path.join(pgDir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0], 10)
    if (pg && alive(pg)) {
      const parent = await parentOf(pg)
      if (parent && /^node(\.exe)?$/i.test(parent.name) && alive(parent.pid)) return { pid: parent.pid, url: null }
    }
  } catch { /* chưa có database */ }
  return null
}

/** Một lệnh `paperclipai run|onboard` đang chạy trên máy (đọc từ dòng lệnh của tiến trình node) */
interface PcCli { pid: number; entry: string; dataDir: string }

async function paperclipClis(): Promise<PcCli[]> {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15_000 })
    const out: PcCli[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const [pid, ...rest] = line.split('\t')
      const m = /"?([^"]*?paperclipai[\\/]dist[\\/]index\.js)"?\s+(?:run|onboard)\b(.*)$/i.exec(rest.join('\t').trim())
      if (!m) continue
      const d = /(?:-d|--data-dir)\s+(?:"([^"]+)"|(\S+))/.exec(m[2])
      // vd ...\node_modules\.bin\\..\paperclipai\dist\index.js (lệnh tắt .cmd của npm): path.resolve gỡ ".."
      out.push({ pid: Number(pid), entry: path.resolve(m[1]), dataDir: d ? (d[1] ?? d[2]) : '' })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Có lệnh paperclipai nào đang chạy trên cùng thư mục dữ liệu không, kể cả lúc mới bật (chưa có Postgres, chưa mở cổng).
 * Không chắc (đường dẫn tương đối, hoặc không có -d mà ta cũng dùng mặc định) thì coi như trùng: thà chờ còn hơn bật hai bản.
 */
async function clashingCli(home: string): Promise<PcCli | null> {
  const mine = path.resolve(home).toLowerCase()
  const def = pcHome('').toLowerCase()
  for (const c of await paperclipClis()) {
    if (!alive(c.pid)) continue
    const d = expand(c.dataDir)
    const theirs = !c.dataDir ? def : path.isAbsolute(d) ? path.resolve(d).toLowerCase() : null
    if (theirs === null || theirs === mine) return c
  }
  return null
}

/** Tìm file chạy trên PATH (thay cho where.exe: không lỗi với đường dẫn có dấu) */
function onPath(names: string[]): string[] {
  const out: string[] = []
  for (const raw of (process.env.PATH ?? '').split(path.delimiter)) {
    const dir = raw.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    for (const n of names) {
      const f = path.join(dir, n)
      if (existsSync(f)) out.push(f)
    }
  }
  return out
}

async function nodeBin(): Promise<{ bin: string; ok: boolean; version: string } | null> {
  const bin = onPath(['node.exe'])[0]
  if (!bin) return null
  try {
    const { stdout } = await run(bin, ['-v'], { windowsHide: true })
    const version = stdout.trim()
    const [a, b] = version.replace(/^v/, '').split('.').map(Number)
    return { bin, version, ok: a > NODE_MIN[0] || (a === NODE_MIN[0] && b >= NODE_MIN[1]) }
  } catch {
    return null
  }
}

/** File chạy của Paperclip (`paperclipai/dist/index.js`) trong một thư mục cài */
export function entryIn(dir: string): string | null {
  if (!dir) return null
  const tries = [
    path.join(dir, 'node_modules', 'paperclipai', 'dist', 'index.js'),
    path.join(dir, 'dist', 'index.js'),
    path.join(dir, 'paperclipai', 'dist', 'index.js'),
  ]
  return tries.find((f) => existsSync(f) && f.includes('paperclipai')) ?? null
}

/** `paperclipai` cài bằng `npm install -g`: tìm file chạy cạnh lệnh `paperclipai.cmd` */
async function globalEntry(): Promise<string | null> {
  for (const shim of onPath(['paperclipai.cmd', 'paperclipai'])) {
    const e = entryIn(path.dirname(shim))
    if (e) return e
  }
  try {
    const { stdout } = await run('cmd.exe', ['/d', '/s', '/c', 'npm root -g'], { windowsHide: true })
    return entryIn(path.dirname(stdout.trim())) ?? entryIn(stdout.trim())
  } catch {
    return null
  }
}

export interface Detected { url: string | null; launch: 'auto' | 'folder' | null; paperclipDir: string; dataDir: string }

/**
 * Lần đầu mở app: đoán Paperclip của máy này. Ưu tiên một Paperclip đang chạy (đọc dòng lệnh của tiến trình
 * `paperclipai ... run -d <thư mục>`), sau đó tới bản cài bằng npm -g.
 */
export async function detect(): Promise<Detected> {
  const out: Detected = { url: null, launch: null, paperclipDir: '', dataDir: '' }
  const cli = (await paperclipClis())[0]
  if (cli) {
    out.dataDir = cli.dataDir
    const nm = cli.entry.toLowerCase().lastIndexOf(`${path.sep}node_modules${path.sep}`)
    const isGlobal = (await globalEntry())?.toLowerCase() === cli.entry.toLowerCase()
    if (!isGlobal && nm > 0) {
      out.launch = 'folder'
      out.paperclipDir = cli.entry.slice(0, nm)
    } else out.launch = 'auto'
    out.url = urlFromPcConfig(out.dataDir, out.launch === 'folder' ? out.paperclipDir : os.homedir())
    return out
  }
  if (await globalEntry()) out.launch = 'auto'
  out.url = urlFromPcConfig('')
  return out
}

export class Paperclip extends EventEmitter {
  state: PcState = { phase: 'idle', message: '', url: '', ours: false, log: [] }
  private child: ChildProcess | null = null
  private wslDistro = ''
  /** File pid trong WSL của lần bật này (mỗi lần một tên, không dùng nhầm file cũ) */
  private wslPid = ''
  /** Địa chỉ Paperclip tự in ra khi đã sẵn sàng (dòng "API http://…/api" trong nhật ký) */
  private banner: string | null = null
  /** Đọc theo file nhật ký Paperclip đang ghi */
  private tail: { fd: number; pos: number; timer: NodeJS.Timeout } | null = null
  private busy: Promise<void> | null = null

  private set(patch: Partial<PcState>) {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  private log(chunk: string) {
    const lines = strip(chunk).split('\n').filter((l) => l.trim())
    if (!lines.length) return
    for (const l of lines) {
      const m = /^API\s+(https?:\/\/\S+?)\/api\b/.exec(l.trim())
      if (m) this.banner = m[1]
    }
    this.set({ log: [...this.state.log, ...lines].slice(-LOG_KEEP) })
  }

  /** Paperclip có đang chạy (dù ai bật) */
  get alive() {
    return this.state.phase === 'external' || this.state.phase === 'running'
  }

  /** Kết nối Paperclip: đang chạy thì thôi, chưa thì bật theo cấu hình. Gọi chồng nhau thì chờ lượt trước. */
  ensure(cfg: DesktopConfig): Promise<void> {
    if (!this.busy) this.busy = this.doEnsure(cfg).finally(() => { this.busy = null })
    return this.busy
  }

  private async doEnsure(cfg: DesktopConfig) {
    // Paperclip do app bật vẫn còn (đang khởi động, hoặc lần trước chờ quá lâu): chờ tiếp, KHÔNG bật thêm bản nữa
    if (this.child) {
      if (this.state.phase === 'running') return
      this.set({ phase: 'starting', message: 'Paperclip vẫn đang khởi động…' })
      return this.waitUp(this.child, cfg)
    }
    const url = normUrl(cfg.paperclipUrl)
    this.set({ phase: 'checking', message: 'Đang tìm Paperclip…', url, log: [] })
    if (await health(url)) return this.set({ phase: 'external', message: 'Paperclip đang chạy.', ours: false })

    if (cfg.launch === 'none') {
      return this.set({ phase: 'stopped', message: `Không thấy Paperclip ở ${url}. Hãy bật Paperclip, app sẽ tự kết nối lại.` })
    }
    if (cfg.launch === 'wsl') return this.startWsl(cfg, url)

    const cwd = cfg.launch === 'folder' ? cfg.paperclipDir : os.homedir()
    const entry = cfg.launch === 'folder' ? entryIn(cfg.paperclipDir) : await globalEntry()
    if (!entry) {
      if (cfg.launch === 'folder') {
        return this.set({ phase: 'error', message: `Không thấy Paperclip trong thư mục ${cfg.paperclipDir || '(chưa chọn)'}. Chọn thư mục có node_modules\\paperclipai.` })
      }
      // Đã có dữ liệu Paperclip mà không thấy lệnh paperclipai: KHÔNG đề nghị cài bản mới nhất (nó có thể nâng cấp
      // database lên phiên bản mà bản đang dùng không mở được). Hỏi thư mục cài thay vì vậy.
      const existing = pcConfigFile(cfg.dataDir, cwd)
      if (existing) {
        return this.set({ phase: 'error', message: `Máy có dữ liệu Paperclip (${path.dirname(existing)}) nhưng không thấy lệnh paperclipai. Chọn "Tự bật Paperclip trong một thư mục cài riêng" và chỉ tới thư mục cài Paperclip của bạn.` })
      }
      return this.set({ phase: 'missing', message: 'Máy này chưa cài Paperclip.' })
    }
    const node = await nodeBin()
    if (!node) return this.set({ phase: 'error', message: 'Không thấy Node.js trên máy. Paperclip cần Node.js 24.11 trở lên (nodejs.org).' })
    if (!node.ok) return this.set({ phase: 'error', message: `Paperclip cần Node.js 24.11 trở lên, máy đang có ${node.version}. Cài bản mới ở nodejs.org rồi thử lại.` })

    // Đã có Paperclip khác trên cùng dữ liệu (đang chạy ở cổng khác, hoặc bạn vừa tự bật và nó đang khởi động): chờ nó
    const cli = await clashingCli(pcHome(cfg.dataDir, cwd))
    const other = cli ? { pid: cli.pid, url: null } : await otherPaperclip(cfg.dataDir, cwd)
    if (other) return this.waitOther(other, cfg, cwd)

    // Paperclip chưa có cấu hình (cài mới): chạy bước thiết lập nhanh, không cài dịch vụ nền, rồi bật luôn.
    // Đoán sai cũng không hại: onboard giữ nguyên cấu hình đã có.
    const fresh = !pcConfigFile(cfg.dataDir, cwd)
    const args = fresh ? ['onboard', '--yes', '--no-install-service', '--run'] : ['run']
    if (cfg.dataDir) args.push('--data-dir', cfg.dataDir)

    const out = this.openLog()
    this.set({ phase: 'starting', url, ours: true, message: fresh ? 'Đang thiết lập Paperclip lần đầu…' : 'Đang bật Paperclip…' })
    const child = spawn(node.bin, ['--require', hookPath(), entry, ...args], {
      cwd,
      // Giữ nguyên môi trường như khi tự bật (agent thừa hưởng nó); màu ANSI trong nhật ký được lọc ở log()
      env: { ...process.env, COOPVERSE_PC_HOOK: '1' },
      stdio: ['ignore', out, out, 'ipc'],
      windowsHide: true,
    })
    closeSync(out)
    this.child = child
    this.watch(child)
    await this.waitUp(child, cfg)
  }

  /** Một Paperclip không do app bật đang chạy / khởi động trên cùng dữ liệu: chờ nó sẵn sàng rồi kết nối, không bật thêm */
  private async waitOther(other: { pid: number; url: string | null }, cfg: DesktopConfig, cwd: string) {
    this.set({ phase: 'checking', ours: false, message: 'Paperclip đang khởi động (không phải do Pixel Company bật). Đang chờ nó sẵn sàng…' })
    const home = pcHome(cfg.dataDir, cwd)
    const until = Date.now() + START_TIMEOUT_MS
    while (Date.now() < until) {
      const u = runtimeInfo(home)?.url ?? other.url ?? urlFromPcConfig(cfg.dataDir, cwd)
      if (u && (await health(u, 1500))) return this.set({ phase: 'external', url: u, ours: false, message: 'Paperclip đang chạy.' })
      if (!alive(other.pid)) return this.set({ phase: 'error', message: 'Paperclip kia đã dừng trước khi sẵn sàng. Bấm Thử lại.' })
      await new Promise((r) => setTimeout(r, 1000))
    }
    this.set({ phase: 'error', message: 'Đang có Paperclip khởi động trên cùng dữ liệu nhưng chưa xong sau 3 phút. Kiểm tra cửa sổ Paperclip của bạn rồi bấm Thử lại.' })
  }

  private startWsl(cfg: DesktopConfig, url: string) {
    const distro = cfg.wslDistro.trim()
    if (!distro) return this.set({ phase: 'error', message: 'Chưa điền tên bản WSL (xem bằng lệnh "wsl -l").' })
    const out = this.openLog()
    this.set({ phase: 'starting', ours: true, message: `Đang bật Paperclip trong WSL ${distro}…` })
    // Ghi pid để lúc tắt gửi SIGTERM đúng tiến trình (exec giữ nguyên pid). Mỗi lần bật một file riêng.
    this.wslPid = `/tmp/coopverse-paperclip-${Date.now()}.pid`
    const sh = `echo $$ > ${this.wslPid}; export PATH=$HOME/.local/bin:$PATH; exec paperclipai run`
    const child = spawn('wsl.exe', ['-d', distro, '--cd', '~', '--', 'bash', '-lc', sh], { stdio: ['ignore', out, out], windowsHide: true })
    closeSync(out)
    this.child = child
    this.wslDistro = distro
    this.watch(child)
    return this.waitUp(child, cfg, url)
  }

  /** Mở file nhật ký mới cho Paperclip ghi vào, và bắt đầu đọc theo. Trả về fd để truyền cho tiến trình con. */
  private openLog(): number {
    this.stopTail()
    this.banner = null
    mkdirSync(logDir(), { recursive: true })
    const file = path.join(logDir(), 'paperclip.log')
    const out = openSync(file, 'w')
    const fd = openSync(file, 'r')
    const tail = { fd, pos: 0, timer: setInterval(() => this.readTail(), 400) }
    this.tail = tail
    return out
  }

  private readTail() {
    const t = this.tail
    if (!t) return
    const buf = Buffer.alloc(64 * 1024)
    let n = 0
    let text = ''
    while ((n = readSync(t.fd, buf, 0, buf.length, t.pos)) > 0) {
      t.pos += n
      text += buf.toString('utf8', 0, n)
    }
    if (text) this.log(text)
  }

  private stopTail() {
    const t = this.tail
    if (!t) return
    this.readTail()
    clearInterval(t.timer)
    closeSync(t.fd)
    this.tail = null
  }

  private watch(child: ChildProcess) {
    child.on('error', (e) => this.log(`Lỗi: ${e.message}`))
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.wslDistro = ''
      this.wslPid = ''
      this.stopTail()
      if (this.state.phase === 'stopping') this.set({ phase: 'stopped', ours: false, message: 'Đã tắt Paperclip.' })
      else this.set({ phase: 'error', ours: false, message: `Paperclip đã dừng (mã ${code ?? '?'}). Xem nhật ký bên dưới.` })
    })
  }

  /**
   * Chờ chính tiến trình app bật sẵn sàng. Chỉ tin địa chỉ chứng minh được là của nó: runtime-info.json có đúng pid
   * của nó, hoặc dòng "API http://…" nó tự in ra. (Một Paperclip khác có thể đang giữ cổng trong cấu hình; khi đó
   * Paperclip của app nhảy sang cổng kế tiếp.) WSL không đọc được runtime-info nên dùng `fixed`.
   */
  private async waitUp(child: ChildProcess, cfg: DesktopConfig, fixed?: string) {
    const home = pcHome(cfg.dataDir, cfg.launch === 'folder' ? cfg.paperclipDir : os.homedir())
    const until = Date.now() + START_TIMEOUT_MS
    while (Date.now() < until) {
      if (this.child !== child) return
      const rt = runtimeInfo(home)
      const u = fixed ?? (rt && rt.pid === child.pid ? rt.url : this.banner)
      if (u && (await health(u, 1500))) return this.set({ phase: 'running', url: u, message: 'Paperclip đã sẵn sàng.' })
      await new Promise((r) => setTimeout(r, 1000))
    }
    // Tiến trình vẫn còn: giữ lại (Thử lại sẽ chờ tiếp nó, không bật bản thứ hai)
    this.set({ phase: 'error', message: 'Paperclip bật quá lâu chưa xong (3 phút). Xem nhật ký bên dưới, bấm Thử lại để chờ tiếp.' })
  }

  /**
   * Tắt gọn Paperclip do app bật. Trả về true khi đã tắt (hoặc không có gì để tắt), false khi chờ quá `ms`
   * mà Paperclip chưa dừng (lúc đó người dùng quyết có buộc tắt không).
   */
  async stop(ms = 90_000): Promise<boolean> {
    const child = this.child
    if (!child || !this.state.ours) return true
    this.set({ phase: 'stopping', message: 'Đang tắt Paperclip an toàn (chờ việc đang chạy dừng, đóng database)…' })
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    if (this.wslDistro) {
      spawn('wsl.exe', ['-d', this.wslDistro, '--', 'bash', '-c', `kill -TERM "$(cat ${this.wslPid})"`], { windowsHide: true, stdio: 'ignore' })
    } else if (child.connected) {
      child.send('coopverse:shutdown')
    }
    const done = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
    return done
  }

  /** Buộc tắt cả cây tiến trình (chỉ khi người dùng đồng ý sau khi tắt gọn quá lâu) */
  async kill() {
    const child = this.child
    if (!child?.pid) return
    try {
      // WSL: taskkill chỉ tắt wsl.exe, Paperclip bên trong Linux phải tắt riêng
      if (this.wslDistro && this.wslPid) {
        await run('wsl.exe', ['-d', this.wslDistro, '--', 'bash', '-c', `kill -KILL "$(cat ${this.wslPid})"`], { windowsHide: true }).catch(() => {})
      }
      await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch { /* đã tắt */ }
  }

  /** Cài Paperclip bằng `npm install -g paperclipai` */
  async install(): Promise<boolean> {
    const node = await nodeBin()
    if (!node) {
      this.set({ phase: 'error', message: 'Cần cài Node.js (bản 24.11 trở lên) trước: tải ở nodejs.org, cài xong mở lại Pixel Company.' })
      return false
    }
    if (!node.ok) {
      this.set({ phase: 'error', message: `Paperclip cần Node.js 24.11 trở lên, máy đang có ${node.version}. Cài bản mới ở nodejs.org rồi thử lại.` })
      return false
    }
    this.set({ phase: 'installing', message: 'Đang cài Paperclip (npm install -g paperclipai)… có thể mất vài phút.', log: [] })
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm install -g paperclipai'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.setEncoding('utf8').on('data', (d: string) => this.log(d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => this.log(d))
    const code = await new Promise<number | null>((r) => {
      child.on('exit', r)
      child.on('error', () => r(-1))
    })
    if (code !== 0) {
      this.set({ phase: 'error', message: `Cài Paperclip không thành công (mã ${code}). Xem nhật ký bên dưới.` })
      return false
    }
    this.set({ phase: 'idle', message: 'Đã cài Paperclip.' })
    return true
  }
}

let hookFile = ''
/** File hook nạp vào Paperclip (phải là file thật trên đĩa, không nằm trong app.asar) */
export const setHookPath = (p: string) => { hookFile = p }
const hookPath = () => hookFile
