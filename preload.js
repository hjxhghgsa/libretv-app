/**
 * 预加载脚本：向渲染进程暴露少量必要能力
 * contextIsolation 保持开启，不把 Node API 直接挂到 window 上。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('libretv', {
  version: () => ipcRenderer.invoke('app:version'),
  /** 是否运行在桌面应用里（页面据此渲染桌面专属 UI，如自绘顶栏） */
  isDesktop: true,
  /** 窗口控制：min / max / close */
  windowAction: (action) => ipcRenderer.send('window:action', action),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  /** 订阅最大化状态变化（用于切换「最大化/还原」图标） */
  onMaximizeChange: (cb) => {
    const handler = (_e, isMax) => cb(isMax);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },
});
