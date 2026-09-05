// The entire surface the renderer gets. No Node, no fs, no child_process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("credkit", {
  doctor: (opts) => ipcRenderer.invoke("credkit:doctor", opts),
  openExternal: (url) => ipcRenderer.invoke("credkit:openExternal", url),
});
