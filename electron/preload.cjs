const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("hfDesk", Object.freeze({
  getCredentialStatus: () => ipcRenderer.invoke("credential:status"),
  saveCredential: (token) => ipcRenderer.invoke("credential:save", token),
  forgetCredential: () => ipcRenderer.invoke("credential:forget"),
  getOverview: (force = false) => ipcRenderer.invoke("hub:overview", Boolean(force)),
  updateRequests: (action) => ipcRenderer.invoke("hub:update-requests", action),
  getAuditLog: () => ipcRenderer.invoke("audit:list"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getUpdateStatus: () => ipcRenderer.invoke("updates:status"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onOverview: (callback) => subscribe("monitor:overview", callback),
  onRefreshError: (callback) => subscribe("monitor:error", callback),
  onOpenPending: (callback) => subscribe("monitor:open-pending", callback),
  onUpdateStatus: (callback) => subscribe("updates:changed", callback),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
}));
