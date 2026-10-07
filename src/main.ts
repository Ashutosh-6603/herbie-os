import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";

const ORB_SIZE = 140;
const ORB_MARGIN = 24;
const BAR_WIDTH = 420;
const BAR_HEIGHT = 56;
const BAR_GAP = 12;
const REPLY_GAP = 12; // NEW: space between the bar and the reply panel
const MAX_REPLY_HEIGHT = 240; // NEW: must match .reply max-height in styles.css

const OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_MODEL = "llama3.2";
const OLLAMA_KEEP_ALIVE = "30m";
const MAX_PROMPT_LENGTH = 2000;
const SYSTEM_PROMPT =
  "You are Herbie, a helpful desktop assistant. Keep answers short, " +
  "one to three sentences, because they are spoken aloud.";

function getOrbBounds() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - ORB_SIZE - ORB_MARGIN,
    y: y + height - ORB_SIZE - ORB_MARGIN,
    width: ORB_SIZE,
    height: ORB_SIZE,
  };
}

// CHANGED: takes the reply panel's height and grows the window to fit it
function getBarBounds(replyHeight: number) {
  const orb = getOrbBounds();
  const height =
    ORB_SIZE +
    BAR_GAP +
    BAR_HEIGHT +
    (replyHeight > 0 ? REPLY_GAP + replyHeight : 0);
  return {
    x: orb.x + ORB_SIZE - BAR_WIDTH,
    y: orb.y + ORB_SIZE - height,
    width: BAR_WIDTH,
    height,
  };
}

async function isOllamaUp(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function warmUpOllama(): Promise<void> {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [],
        keep_alive: OLLAMA_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    console.log("Ollama warm-up complete");
  } catch (err) {
    console.error("Ollama warm-up failed:", err);
  }
}

async function askOllama(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as { message: { content: string } };
  return data.message.content;
}

function setAutostart(enabled: boolean): void {
  const settings = app.isPackaged
    ? { openAtLogin: enabled }
    : {
        openAtLogin: enabled,
        path: process.execPath,
        args: [app.getAppPath()],
      };

  app.setLoginItemSettings(settings);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...getOrbBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
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

  win.loadFile(path.join(__dirname, "../src/renderer/index.html"));

  return win;
}

app.whenReady().then(() => {
  if (process.argv.includes("--no-autostart")) {
    setAutostart(false);
    app.quit();
    return;
  }

  setAutostart(true);

  const win = createWindow();

  warmUpOllama();

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

  ipcMain.on("herbie:open-bar", () => {
    win.setBounds(getBarBounds(0)); // CHANGED: opens with no reply panel
    win.focus();
  });

  ipcMain.on("herbie:close-bar", () => {
    win.setBounds(getOrbBounds());
  });

  // NEW: grow or shrink the window to fit the reply panel
  ipcMain.on("herbie:set-reply-height", (_event, height: unknown) => {
    if (typeof height !== "number" || !Number.isFinite(height)) return;

    const safeHeight = Math.min(
      Math.max(Math.round(height), 0),
      MAX_REPLY_HEIGHT,
    );
    win.setBounds(getBarBounds(safeHeight));
  });

  ipcMain.on("herbie:quit", () => {
    app.quit();
  });

  ipcMain.handle("herbie:ask", async (_event, prompt: unknown) => {
    if (
      typeof prompt !== "string" ||
      prompt.trim() === "" ||
      prompt.length > MAX_PROMPT_LENGTH
    ) {
      throw new Error("Invalid prompt");
    }

    if (!(await isOllamaUp())) {
      throw new Error("OLLAMA_DOWN");
    }

    console.log(`You: ${prompt}`);
    const reply = await askOllama(prompt.trim());
    console.log(`Herbie: ${reply}`);
    return reply;
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
