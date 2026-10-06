import { useState } from 'react'
import { partsOf, usePixelLooks } from '../pixel/look'
import { Avatar } from '../pixel/Wardrobe'
import { EXP, levelProgress, ranking, titleOf, useExp, weekStart, type RankBy } from '../data/exp'
import { useOffice } from '../data/officeSync'
import { XU_TICKET, fmtXu } from '../data/xu'
import { useCoop } from '../store'

const BY_LABEL: Record<RankBy, string> = { week: 'Tuần này', total: 'Mọi lúc' }

/** Bảng vinh danh phóng to khi bấm E trước bảng: xếp hạng EXP, chi tiết điểm, Xu mỗi agent mang về cho quỹ. */
export function FameView() {
  const agents = useCoop((s) => s.agents)
  const company = useCoop((s) => s.company)
  const demo = useCoop((s) => s.conn === 'demo')
  const closeFame = useCoop((s) => s.closeFame)
  const stats = useExp((s) => s.stats)
  const ready = useExp((s) => s.ready)
  const xuOf = useOffice((s) => s.earned.byAgent)
  usePixelLooks((s) => s.custom)
  const [by, setBy] = useState<RankBy>('week')
  const rows = ranking(agents, stats, by)
  const leads = new Set(agents.map((a) => a.reportsTo).filter(Boolean))
  const since = new Date(weekStart()).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })

  return (
    <div className="term-wrap">
      <div className="fame">
        <div className="term-bar">
          <span className="term-dots"><i /><i /><i /></span>
          <span className="term-title">
            🏆 Bảng vinh danh{company ? ` · ${company.name}` : demo ? ' · demo' : ''}
            <span className="muted">· {by === 'week' ? `từ thứ Hai ${since}` : 'từ lúc có Pixel Company'}</span>
          </span>
          <div className="term-tabs" role="tablist" aria-label="Xếp hạng theo">
            {(['week', 'total'] as RankBy[]).map((b) => (
              <button key={b} role="tab" aria-selected={by === b} className={by === b ? 'on' : ''} onClick={() => setBy(b)}>
                {BY_LABEL[b]}
              </button>
            ))}
          </div>
          <button className="term-close" onClick={closeFame} title="Quay lại văn phòng">
            <kbd>Esc</kbd> Đóng
          </button>
        </div>

        <div className="fame-list">
          {!ready && <div className="fame-empty">Đang đọc sổ EXP…</div>}
          {ready && !rows.length && <div className="fame-empty">Công ty chưa có agent nào.</div>}
          {ready && rows.map((r, i) => {
            const s = r.stats
            const lv = s?.level ?? 1
            const [have, need] = levelProgress(s?.total ?? 0)
            const c = by === 'week' ? s?.weekCounts : s?.counts
            return (
              <div key={r.agent.id} className={`fame-row${i < 3 && r.exp > 0 ? ` top top${i + 1}` : ''}`}>
                <span className="fame-rank">{i + 1}</span>
                <span className="fame-av px-fame-av">
                  <Avatar parts={partsOf(r.agent.id, r.agent.name, leads.has(r.agent.id))} scale={2} />
                </span>
                <span className="fame-who">
                  <span className="fame-name">
                    {r.agent.name}
                  </span>
                  <span className="fame-title">
                    <span className="lv-chip">Lv {lv}</span> {titleOf(lv)}
                  </span>
                  <span className="fame-progress" title={`Còn ${need - have} EXP nữa lên cấp ${lv + 1}`}>
                    <span className="exp-mini"><i style={{ width: `${Math.round((100 * have) / need)}%` }} /></span>
                    <span className="muted">{have}/{need} tới cấp {lv + 1}</span>
                  </span>
                </span>
                <span className="fame-counts" title="Ticket xong · lượt chạy thành công · phiếu được duyệt · Xu mang về cho quỹ (mọi lúc)">
                  <span>🎫 {c?.tickets ?? 0}</span>
                  <span>▶ {c?.runs ?? 0}</span>
                  <span>✅ {c?.approvals ?? 0}</span>
                  <span className="fame-xu">🪙 {fmtXu(xuOf[r.agent.id] ?? 0)}</span>
                </span>
                <span className="fame-exp">{r.exp.toLocaleString('vi-VN')}<small>EXP</small></span>
              </div>
            )
          })}
        </div>

        <div className="fame-foot">
          Cách tính: ticket xong +{EXP.ticket.low}/+{EXP.ticket.medium}/+{EXP.ticket.high}/+{EXP.ticket.critical} (ưu tiên thấp/vừa/cao/khẩn) ·
          lượt chạy thành công +{EXP.run} · phiếu được duyệt +{EXP.approval} · lỗi 0 điểm. Cấp sau cần thêm 100 × cấp hiện tại.
          Xu: ticket xong {XU_TICKET.low}/{XU_TICKET.medium}/{XU_TICKET.high}/{XU_TICKET.critical} Xu, mỗi cấp của agent thêm 10%.
        </div>
      </div>
    </div>
  )
}
