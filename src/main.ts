import { app, BrowserWindow, screen } from "electron";
import * as path from "node:path";

function createWindow(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setFullScreen(true);

  win.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "Escape") {
      app.quit();
    }
  });

  win.loadFile(path.join(__dirname, "../src/renderer/index.html"));
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
