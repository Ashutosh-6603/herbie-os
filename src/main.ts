import { app, BrowserWindow } from "electron";
import * as path from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
  });

  win.loadFile(path.join(__dirname, "../src/renderer/index.html"));
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
