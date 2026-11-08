const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  tabCreate: (opts) => ipcRenderer.invoke('tab-create', opts),
  tabActivate: (tabId) => ipcRenderer.invoke('tab-activate', tabId),
  tabClose: (tabId) => ipcRenderer.invoke('tab-close', tabId),
  tabNavigate: (tabId, url) => ipcRenderer.invoke('tab-navigate', { tabId, url }),
  tabAction: (tabId, action) => ipcRenderer.invoke('tab-action', { tabId, action }),
  tornChatSend: (payload) => ipcRenderer.invoke('torn-chat-send', payload),
  setTornCookies: (payload) => ipcRenderer.invoke('set-torn-cookies', payload),
  setViewVisibility: (visible) => ipcRenderer.invoke('set-view-visibility', visible),
  tornToolsInfo: () => ipcRenderer.invoke('torntools-info'),
  externalLogin: () => ipcRenderer.invoke('external-login'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateApply: () => ipcRenderer.invoke('update-apply'),
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (_event, data) => callback(data));
  },
  onUpdatePending: (callback) => {
    ipcRenderer.on('update-pending', (_event, data) => callback(data));
  },
  onLoginStatus: (callback) => {
    ipcRenderer.on('login-status', (_event, data) => callback(data));
  },
  onTornToolsStatus: (callback) => {
    ipcRenderer.on('torntools-status', (_event, data) => callback(data));
  },
  onOpenTab: (callback) => {
    ipcRenderer.on('open-tab', (_event, url) => callback(url));
  },
  onTabUpdated: (callback) => {
    ipcRenderer.on('tab-updated', (_event, data) => callback(data));
  },
  onTornData: (callback) => {
    ipcRenderer.on('torn-data', (_event, data) => callback(data));
  },
});
