const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程唯一可见的桥面：平台信息；扫描游戏目录与按需解码缩略图。
contextBridge.exposeInMainWorld('shell', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  pickDirectory: () => ipcRenderer.invoke('res:pick'),
  scanResources: (dir) => ipcRenderer.invoke('res:scan', dir),
  loadThumb: (req) => ipcRenderer.invoke('res:thumb', req),
  loadSheet: (req) => ipcRenderer.invoke('res:sheet', req),
  loadAudio: (req) => ipcRenderer.invoke('res:audio', req),
  pickProjectToOpen: () => ipcRenderer.invoke('project:pickOpen'),
  pickProjectToSave: (name) => ipcRenderer.invoke('project:pickSave', name),
  readProject: (file) => ipcRenderer.invoke('project:read', file),
  writeProject: (req) => ipcRenderer.invoke('project:write', req),
  pickMapping: () => ipcRenderer.invoke('mapping:pick'),
  readMapping: (file) => ipcRenderer.invoke('mapping:read', file),
  pickDsl: () => ipcRenderer.invoke('dsl:pick'),
  pickDslToSave: (name) => ipcRenderer.invoke('dsl:pickSave', name),
  readDsl: (file) => ipcRenderer.invoke('dsl:read', file),
  writeDsl: (req) => ipcRenderer.invoke('dsl:write', req),
});
