import { useEffect, useState } from 'react'
import { useCoop } from '../store'
import { asLogRecord, demoEvents } from './demoLog'
import { isRunActive, paperclip, PaperclipError, type Run } from './paperclip'
import { LogParser, utf8Bytes, type TermLine } from './streamjson'

/** Log dài thì chỉ đọc phần đuôi */
const TAIL_BYTES = 1_000_000
const POLL_MS = 1000

export interface RunView {
  state: 'loading' | 'ready' | 'none' | 'error'
  run: Run | null
  lines: TermLine[]
  error?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const liveRunOf = (agentId: string) => useCoop.getState().agents.find((a) => a.id === agentId)?.runId

/**
 * Theo dõi log của agent: run đang chạy nếu có, không thì run gần nhất.
 * Đọc log theo offset (byte), chỉ nhận dòng NDJSON đã hoàn chỉnh; run còn chạy thì đọc tiếp mỗi giây.
 * Agent bắt đầu run mới trong lúc đang xem thì tự chuyển sang run mới.
 */
export function useRunLog(agentId: string): RunView {
  const [view, setView] = useState<RunView>({ state: 'loading', run: null, lines: [] })

  useEffect(() => {
    let stopped = false
    if (useCoop.getState().conn === 'demo') return playDemo(agentId, setView, () => stopped), () => { stopped = true }

    async function follow(run: Run) {
      let offset = 0
      let resync = false
      if (run.logBytes && run.logBytes > TAIL_BYTES) {
        offset = run.logBytes - TAIL_BYTES
        resync = true
      }
      const parser = new LogParser({ resync })
      if (resync) parser.meta(`… bỏ qua ${Math.round(offset / 1024)} KB log đầu, chỉ hiện phần cuối`)
      let active = isRunActive(run.status)
      let checkedAt = Date.now()
      setView({ state: 'ready', run, lines: [...parser.lines] })

      while (!stopped) {
        let page
        try {
          page = await paperclip.log(run.id, offset)
        } catch (e) {
          // Run vừa xếp hàng thì chưa có file log
          if (e instanceof PaperclipError && e.status === 404 && active) { await sleep(POLL_MS); continue }
          throw e
        }
        if (stopped) return
        let content = page.content
        let consumed = 0
        if (resync) {
          const nl = content.indexOf('\n')
          if (nl >= 0) {
            consumed += utf8Bytes(content.slice(0, nl + 1))
            content = content.slice(nl + 1)
            resync = false
          }
        }
        const end = content.lastIndexOf('\n')
        if (end >= 0) {
          const complete = content.slice(0, end + 1)
          consumed += utf8Bytes(complete)
          parser.feed(complete)
        } else if (page.nextOffset !== undefined && consumed === 0) {
          // Một dòng dài hơn cả trang đọc: bỏ qua để không kẹt
          consumed = page.nextOffset - offset
          parser.meta('… bỏ qua một đoạn log quá dài')
        }
        offset += consumed
        if (consumed) setView({ state: 'ready', run, lines: [...parser.lines] })
        if (page.nextOffset !== undefined && consumed) continue

        // Hết dữ liệu hiện có
        const live = liveRunOf(agentId)
        if (live && live !== run.id) return follow(await paperclip.run(live))
        if (active && live !== run.id && Date.now() - checkedAt > 4000) {
          // Có thể run vừa kết thúc: lấy trạng thái cuối, rồi đọc nốt log một lượt
          checkedAt = Date.now()
          run = await paperclip.run(run.id)
          active = isRunActive(run.status)
          setView({ state: 'ready', run, lines: [...parser.lines] })
          if (!active) continue
        }
        await sleep(active ? POLL_MS : POLL_MS * 2)
      }
    }

    ;(async () => {
      try {
        const live = liveRunOf(agentId)
        const run = live ? await paperclip.run(live) : await paperclip.latestRun(agentId)
        if (stopped) return
        if (!run) {
          setView({ state: 'none', run: null, lines: [] })
          // Chờ agent có run đầu tiên
          while (!stopped && !liveRunOf(agentId)) await sleep(POLL_MS * 2)
          if (stopped) return
          return follow(await paperclip.run(liveRunOf(agentId)!))
        }
        await follow(run)
      } catch (e) {
        if (!stopped) setView((v) => ({ ...v, state: 'error', error: e instanceof Error ? e.message : String(e) }))
      }
    })()

    return () => { stopped = true }
  }, [agentId])

  return view
}

/**
 * Bản demo: phát lại một lượt chạy giả khi agent "Đang làm". Agent dừng thì log dừng (run "đã huỷ"),
 * được đánh thức lại thì bắt đầu lượt mới.
 */
function playDemo(agentId: string, setView: (v: RunView) => void, isStopped: () => boolean) {
  const agent = () => useCoop.getState().agents.find((a) => a.id === agentId)
  const running = () => agent()?.status === 'running'
  let startedAt = new Date().toISOString()
  const show = (parser: LogParser, status: string) =>
    setView({
      state: 'ready',
      run: { id: `demo-${agentId}`, agentId, status, startedAt, finishedAt: status === 'running' ? null : new Date().toISOString(), logBytes: null, issueId: null, error: null },
      lines: [...parser.lines],
    })

  ;(async () => {
    const parser = new LogParser()
    const events = demoEvents(agent()?.task ?? 'việc được giao')
    if (!running()) {
      // Đang rảnh: hiện lượt chạy gần nhất (đã xong)
      for (const ev of events) parser.feed(asLogRecord(ev))
      show(parser, 'succeeded')
    }
    let i = 0
    while (!isStopped()) {
      if (!running()) {
        await sleep(400)
        continue
      }
      if (i === 0) {
        if (parser.lines.length) parser.meta('──── lượt chạy mới ────')
        startedAt = new Date().toISOString()
      }
      parser.feed(asLogRecord(events[i]))
      const last = i === events.length - 1
      i = last ? 0 : i + 1
      show(parser, 'running')
      await sleep(last ? 3000 : 700 + Math.random() * 900)
      if (!isStopped() && !running()) {
        parser.meta('Lượt chạy bị dừng')
        show(parser, 'cancelled')
        i = 0
      }
    }
  })()
}
