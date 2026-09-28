import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";

const ORB_SIZE = 140;
const ORB_MARGIN = 24;

function getOrbBounds() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - ORB_SIZE - ORB_MARGIN,
    y: y + height - ORB_SIZE - ORB_MARGIN,
    width: ORB_SIZE,
    height: ORB_SIZE,
  };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...getOrbBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      autoplayPolicy: "no-user-gesture-required",
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.once("ready-to-show", () => {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setFullScreen(true);
    win.show();
  });

  win.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "Escape") {
      app.quit();
    }
  });

  win.loadFile(path.join(__dirname, "../src/renderer/index.html"));

  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  ipcMain.on("herbie:shrink", () => {
    win.setAlwaysOnTop(true, "floating");
    win.setFullScreen(false);
  });

  ipcMain.handle("herbie:get-orb-target", () => {
    const orb = getOrbBounds();
    const current = win.getBounds();
    return {
      x: orb.x - current.x + ORB_SIZE / 2,
      y: orb.y - current.y + ORB_SIZE / 2,
    };
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
