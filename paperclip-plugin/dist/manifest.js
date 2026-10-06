// src/manifest.ts
var DEFAULT_COOPVERSE_URL = "http://127.0.0.1:5179";
var manifest = {
  id: "coopverse.launcher",
  apiVersion: 1,
  version: "1.0.0",
  displayName: "Pixel Company",
  description: "N\xFAt m\u1EDF v\u0103n ph\xF2ng pixel Pixel Company cho c\xF4ng ty \u0111ang xem (thanh b\xEAn + thanh tr\xEAn c\xF9ng). / Opens the Pixel Company pixel office for the current company (sidebar + top bar).",
  author: "minhle2112",
  categories: ["ui"],
  capabilities: ["ui.sidebar.register", "ui.action.register"],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      coopverseUrl: {
        type: "string",
        title: "Pixel Company URL",
        description: "\u0110\u1ECBa ch\u1EC9 Pixel Company / Where Pixel Company runs (m\u1EB7c \u0111\u1ECBnh / default http://127.0.0.1:5179)",
        default: DEFAULT_COOPVERSE_URL
      }
    }
  },
  ui: {
    slots: [
      { type: "sidebar", id: "coopverse-sidebar", displayName: "Pixel Company", exportName: "PixelCompanySidebarLink" },
      { type: "globalToolbarButton", id: "coopverse-toolbar", displayName: "Pixel Company", exportName: "PixelCompanyToolbarButton" }
    ]
  }
};
var manifest_default = manifest;
export {
  DEFAULT_COOPVERSE_URL,
  manifest_default as default
};
