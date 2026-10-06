import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk'

/** Mặc định Pixel Company chạy cùng máy với trình duyệt. / Default: Pixel Company on the same machine. */
export const DEFAULT_COOPVERSE_URL = 'http://127.0.0.1:5179'

const manifest: PaperclipPluginManifestV1 = {
  id: 'coopverse.launcher',
  apiVersion: 1,
  version: '1.0.0',
  displayName: 'Pixel Company',
  description:
    'Nút mở văn phòng pixel Pixel Company cho công ty đang xem (thanh bên + thanh trên cùng). / Opens the Pixel Company pixel office for the current company (sidebar + top bar).',
  author: 'minhle2112',
  categories: ['ui'],
  capabilities: ['ui.sidebar.register', 'ui.action.register'],
  entrypoints: { worker: './dist/worker.js', ui: './dist/ui' },
  instanceConfigSchema: {
    type: 'object',
    properties: {
      coopverseUrl: {
        type: 'string',
        title: 'Pixel Company URL',
        description: 'Địa chỉ Pixel Company / Where Pixel Company runs (mặc định / default http://127.0.0.1:5179)',
        default: DEFAULT_COOPVERSE_URL,
      },
    },
  },
  ui: {
    slots: [
      { type: 'sidebar', id: 'coopverse-sidebar', displayName: 'Pixel Company', exportName: 'PixelCompanySidebarLink' },
      { type: 'globalToolbarButton', id: 'coopverse-toolbar', displayName: 'Pixel Company', exportName: 'PixelCompanyToolbarButton' },
    ],
  },
}

export default manifest
