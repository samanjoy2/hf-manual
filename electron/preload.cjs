const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hfDesk", Object.freeze({
  getCredentialStatus: () => ipcRenderer.invoke("credential:status"),
  saveCredential: (token) => ipcRenderer.invoke("credential:save", token),
  forgetCredential: () => ipcRenderer.invoke("credential:forget"),
  getOverview: (force = false) => ipcRenderer.invoke("hub:overview", Boolean(force)),
  updateRequests: (action) => ipcRenderer.invoke("hub:update-requests", action),
  getAuditLog: () => ipcRenderer.invoke("audit:list"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
}));
