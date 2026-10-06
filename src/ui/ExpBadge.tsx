import { levelProgress, titleOf, useExp } from '../data/exp'

/** Cấp, danh hiệu, EXP của agent trên thanh tiêu đề CLI */
export function ExpBadge({ agentId }: { agentId: string }) {
  const s = useExp((x) => x.stats[agentId])
  const total = s?.total ?? 0
  const lv = s?.level ?? 1
  const [have, need] = levelProgress(total)
  return (
    <span className="exp-badge" title={`${total.toLocaleString('vi-VN')} EXP · còn ${need - have} EXP nữa lên cấp ${lv + 1}`}>
      <span className="lv-chip">Lv {lv}</span>
      <span className="exp-title">{titleOf(lv)}</span>
      <span className="exp-mini"><i style={{ width: `${Math.round((100 * have) / need)}%` }} /></span>
    </span>
  )
}
