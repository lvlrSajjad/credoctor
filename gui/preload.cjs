// The entire surface the renderer gets. No Node, no fs, no child_process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("credoctor", {
  doctor: (opts) => ipcRenderer.invoke("credoctor:doctor", opts),
  openExternal: (url) => ipcRenderer.invoke("credoctor:openExternal", url),
});
