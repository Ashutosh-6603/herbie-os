import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  session,
} from "electron";
import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { uIOhook, UiohookKey } from "uiohook-napi";
import {
  matchMediaCommand,
  performMediaAction,
  MEDIA_REPLIES,
} from "./media.js";
import { askClaude, needsClaude, stripTrigger } from "./claude.js";

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
const SYSTEM_PROMPT =
  `You are Herbie, a helpful desktop assistant for ${USER_NAME}. ` +
  "Keep answers short, one to three sentences, because they are spoken aloud. " +
  "Don't end your answers with follow-up questions unless you need more information.";

const PUSH_TO_TALK_KEY = UiohookKey.CtrlRight;
const SLEEP_SHORTCUT = "CommandOrControl+Alt+H";

const STT_MODEL = "Xenova/whisper-base.en";
const MAX_RECORDING_SAMPLES = 16000 * 30;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type Transcriber = ((
  audio: Float32Array,
) => Promise<{ text: string } | { text: string }[]>) & {
  dispose?: () => Promise<void>;
};

const history: ChatMessage[] = [];

function rememberExchange(question: string, answer: string): void {
  history.push(
    { role: "user", content: question },
    { role: "assistant", content: answer },
  );
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }
}

function recentContext(): string {
  return history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Herbie"}: ${m.content}`)
    .join("\n");
}

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

async function unloadOllama(): Promise<void> {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [],
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    console.log("Ollama model unloaded");
  } catch (err) {
    console.error("Ollama unload failed:", err);
  }
}

async function loadTranscriber(): Promise<Transcriber | null> {
  try {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = path.join(app.getPath("userData"), "models");

    const transcriber = await pipeline(
      "automatic-speech-recognition",
      STT_MODEL,
    );
    console.log("Speech-to-text ready");
    return transcriber as unknown as Transcriber;
  } catch (err) {
    console.error("Speech-to-text failed to load:", err);
    return null;
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

  // win.loadFile(path.join(__dirname, "../src/renderer/index.html"));
  win.loadFile(path.join(__dirname, "renderer/index.html"));

  return win;
}

app.whenReady().then(() => {
  if (process.argv.includes("--no-autostart")) {
    setAutostart(false);
    app.quit();
    return;
  }

  setAutostart(true);

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const mediaTypes =
        "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      const audioOnly =
        permission === "media" &&
        mediaTypes.length > 0 &&
        mediaTypes.every((type) => type === "audio");

      callback(audioOnly);
    },
  );

  const win = createWindow();

  let brainReady = warmUpOllama();
  let transcriberReady = loadTranscriber();
  let asleep = false;

  const claudeWorkspace = path.join(
    app.getPath("userData"),
    "claude-workspace",
  );
  mkdirSync(claudeWorkspace, { recursive: true });

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

  ipcMain.on("herbie:quit", async () => {
    await unloadOllama();
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

    const question = prompt.trim();

    const mediaAction = matchMediaCommand(question);
    if (mediaAction) {
      console.log(`Command: ${mediaAction}`);
      await performMediaAction(mediaAction);
      return { text: MEDIA_REPLIES[mediaAction], silent: true };
    }

    if (needsClaude(question)) {
      win.webContents.send("herbie:status", "searching");

      const context = recentContext();
      const cleaned = stripTrigger(question);
      const input = context
        ? `Conversation so far:\n${context}\n\nNew question: ${cleaned}`
        : cleaned;

      console.log(`You (web): ${question}`);
      const answer = await askClaude(input, claudeWorkspace);
      console.log(`Claude: ${answer.speech}`);

      rememberExchange(question, answer.speech);
      return { text: answer.display, speech: answer.speech, silent: false };
    }

    if (!(await isOllamaUp())) {
      throw new Error("OLLAMA_DOWN");
    }

    const reply = await askOllama([
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: question },
    ]);

    rememberExchange(question, reply);

    console.log(`You: ${question}`);
    console.log(`Herbie: ${reply}`);
    return { text: reply, silent: false };
  });

  ipcMain.handle("herbie:wait-for-brain", () => brainReady);

  ipcMain.handle("herbie:get-user-name", () => USER_NAME);

  ipcMain.handle("herbie:transcribe", async (_event, samples: unknown) => {
    if (
      !(samples instanceof Float32Array) ||
      samples.length === 0 ||
      samples.length > MAX_RECORDING_SAMPLES
    ) {
      throw new Error("Invalid audio");
    }

    const transcriber = await transcriberReady;
    if (!transcriber) {
      throw new Error("STT_DOWN");
    }

    const result = await transcriber(samples);
    const raw = Array.isArray(result) ? result[0]?.text : result.text;
    let text = (raw ?? "").trim();

    if (/^[\[(].*[\])]$/.test(text)) {
      text = "";
    }

    console.log(`Heard: ${text}`);
    return text;
  });

  let pushToTalkHeld = false;

  uIOhook.on("keydown", (e) => {
    if (asleep) return;
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

  async function goToSleep(): Promise<void> {
    asleep = true;
    pushToTalkHeld = false;
    win.webContents.send("herbie:status", "sleeping");
    win.hide();

    const transcriber = await transcriberReady;
    transcriberReady = Promise.resolve(null);
    await transcriber?.dispose?.();

    await unloadOllama();
    console.log("Herbie is asleep");
  }

  function wakeUp(): void {
    asleep = false;
    brainReady = warmUpOllama();
    transcriberReady = loadTranscriber();
    win.showInactive();
    win.webContents.send("herbie:status", "waking");
    console.log("Herbie is awake");
  }

  const registered = globalShortcut.register(SLEEP_SHORTCUT, () => {
    if (asleep) {
      wakeUp();
    } else {
      goToSleep();
    }
  });

  if (!registered) {
    console.error(
      `Could not register ${SLEEP_SHORTCUT}; another app may be using it`,
    );
  }

  app.on("will-quit", () => {
    uIOhook.stop();
    globalShortcut.unregisterAll();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
