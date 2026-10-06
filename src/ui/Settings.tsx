import { useEffect, useState } from 'react'
import { uiTick, unlockAudio } from '../audio/engine'
import { desktop } from '../desktop'
import { useSettings } from '../settings'
import { useCoop } from '../store'
import { useDeco } from './decoStore'
import { fmtHour, periodOf, sceneHour, sunElevation } from '../world/time'

/** Giờ đang hiển thị trong văn phòng, cập nhật mỗi 10 giây (hoặc ngay khi kéo thanh xem thử). */
function useSceneHour() {
  const override = useSettings((s) => s.hour)
  const [h, setH] = useState(sceneHour)
  useEffect(() => {
    setH(sceneHour())
    if (override !== null) return
    const id = setInterval(() => setH(sceneHour()), 10_000)
    return () => clearInterval(id)
  }, [override])
  return h
}

const icon = (h: number) => {
  const e = sunElevation(h)
  if (e < -0.05) return '🌙'
  if (e < 0.25) return h < 12 ? '🌅' : '🌇'
  return '☀️'
}

export function Clock() {
  const h = useSceneHour()
  const preview = useSettings((s) => s.hour !== null)
  return (
    <div className="clock" title={preview ? 'Đang xem thử giờ khác (đổi trong Cài đặt)' : 'Giờ Việt Nam (GMT+7)'}>
      <span>{icon(h)}</span>
      <b>{fmtHour(h)}</b>
      <span className="muted">{periodOf(h)}{preview ? ' · xem thử' : ''}</span>
    </div>
  )
}

/** Hàng nút nhanh dưới bảng thương hiệu: âm thanh, nhạc, tủ đồ, cài đặt. */
export function Toolbar() {
  const sfx = useSettings((s) => s.sfx)
  const music = useSettings((s) => s.music)
  const set = useSettings((s) => s.set)
  const openWardrobe = useCoop((s) => s.openWardrobe)
  const toggleSettings = useCoop((s) => s.toggleSettings)
  const settingsOpen = useCoop((s) => s.settingsOpen)
  const toggleRooms = useCoop((s) => s.toggleRooms)
  const roomsOpen = useCoop((s) => s.roomsOpen)
  const toggleDeco = useCoop((s) => s.toggleDeco)
  const decoOpen = useDeco((s) => s.open)
  const assistantOpen = useCoop((s) => s.assistantOpen)
  const toggleAssistant = useCoop((s) => s.toggleAssistant)
  const tap = (fn: () => void) => () => { unlockAudio(); fn(); uiTick() }
  return (
    <div className="toolbar">
      <button className={`tb-btn${sfx ? ' on' : ''}`} onClick={tap(() => set({ sfx: !sfx }))} title="Âm thanh văn phòng (gõ phím, thông báo)" aria-label="Âm thanh văn phòng" aria-pressed={sfx}>
        <span aria-hidden>{sfx ? '🔊' : '🔇'}</span>
      </button>
      <button className={`tb-btn${music ? ' on' : ''}`} onClick={tap(() => set({ music: !music }))} title="Nhạc lofi (phím M)" aria-label="Nhạc lofi" aria-pressed={music} aria-keyshortcuts="M">
        <span aria-hidden>🎵</span>
      </button>
      <button className={`tb-btn${assistantOpen ? ' on' : ''}`} onClick={tap(toggleAssistant)} title="Lễ tân: chat với Trợ lý của văn phòng (phím L)" aria-label="Lễ tân" aria-expanded={assistantOpen} aria-keyshortcuts="L">
        <span aria-hidden>🛎️</span>
      </button>
      <button className="tb-btn" onClick={tap(() => openWardrobe('player'))} title="Tủ đồ (phím C)" aria-label="Tủ đồ" aria-keyshortcuts="C">
        <span aria-hidden>🎨</span>
      </button>
      <button className={`tb-btn${roomsOpen ? ' on' : ''}`} onClick={tap(toggleRooms)} title="Mở phòng mới (phím B)" aria-label="Mở phòng" aria-expanded={roomsOpen} aria-keyshortcuts="B">
        <span aria-hidden>🔑</span>
      </button>
      <button className={`tb-btn${decoOpen ? ' on' : ''}`} onClick={tap(toggleDeco)} title="Trang trí: cửa hàng, đặt đồ (phím T)" aria-label="Trang trí" aria-expanded={decoOpen} aria-keyshortcuts="T">
        <span aria-hidden>🛋️</span>
      </button>
      <button className={`tb-btn${settingsOpen ? ' on' : ''}`} onClick={tap(toggleSettings)} title="Cài đặt" aria-label="Cài đặt" aria-expanded={settingsOpen}>
        <span aria-hidden>⚙️</span>
      </button>
    </div>
  )
}

/** Mục "Ứng dụng" trong Cài đặt, chỉ có khi chạy bằng app desktop */
function DesktopSection() {
  const [note, setNote] = useState('')
  if (!desktop) return null
  const d = desktop
  const run = (fn: () => Promise<string | null>) => async () => {
    const t = await fn()
    if (t !== null) setNote(t)
  }
  const update = run(async () => {
    setNote('Đang kiểm tra…')
    const u = await d.checkUpdate()
    if (u.status === 'new' && u.url) {
      void d.openExternal(u.url)
      return `Có bản ${u.latest}: đã mở trang tải về.`
    }
    return u.status === 'latest' ? 'Bạn đang dùng bản mới nhất.' : u.status === 'none' ? 'Chưa có bản phát hành nào trên GitHub.' : 'Không kiểm tra được (mất mạng?).'
  })
  const assets = run(async () => {
    const r = await d.pickAssets()
    if (r.ok) {
      location.reload()
      return null
    }
    return r.canceled ? null : 'Thư mục đó chưa đủ hình (cần 1_Interiors, 2_Characters, Modern_Office).'
  })
  const exp = run(async () => {
    const r = await d.importExp()
    if (r.canceled) return null
    return r.ok ? `Đã gộp ${r.count} sổ EXP. Mở lại trang để thấy điểm mới.` : `Không nhập được: ${r.error ?? 'lỗi lạ'}`
  })
  return (
    <>
      <div className="set-sec">Ứng dụng · bản {d.version}</div>
      <div className="set-row set-btns">
        <button type="button" className="desk-btn" onClick={() => void d.openSetup()}>Kết nối Paperclip…</button>
        <button type="button" className="desk-btn" onClick={assets}>Thư mục gói hình…</button>
        <button type="button" className="desk-btn" onClick={exp}>Nhập EXP cũ…</button>
        <button type="button" className="desk-btn" onClick={update}>Kiểm tra bản mới</button>
      </div>
      <p className="set-hint" aria-live="polite">
        {note || 'Nhập EXP cũ: chọn thư mục .coopverse của bản chạy bằng trình duyệt để giữ điểm, Xu và văn phòng đã sắm. F11: toàn màn hình.'}
      </p>
      <p className="set-hint">
        Hình pixel: LimeZu (
        <a href="https://limezu.itch.io" target="_blank" rel="noreferrer">limezu.itch.io</a>
        ), gói Modern Interiors và Modern Office.
      </p>
    </>
  )
}

function Slider({ value, onChange, disabled, label }: { value: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  return (
    <input
      type="range" min={0} max={1} step={0.05} value={value} disabled={disabled} aria-label={label}
      aria-valuetext={`${Math.round(value * 100)}%`}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

export function SettingsPanel() {
  const s = useSettings()
  const close = useCoop((st) => st.toggleSettings)
  const h = useSceneHour()
  const set = (patch: Parameters<typeof s.set>[0]) => { unlockAudio(); s.set(patch) }
  return (
    <section className="panel settings" aria-label="Cài đặt">
      <div className="set-head">
        <b>Cài đặt</b>
        <button className="term-close" onClick={close}><kbd>Esc</kbd> Đóng</button>
      </div>

      <div className="set-sec">Âm thanh</div>
      <div className="set-row">
        <label className="set-check">
          <input type="checkbox" checked={s.sfx} onChange={(e) => set({ sfx: e.target.checked })} />
          <span>Âm thanh văn phòng</span>
        </label>
        <Slider label="Âm lượng âm thanh văn phòng" value={s.sfxVol} disabled={!s.sfx} onChange={(v) => set({ sfxVol: v })} />
      </div>
      <div className="set-row">
        <label className="set-check">
          <input type="checkbox" checked={s.music} onChange={(e) => set({ music: e.target.checked })} />
          <span>Nhạc lofi <kbd>M</kbd></span>
        </label>
        <Slider label="Âm lượng nhạc lofi" value={s.musicVol} disabled={!s.music} onChange={(v) => set({ musicVol: v })} />
      </div>
      <p className="set-hint">Tiếng gõ phím khi agent làm việc, tiếng "ting" khi có thông báo, tiếng bước chân và bong bóng chat. Nhạc do máy tự sáng tác, không lặp lại.</p>

      <div className="set-sec">Thu phóng</div>
      <div className="set-row" role="radiogroup" aria-label="Mức thu phóng">
        {(['near', 'far'] as const).map((z) => (
          <label key={z} className="set-check">
            <input type="radio" name="coop-zoom" checked={s.zoom === z} onChange={() => set({ zoom: z })} />
            <span>{z === 'near' ? 'Gần' : 'Xa nhất'}</span>
          </label>
        ))}
      </div>
      <p className="set-hint">Gần: nhìn rõ người và đồ vật. Xa nhất: thấy nhiều văn phòng nhất. Trình duyệt nhớ mức bạn chọn.</p>

      {/* Bản pixel không có mục Đồ hoạ: chất lượng (bóng đổ, khử răng cưa…) chỉ dùng cho bản 3D */}
      <div className="set-sec">Giờ trong văn phòng</div>
      <label className="set-row set-check">
        <input type="checkbox" checked={s.hour === null} onChange={(e) => set({ hour: e.target.checked ? null : (Math.round(h * 4) / 4) % 24 })} />
        <span>Theo giờ Việt Nam</span>
      </label>
      <div className="set-row set-hour">
        <input
          type="range" min={0} max={23.75} step={0.25} value={s.hour ?? h} aria-label="Giờ xem thử" aria-valuetext={fmtHour(s.hour ?? h)}
          onChange={(e) => set({ hour: Number(e.target.value) })}
        />
        <b>{fmtHour(s.hour ?? h)}</b>
      </div>
      <p className="set-hint">Kéo để xem thử văn phòng lúc bình minh, hoàng hôn hay ban đêm. Mở lại trang là về giờ thật.</p>

      <DesktopSection />
    </section>
  )
}
