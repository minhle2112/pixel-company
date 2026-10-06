import type { ServerResponse } from 'node:http'
import { ACTION_TOOLS } from './actions'
import { READ_TOOLS, type ToolCtx } from './tools'

const TOOLS = [...READ_TOOLS, ...ACTION_TOOLS]

/**
 * MCP server "coopverse" kiểu Streamable HTTP, rút gọn: chỉ POST, trả JSON (không mở luồng SSE).
 * Đủ cho initialize / tools/list / tools/call / ping. Claude Code (và các CLI khác có MCP) gọi vào
 * `/coop/assistant/mcp` với khoá Bearer riêng của từng lượt chạy.
 */

interface Rpc { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, any> }

const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(m: Rpc, ctx: ToolCtx): Promise<object | null> {
  // Thông báo (không có id): không trả lời
  if (m.id === undefined || m.id === null) return null
  switch (m.method) {
    case 'initialize':
      return ok(m.id, {
        protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'coopverse', version: '1.0.0' },
      })
    case 'ping':
      return ok(m.id, {})
    case 'tools/list':
      return ok(m.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name)
      if (!tool) return fail(m.id, -32602, `Không có công cụ ${String(m.params?.name)}`)
      const args = m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}
      try {
        const text = await tool.run(ctx, args)
        return ok(m.id, { content: [{ type: 'text', text }] })
      } catch (e) {
        return ok(m.id, { content: [{ type: 'text', text: `Lỗi: ${e instanceof Error ? e.message : String(e)}` }], isError: true })
      }
    }
    default:
      return fail(m.id, -32601, `Không hỗ trợ ${String(m.method)}`)
  }
}

export async function mcpHandler(res: ServerResponse, body: unknown, ctx: ToolCtx) {
  const msgs = Array.isArray(body) ? (body as Rpc[]) : [body as Rpc]
  const out = (await Promise.all(msgs.map((m) => handle(m ?? {}, ctx)))).filter((x): x is object => !!x)
  if (!out.length) {
    res.statusCode = 202
    return res.end()
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(Array.isArray(body) ? out : out[0]))
}
