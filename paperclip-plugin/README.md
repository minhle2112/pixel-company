# Pixel Company launcher (Paperclip plugin)

Thêm nút mở [Pixel Company](../README.md) vào Paperclip / Adds a Pixel Company button to Paperclip:

- mục **Pixel Company ↗** ở thanh bên trái / a **Pixel Company ↗** sidebar item
- nút **Pixel Company** ở thanh trên cùng mọi trang / a **Pixel Company** top-bar button on every page

Bấm vào là mở `<Pixel Company URL>/?company=<công ty đang xem>`. / Opens Pixel Company for the company you are viewing.

## Cài / Install

`dist/` đã build sẵn. / `dist/` is prebuilt.

```bash
paperclipai plugin install --local /path/to/coopverse/paperclip-plugin
```

Đổi địa chỉ Pixel Company (mặc định `http://127.0.0.1:5179`) / Change the Pixel Company URL: **Settings → Plugins → Pixel Company → Configure**.

Gỡ / Uninstall: `paperclipai plugin uninstall coopverse.launcher`

## Sửa và build / Develop

```bash
npm install
npm run build      # esbuild → dist/manifest.js, dist/worker.js, dist/ui/index.js
npm run typecheck
```

- `src/manifest.ts`: id `coopverse.launcher`, slot `sidebar` + `globalToolbarButton`, cấu hình `coopverseUrl`.
- `src/worker.ts`: trả địa chỉ Pixel Company đã cấu hình cho UI (`settings`).
- `src/ui/index.tsx`: hai nút. React và SDK UI do Paperclip cung cấp lúc chạy.

Đã thử với Paperclip 2026.916.1 / Tested with Paperclip 2026.916.1.
