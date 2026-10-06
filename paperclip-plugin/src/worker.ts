import { definePlugin, runWorker } from '@paperclipai/plugin-sdk'
import { DEFAULT_COOPVERSE_URL } from './manifest'

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)

/** Địa chỉ Pixel Company đã cấu hình, bỏ "/" ở cuối. Trống hoặc sai định dạng thì dùng mặc định. */
function coopverseUrl(config: Record<string, unknown>): string {
  const raw = typeof config.coopverseUrl === 'string' ? config.coopverseUrl.trim() : ''
  return isUrl(raw) ? raw.replace(/\/+$/, '') : DEFAULT_COOPVERSE_URL
}

const plugin = definePlugin({
  async setup(ctx) {
    // Phần giao diện hỏi địa chỉ Pixel Company qua đây (UI không đọc thẳng cấu hình plugin được).
    ctx.data.register('settings', async (params) => {
      const companyId = typeof params.companyId === 'string' ? params.companyId : undefined
      const config = await ctx.config.get(companyId).catch(() => ({}))
      return { coopverseUrl: coopverseUrl(config) }
    })
  },

  async onValidateConfig(config) {
    const raw = config.coopverseUrl
    if (raw === undefined || raw === '') return { ok: true }
    if (typeof raw !== 'string' || !isUrl(raw.trim())) {
      return { ok: false, errors: ['coopverseUrl phải là địa chỉ http(s)://… / must be an http(s):// URL'] }
    }
    return { ok: true }
  },

  async onHealth() {
    return { status: 'ok' }
  },
})

export default plugin
runWorker(plugin, import.meta.url)
