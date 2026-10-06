// src/ui/index.tsx
import { useHostContext, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { jsx, jsxs } from "react/jsx-runtime";
var DEFAULT_URL = "http://127.0.0.1:5179";
var TAB_NAME = "coopverse";
var TITLE = "M\u1EDF v\u0103n ph\xF2ng pixel Pixel Company c\u1EE7a c\xF4ng ty n\xE0y \xB7 Open the Pixel Company pixel office";
function usePixelCompanyHref() {
  const { companyId } = useHostContext();
  const { data } = usePluginData("settings", companyId ? { companyId } : {});
  const base = data?.coopverseUrl ?? DEFAULT_URL;
  return companyId ? `${base}/?company=${encodeURIComponent(companyId)}` : `${base}/`;
}
function OfficeIcon({ size = 16 }) {
  return /* @__PURE__ */ jsxs("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx("path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" }),
    /* @__PURE__ */ jsx("path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" }),
    /* @__PURE__ */ jsx("path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" }),
    /* @__PURE__ */ jsx("path", { d: "M10 6h4" }),
    /* @__PURE__ */ jsx("path", { d: "M10 10h4" }),
    /* @__PURE__ */ jsx("path", { d: "M10 14h4" }),
    /* @__PURE__ */ jsx("path", { d: "M10 18h4" })
  ] });
}
function PixelCompanySidebarLink() {
  const href = usePixelCompanyHref();
  return /* @__PURE__ */ jsxs(
    "a",
    {
      href,
      target: TAB_NAME,
      rel: "noopener",
      title: TITLE,
      "data-coopverse": "sidebar",
      className: "flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 text-(length:--text-compact) font-medium transition-colors text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      children: [
        /* @__PURE__ */ jsx("span", { className: "relative shrink-0", children: /* @__PURE__ */ jsx(OfficeIcon, {}) }),
        /* @__PURE__ */ jsx("span", { className: "flex-1 truncate", children: "Pixel Company" }),
        /* @__PURE__ */ jsx("span", { className: "text-xs text-muted-foreground", "aria-hidden": "true", children: "\u2197" })
      ]
    }
  );
}
function PixelCompanyToolbarButton() {
  const href = usePixelCompanyHref();
  return /* @__PURE__ */ jsxs(
    "a",
    {
      href,
      target: TAB_NAME,
      rel: "noopener",
      title: TITLE,
      "data-coopverse": "toolbar",
      className: "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground",
      children: [
        /* @__PURE__ */ jsx(OfficeIcon, { size: 14 }),
        "Pixel Company"
      ]
    }
  );
}
export {
  PixelCompanySidebarLink,
  PixelCompanyToolbarButton
};
