import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("herbie", {
  shrink: () => ipcRenderer.send("herbie:shrink"),
  getOrbTarget: () => ipcRenderer.invoke("herbie:get-orb-target"),
});
