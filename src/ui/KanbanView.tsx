import { lookOf, useLooks } from '../characters/look'
import { COLUMNS, PRIORITY, ago, groupIssues } from '../data/kanban'
import { issueUrl } from '../data/paperclip'
import { ISSUE_STATUS_LABEL } from '../data/types'
import { useCoop } from '../store'

/** Bảng ticket phóng to khi bấm E trước bảng kanban: đủ thẻ, cuộn được, bấm thẻ để mở trong Paperclip. */
export function KanbanView() {
  const issues = useCoop((s) => s.issues)
  const agents = useCoop((s) => s.agents)
  const demo = useCoop((s) => s.conn === 'demo')
  const closeBoard = useCoop((s) => s.closeBoard)
  const custom = useLooks((s) => s.custom)
  const cols = groupIssues(issues)
  const byId = new Map(agents.map((a) => [a.id, a]))
  const leads = new Set(agents.map((a) => a.reportsTo).filter(Boolean))
  const prefix = issues[0]?.key.split('-')[0]

  return (
    <div className="term-wrap">
      <div className="board">
        <div className="term-bar">
          <span className="term-dots"><i /><i /><i /></span>
          <span className="term-title">
            Bảng ticket{prefix ? ` · ${prefix}` : ''} <span className="muted">· {issues.length} ticket{demo ? ' · demo' : ''}</span>
          </span>
          <button className="term-close" onClick={closeBoard} title="Quay lại văn phòng">
            <kbd>Esc</kbd> Đóng
          </button>
        </div>
        <div className="board-cols">
          {COLUMNS.map((c) => (
            <section key={c.id} className="board-col">
              <header style={{ background: c.color }}>
                <span>{c.label}</span>
                <span>{cols[c.id].length}</span>
              </header>
              <div className="board-cards">
                {cols[c.id].map((i) => {
                  const who = i.assigneeId ? byId.get(i.assigneeId) : undefined
                  const pr = PRIORITY[i.priority ?? '']
                  const when = i.status === 'done' ? i.completedAt ?? i.updatedAt : i.updatedAt
                  const style = pr ? { borderLeftColor: pr.color } : undefined
                  const body = (
                    <>
                      <div className="card-top">
                        <b>{i.key}</b>
                        {pr && <span className="card-pr" style={{ color: pr.color }}>● {pr.label}</span>}
                      </div>
                      <div className="card-title">{i.title}</div>
                      <div className="card-foot">
                        {who ? (
                          <span className="card-who">
                            <i style={{ background: lookOf(who.id, who.name, leads.has(who.id), custom).shirt }} />
                            {who.name}
                          </span>
                        ) : (
                          <span className="card-who muted">Chưa giao</span>
                        )}
                        <span className="muted" title={ISSUE_STATUS_LABEL[i.status] ?? i.status}>{ago(when)}</span>
                      </div>
                    </>
                  )
                  return demo ? (
                    <div key={i.id} className={`card${c.id === 'done' ? ' done' : ''}`} style={style}>{body}</div>
                  ) : (
                    <a key={i.id} className={`card${c.id === 'done' ? ' done' : ''}`} style={style} href={issueUrl(i.key)} target="_blank" rel="noreferrer" title={`Mở ${i.key} trong Paperclip`}>
                      {body}
                    </a>
                  )
                })}
                {!cols[c.id].length && <div className="board-empty">Trống</div>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
