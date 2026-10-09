import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";
import { uIOhook, UiohookKey } from "uiohook-napi";

const ORB_SIZE = 140;
const ORB_MARGIN = 24;
const BAR_WIDTH = 420;
const BAR_HEIGHT = 56;
const BAR_GAP = 12;
const REPLY_GAP = 12;
const MAX_REPLY_HEIGHT = 240;

const OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_MODEL = "llama3.2";
const OLLAMA_KEEP_ALIVE = "30m";
const OLLAMA_CONTEXT = 16384;
const MAX_PROMPT_LENGTH = 2000;
const USER_NAME = "Ashutosh";
const MAX_HISTORY_MESSAGES = 60;
const PUSH_TO_TALK_KEY = UiohookKey.CtrlRight;

const SYSTEM_PROMPT =
  `You are Herbie, a helpful desktop assistant for ${USER_NAME}. ` +
  "Keep answers short, one to three sentences, because they are spoken aloud. " +
  "Don't end your answers with follow-up questions unless you need more information.";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const history: ChatMessage[] = [];

function getOrbBounds() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - ORB_SIZE - ORB_MARGIN,
    y: y + height - ORB_SIZE - ORB_MARGIN,
    width: ORB_SIZE,
    height: ORB_SIZE,
  };
}

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

async function warmUpOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [],
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: { num_ctx: OLLAMA_CONTEXT },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      console.error(`Ollama warm-up failed: HTTP ${response.status}`);
      return false;
    }

    console.log("Ollama warm-up complete");
    return true;
  } catch (err) {
    console.error("Ollama warm-up failed:", err);
    return false;
  }
}

async function askOllama(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { num_ctx: OLLAMA_CONTEXT },
      messages,
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

  const brainReady = warmUpOllama();

  ipcMain.handle("herbie:wait-for-brain", () => brainReady);

  ipcMain.handle("herbie:get-user-name", () => USER_NAME);

  let pushToTalkHeld = false;

  uIOhook.on("keydown", (e) => {
    if (e.keycode !== PUSH_TO_TALK_KEY || pushToTalkHeld) return;
    pushToTalkHeld = true;
    win.webContents.send("herbie:push-to-talk", "down");
  });

  uIOhook.on("keyup", (e) => {
    if (e.keycode !== PUSH_TO_TALK_KEY || !pushToTalkHeld) return;
    pushToTalkHeld = false;
    win.webContents.send("herbie:push-to-talk", "up");
  });

  uIOhook.start();

  app.on("will-quit", () => {
    uIOhook.stop();
  });

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
    win.setBounds(getBarBounds(0));
    win.focus();
  });

  ipcMain.on("herbie:close-bar", () => {
    win.setBounds(getOrbBounds());
  });

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

    const question: ChatMessage = { role: "user", content: prompt.trim() };
    const reply = await askOllama([
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      question,
    ]);

    history.push(question, { role: "assistant", content: reply });
    if (history.length > MAX_HISTORY_MESSAGES) {
      history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    }

    console.log(`You: ${question.content}`);
    console.log(`Herbie: ${reply}`);
    return reply;
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
