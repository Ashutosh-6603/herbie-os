import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("herbie", {
  shrink: () => ipcRenderer.send("herbie:shrink"),
  getOrbTarget: () => ipcRenderer.invoke("herbie:get-orb-target"),
  openBar: () => ipcRenderer.send("herbie:open-bar"),
  closeBar: () => ipcRenderer.send("herbie:close-bar"),
  setReplyHeight: (height: number) =>
    ipcRenderer.send("herbie:set-reply-height", height),
  quit: () => ipcRenderer.send("herbie:quit"),
  ask: (prompt: string) => ipcRenderer.invoke("herbie:ask", prompt),
  waitForBrain: () => ipcRenderer.invoke("herbie:wait-for-brain"), // NEW
});
