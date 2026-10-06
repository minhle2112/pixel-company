import { useEffect, useState } from 'react'
import { DeskForm, ItemForm, TargetList } from './Editor'
import { HouseProps, HouseSide } from './house/HousePanels'
import { HouseView, deleteSel, nudgeSel, rotateKit, toolKeys } from './house/HouseView'
import { houseProblemsOf, isHouseDirty, useH } from './house/store'
import { CutPanel, SheetPicker, SheetView } from './Sheet'
import { isDirty, problems, useC } from './store'

/**
 * Trang cắt hình (chỉ chạy dev, mở /cutter.html), hai mục:
 * - ✂️ Đồ trang trí: cắt hình LimeZu, ghép thành đồ trang trí (đủ các hướng xoay) hoặc bàn ghế làm việc, chỉnh giá / cỡ /
 *   công dụng, rồi lưu thẳng vào src/data/items.json
 * - 🏠 Thiết kế nhà: vẽ phòng, cửa, sàn, kiểu tường, đồ có sẵn khi mở phòng, rồi lưu vào src/data/house.json
 *   (server sinh lại maps/office.tmj)
 */
type Mode = 'items' | 'house'
const MODE_KEY = 'coopverse-cutter-mode'
const keptMode = (): Mode => {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'house' ? 'house' : 'items'
  } catch {
    return 'items'
  }
}

export function App() {
  const [mode, setModeRaw] = useState<Mode>(keptMode)
  const setMode = (m: Mode) => {
    setModeRaw(m)
    try { sessionStorage.setItem(MODE_KEY, m) } catch { /* thôi */ }
  }
  const file = useC((s) => s.file)
  const target = useC((s) => s.target)
  const msg = useC((s) => s.msg)
  const itemsDirty = useC(isDirty)
  const houseDirty = useH(isHouseDirty)
  const house = useH((s) => s.file)
  const dirty = mode === 'house' ? houseDirty : itemsDirty
  const past = useC((s) => s.past.length)
  const future = useC((s) => s.future.length)
  const hPast = useH((s) => s.past.length)
  const hFuture = useH((s) => s.future.length)
  const [help, setHelp] = useState(false)
  const store = () => (mode === 'house' ? useH.getState() : useC.getState())

  useEffect(() => {
    useC.getState().load().catch(() => useC.getState().toast('Không đọc được items.json: trang này chỉ chạy khi npm run dev', true))
    useH.getState().load().catch(() => useC.getState().toast('Không đọc được house.json: trang này chỉ chạy khi npm run dev', true))
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void store().save()
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store().redo()
        else store().undo()
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store().redo()
      } else if (mode === 'house' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Phím tắt thiết kế nhà: công cụ, xoá, xoay, dời
        const k = e.key.toLowerCase()
        const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }
        if (toolKeys[k]) useH.setState({ tool: toolKeys[k] })
        else if (k === 'delete' || k === 'backspace') deleteSel()
        else if (k === 'r') rotateKit()
        else if (k === 'escape') useH.setState(useH.getState().tool !== 'select' ? { tool: 'select' } : { sel: null })
        else if (arrows[k]) nudgeSel(...arrows[k])
        else return
        e.preventDefault()
      }
    }
    const leave = (e: BeforeUnloadEvent) => {
      if (isDirty(useC.getState()) || isHouseDirty(useH.getState())) e.preventDefault()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('beforeunload', leave)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('beforeunload', leave)
    }
  }, [mode])

  const bad = mode === 'house' ? (house ? houseProblemsOf(house).length : 0) : file ? problems(file).length : 0
  return (
    <div className="app">
      <header>
        <b>✂️ Cắt hình LimeZu</b>
        <div className="modes">
          <button className={mode === 'items' ? 'on' : ''} onClick={() => setMode('items')}>✂️ Đồ trang trí{itemsDirty ? ' ●' : ''}</button>
          <button className={mode === 'house' ? 'on' : ''} onClick={() => setMode('house')}>🏠 Thiết kế nhà{houseDirty ? ' ●' : ''}</button>
        </div>
        <span className="grow" />
        {bad > 0 && <span className="bad small">⚠ {bad} lỗi cần sửa trước khi lưu</span>}
        <span className={`small ${dirty ? 'warn-text' : 'dim'}`}>{dirty ? '● Chưa lưu' : 'Đã lưu'}</span>
        <button disabled={!(mode === 'house' ? hPast : past)} onClick={() => store().undo()} title="Hoàn tác (Ctrl+Z)">↶</button>
        <button disabled={!(mode === 'house' ? hFuture : future)} onClick={() => store().redo()} title="Làm lại (Ctrl+Y)">↷</button>
        <button className="primary" disabled={!dirty} onClick={() => void store().save()} title="Ctrl+S">💾 Lưu vào game</button>
        <a className="btn" href="/?demo" target="_blank" rel="noreferrer" title="Mở bản demo để xem / mua thử">🎮 Mở game demo ↗</a>
        <button onClick={() => setHelp((h) => !h)}>❔ Cách dùng</button>
      </header>
      {help && (mode === 'house' ? <HouseHelp onClose={() => setHelp(false)} /> : <Help onClose={() => setHelp(false)} />)}
      {mode === 'house' ? (
        <main>
          <aside className="left"><HouseSide /></aside>
          <section className="center"><HouseView /></section>
          <aside className="right"><HouseProps /></aside>
        </main>
      ) : (
      <main>
        <aside className="left"><SheetPicker /></aside>
        <section className="center">
          <SheetView />
          <CutPanel />
        </section>
        <aside className="right">
          <TargetList />
          <div className="editor" key={target?.kind === 'item' ? target.id : target ? 'desk' : ''}>
            {!file ? <p className="hint pad">Đang đọc items.json…</p>
              : !target ? <p className="hint pad">Chọn một món bên trên để sửa, hoặc cắt hình rồi bấm <b>✨ Tạo món mới từ hình này</b>.</p>
              : target.kind === 'item' ? <ItemForm id={target.id} rot={target.rot} />
              : <DeskForm target={target} />}
          </div>
        </aside>
      </main>
      )}
      {msg && <div className={`toast${msg.bad ? ' bad' : ''}`}>{msg.text}</div>}
    </div>
  )
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>Cách dùng</h3>
        <ol>
          <li><b>Chọn ảnh</b> ở cột trái. Thư mục <i>Theme_Sorter_Singles</i>, <i>4_Modern_Office_singles</i> có sẵn từng món một ảnh; ảnh lớn thì gom nhiều món.</li>
          <li><b>Cắt</b>: bấm vào món là tự cắt sát. Kéo chuột để cắt theo khung. Giữ Shift để gộp thêm vùng (món có phần rời nhau). Chỉnh từng pixel ở ô x, y, rộng, cao bên dưới.</li>
          <li><b>Món mới</b>: bấm <i>✨ Tạo món mới từ hình này</i>, rồi đặt tên, giá, nhóm, cỡ chân món (số ô 16 px chân món chiếm trên sàn, không phải cỡ hình).</li>
          <li><b>Nhiều hướng</b>: chọn kiểu xoay <i>4 hướng</i> (hoặc 2 hướng), rồi ở từng tab hướng cắt hình hướng đó và bấm <i>➕ Thêm mảnh</i>. Hướng trái/phải thì chân món tự xoay ngang.</li>
          <li><b>Món ghép nhiều mảnh</b>: thêm nhiều mảnh vào cùng một hướng, kéo từng mảnh trong khung xem trước cho khớp. ▲▼ đổi mảnh nào nằm trên.</li>
          <li><b>Hình động</b> (3_Animated_objects): cắt khung đầu, điền <i>Số khung</i> trước khi thêm.</li>
          <li><b>Ghế, sofa</b>: chọn công dụng <i>Ngồi được</i>, khung xem trước hiện người ngồi thử. Tay ghế che người thì tăng <i>Phần đè người ngồi</i>.</li>
          <li><b>Bàn ghế làm việc</b>: mục đầu danh sách. Mặt bàn tự kéo cho vừa cỡ bàn (giữ 4 mép, lặp phần giữa); ghế có 3 kiểu nhìn và bản ghế da.</li>
          <li><b>Đồ trên bàn</b> (máy tính, bàn phím, cốc, đồ để bàn agent mua): chọn kiểu bàn, tick các đồ để thử như agent đã mua, bấm món trong khung rồi kéo để dời chỗ. Bàn chật thì thêm <i>chỗ riêng khi có …</i> (hoặc ẩn món). Đồ để bàn mới: cắt hình rồi bấm <i>✨ Tạo đồ để bàn mới từ hình này</i>, đặt giá và cấp mở khoá.</li>
          <li><b>Lưu</b> (Ctrl+S): ghi vào <code>src/data/items.json</code>, game đang mở tự tải lại. Mở <i>game demo</i> để mua thử. Nhớ commit file này.</li>
        </ol>
        <p className="dim">Khung xanh lá: chỗ món chiếm trên sàn. Dấu + đỏ: điểm neo (giữa mép dưới chân món). Khung xanh nét đứt trong ảnh: hình game đang dùng.</p>
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  )
}

function HouseHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>Thiết kế nhà</h3>
        <ol>
          <li><b>Lưới ô</b>: mỗi ô 0,5 m (16 px). Ô không thuộc phòng nào mà sát phòng là <b>tường</b>; xa hơn là ngoài nhà (nền tối). Hai phòng phải cách nhau ít nhất 1 ô tường.</li>
          <li><b>Phòng mới</b> (N): kéo chuột vẽ khung. Phòng chữ L, chữ T: chọn phòng rồi <b>Thêm khúc</b> (A), kéo khung liền cạnh. <b>Khoét bớt</b> (X): kéo khung để bỏ phần đó khỏi mọi phòng.</li>
          <li><b>Chọn</b> (V): bấm phòng để sửa tên, biểu tượng, mở sẵn hay khoá, mô tả, sàn. Kéo phòng đang chọn để dời, kéo mép khúc để đổi cỡ.</li>
          <li><b>Vách</b> (B): kéo chuột vẽ một đoạn vách thẳng trong phòng; chọn <b>tường cao</b> hoặc <b>vách thấp</b> (hình LimeZu ở mục Kiểu tường). Vẽ đè thì đổi loại. <b>Dỡ vách</b> (U): kéo qua đoạn muốn bỏ. Người chơi không xây vách trong game, chỉ đặt đồ. Lối đi, cửa phải rộng ít nhất 2 ô cho agent đi qua.</li>
          <li><b>Cửa</b> (D): bấm ô tường giữa hai phòng, hoặc ô vách trong phòng (cửa 2 ô theo vách). Cửa 2 ô trên tường / vách cao chạy ngang là cửa kính tự mở; còn lại là lối đi trống. Phòng khoá phải có cửa thông tới phòng mở sẵn (trực tiếp hoặc qua phòng khác) mới mở được.</li>
          <li><b>Cửa vào</b> (E), <b>cửa sổ</b> (W), <b>bảng ticket</b> (K): bấm trên tường nam / bắc. <b>Cụm bàn</b> (P, 4 bàn agent) và <b>chỗ chờ</b> (L, ứng viên) phải nằm trong phòng mở sẵn.</li>
          <li><b>Bàn Lead</b> (M): bấm để đặt bàn riêng cho Lead (agent không báo cáo cho ai), R xoay hướng ngồi. Lead ngồi đó, thành viên vẫn ngồi cụm bàn. Chưa có bàn riêng thì Lead ngồi ghế đầu cụm bàn 1 (có nhãn 👔 Lead). Bàn phải nằm trong phòng mở sẵn, không đè cụm bàn / đồ có sẵn, không chắn cửa vào.</li>
          <li><b>Đồ có sẵn</b> (O): chọn phòng, chọn món ở cột phải, bấm vào phòng để đặt (R xoay). Phòng khoá: các món tự có khi trả Xu mở phòng. Phòng mở sẵn: các món được đặt vào văn phòng một lần, lần mở game sau khi lưu (bán / cất thì không quay lại). Bán lại không được Xu.</li>
          <li><b>Dùng làm</b> (cột phải của phòng): phòng nghỉ / phòng ngủ của agent. Có thì agent rảnh chỉ chơi trong các phòng đó; agent tạm dừng về giường (nhóm 🛏️ Phòng ngủ) mà ngủ.</li>
          <li><b>Sàn</b>, <b>kiểu tường</b>: chọn ô từ ảnh LimeZu (Room_Builder_Floors / Walls). Tường cao dùng cho tường giữa các phòng và vách cao trong phòng; vách thấp lấy dải dưới.</li>
          <li><b>Lưu</b> (Ctrl+S): ghi <code>src/data/house.json</code>, sinh lại <code>maps/office.tmj</code>; server khởi động lại, game tự tải lại. Văn phòng đã có đồ: món hết chỗ tự cất vào kho, phòng đã mở mà bị xoá (hoặc đổi mã) thì trả lại Xu, đồ đè lên vách mới thì cất kho.</li>
        </ol>
        <p className="dim">Khung đỏ: ô có lỗi (bấm lỗi ở cột phải để tìm). Layer Collision của bản đồ vẫn vẽ trong Tiled; các layer khác do trang này sinh ra, sửa trong Tiled sẽ bị ghi đè.</p>
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  )
}
