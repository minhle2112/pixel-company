import { useEffect, useMemo, useRef } from 'react'
import { startExpSync } from './data/expSync'
import { startOfficeSync, useOffice } from './data/officeSync'
import { startSync } from './data/sync'
import type { AgentStatus } from './data/types'
import { officeSpots, setSpots } from './life/spots'
import { PixelAgents } from './pixel/Agents'
import { PixelScene } from './pixel/Scene'
import { useControls } from './player/useControls'
import { useCoop } from './store'
import { Hud } from './ui/Hud'
import { buildWorld, layoutKey } from './world/layout'
import { navRef } from './world/nav'

export default function App() {
  const stage = useRef<HTMLDivElement>(null)
  useControls(stage)
  useEffect(() => startSync(), [])
  useEffect(() => startExpSync(), [])
  useEffect(() => startOfficeSync(), [])

  const agents = useCoop((s) => s.agents)
  // Bố cục chỉ dựng lại khi sơ đồ tổ chức đổi, không phải khi trạng thái đổi
  const orgKey = agents.map((a) => `${a.id}>${a.reportsTo}${a.candidate ? '?' : ''}`).join('|')
  // ...và khi bạn đặt / dời đồ, dời bàn (không phải khi Xu đổi)
  const office = useOffice((s) => s.office)
  const decoKey = layoutKey(office)
  const world = useMemo(() => {
    const w = buildWorld(useCoop.getState().agents, useOffice.getState().office)
    // Agent tìm đường trên bố cục mới ngay từ khung hình sau
    navRef.current = w.nav
    return w
  }, [orgKey, decoKey])

  // Chỗ agent rảnh đi tới: đổi khi bố cục đổi hoặc vừa dọn xong một mảng sàn (hết chỗ bụi để than)
  useEffect(() => setSpots(officeSpots(world, office)), [world, office])

  const statusOfSlot = useMemo(() => {
    const m = new Map<string, AgentStatus>()
    for (const a of agents) {
      const s = world.seatOf.get(a.id)
      if (s) m.set(s.id, a.status)
    }
    return m
  }, [agents, world])

  return (
    <>
      <div ref={stage} className="stage-wrap">
        <PixelScene world={world} statusOfSlot={statusOfSlot}>
          <PixelAgents world={world} />
        </PixelScene>
      </div>
      <Hud world={world} />
    </>
  )
}
