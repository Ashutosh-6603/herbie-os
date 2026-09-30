import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("herbie", {
  shrink: () => ipcRenderer.send("herbie:shrink"),
  getOrbTarget: () => ipcRenderer.invoke("herbie:get-orb-target"),
  openBar: () => ipcRenderer.send("herbie:open-bar"),
  closeBar: () => ipcRenderer.send("herbie:close-bar"),
  quit: () => ipcRenderer.send("herbie:quit"),
});
