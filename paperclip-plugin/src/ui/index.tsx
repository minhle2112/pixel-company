import { useHostContext, usePluginData } from '@paperclipai/plugin-sdk/ui'

const DEFAULT_URL = 'http://127.0.0.1:5179'
/** Bấm nhiều lần vẫn dùng chung một tab Pixel Company. */
const TAB_NAME = 'coopverse'
const TITLE = 'Mở văn phòng pixel Pixel Company của công ty này · Open the Pixel Company pixel office'

/** Link Pixel Company cho công ty đang xem: ?company=<id> để Pixel Company mở đúng công ty. */
function usePixelCompanyHref(): string {
  const { companyId } = useHostContext()
  const { data } = usePluginData<{ coopverseUrl: string }>('settings', companyId ? { companyId } : {})
  const base = data?.coopverseUrl ?? DEFAULT_URL
  return companyId ? `${base}/?company=${encodeURIComponent(companyId)}` : `${base}/`
}

/** Biểu tượng toà nhà (lucide "building-2"), cùng cỡ icon của Paperclip. */
function OfficeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  )
}

/** Mục "Pixel Company" ở thanh bên trái, cùng kiểu với Dashboard / Issues. */
export function PixelCompanySidebarLink() {
  const href = usePixelCompanyHref()
  return (
    <a
      href={href}
      target={TAB_NAME}
      rel="noopener"
      title={TITLE}
      data-coopverse="sidebar"
      className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 text-(length:--text-compact) font-medium transition-colors text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <span className="relative shrink-0"><OfficeIcon /></span>
      <span className="flex-1 truncate">Pixel Company</span>
      <span className="text-xs text-muted-foreground" aria-hidden="true">↗</span>
    </a>
  )
}

/** Nút "Pixel Company" ở thanh trên cùng, có trên mọi trang. */
export function PixelCompanyToolbarButton() {
  const href = usePixelCompanyHref()
  return (
    <a
      href={href}
      target={TAB_NAME}
      rel="noopener"
      title={TITLE}
      data-coopverse="toolbar"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <OfficeIcon size={14} />
      Pixel Company
    </a>
  )
}
