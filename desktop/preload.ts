import { contextBridge, ipcRenderer } from 'electron'

/**
 * Cầu nối giữa trang (bản build của Pixel Company + màn hình kết nối) và app desktop. Trang không có Node:
 * chỉ gọi được đúng những hàm dưới đây (kiểu khai báo ở src/desktop.ts).
 */

const info = ipcRenderer.sendSync('desktop:info') as { version: string; paperclipUrl: string }

contextBridge.exposeInMainWorld('coopDesktop', {
  version: info.version,
  paperclipUrl: info.paperclipUrl,
  getSetup: () => ipcRenderer.invoke('setup:get'),
  saveSetup: (patch: unknown) => ipcRenderer.invoke('setup:save', patch),
  pickFolder: (title: string) => ipcRenderer.invoke('pick-folder', title),
  connect: () => ipcRenderer.invoke('pc:connect'),
  install: () => ipcRenderer.invoke('pc:install'),
  openApp: (demo: boolean) => ipcRenderer.invoke('open-app', demo),
  openSetup: () => ipcRenderer.invoke('open-setup'),
  pickAssets: () => ipcRenderer.invoke('pick-assets'),
  importExp: () => ipcRenderer.invoke('import-exp'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openLog: () => ipcRenderer.invoke('open-log'),
  onState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('pc:state', h)
    return () => { ipcRenderer.off('pc:state', h) }
  },
})
