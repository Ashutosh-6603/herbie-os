import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
  session,
} from "electron";
import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { uIOhook, UiohookKey } from "uiohook-napi";
import {
  isMediaAction,
  matchMediaCommand,
  normalizeCommand,
  performMediaAction,
  MEDIA_REPLIES,
} from "./media.js";
import { askClaude, stripTrigger } from "./claude.js"; // CHANGED: needsClaude removed

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const ORB_SIZE = 140;
const ORB_MARGIN = 24;
const BAR_WIDTH = 420;
const BAR_HEIGHT = 56;
const BAR_GAP = 12;
const REPLY_GAP = 12;
const MAX_REPLY_HEIGHT = 240;

const MAX_PROMPT_LENGTH = 2000;
const USER_NAME = "Ashutosh";
const MAX_HISTORY_MESSAGES = 60;

const PUSH_TO_TALK_KEY = UiohookKey.CtrlRight;
const SLEEP_SHORTCUT = "CommandOrControl+Alt+H";
const GESTURE_SHORTCUT = "CommandOrControl+Alt+G";

const GESTURE_COMMANDS = new Map<string, "on" | "off" | "toggle">([
  ["gesture mode", "toggle"],
  ["gesture mode on", "on"],
  ["gestures on", "on"],
  ["start gestures", "on"],
  ["enable gestures", "on"],
  ["gesture mode off", "off"],
  ["gestures off", "off"],
  ["stop gestures", "off"],
  ["disable gestures", "off"],
]);

const STT_MODEL = "Xenova/whisper-base.en";
const MAX_RECORDING_SAMPLES = 16000 * 30;

type ChatMessage = {
  role: "user" | "assistant";
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

// NEW: can we reach Anthropic? (any response counts; only a network failure means offline)
async function isOnline(): Promise<boolean> {
  try {
    await fetch("https://api.anthropic.com", {
      method: "HEAD",
      signal: AbortSignal.timeout(3_000),
    });
    return true;
  } catch {
    return false;
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
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setFullScreen(true);
    win.show();
  });

  win.loadURL("app://herbie/index.html");

  return win;
}

app.whenReady().then(() => {
  if (process.argv.includes("--no-autostart")) {
    setAutostart(false);
    app.quit();
    return;
  }

  setAutostart(true);

  let gestureMode = false;

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const mediaTypes =
        "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      const allowed =
        permission === "media" &&
        mediaTypes.length > 0 &&
        mediaTypes.every(
          (type) => type === "audio" || (type === "video" && gestureMode),
        );

      callback(allowed);
    },
  );

  const rendererRoot = path.join(__dirname, "renderer");

  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.normalize(
      path.join(rendererRoot, decodeURIComponent(pathname)),
    );

    const relative = path.relative(rendererRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });

  const win = createWindow();

  function setGestureMode(enabled: boolean): void {
    gestureMode = enabled;
    win.webContents.send("herbie:gesture-mode", enabled);
    console.log(`Gesture mode ${enabled ? "on" : "off"}`);
  }

  let brainReady = isOnline(); // CHANGED: "ready" now means "can reach Claude"
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

  // CHANGED: nothing to unload anymore
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

    const question = prompt.trim();

    const mediaAction = matchMediaCommand(question);
    if (mediaAction) {
      console.log(`Command: ${mediaAction}`);
      await performMediaAction(mediaAction);
      return { text: MEDIA_REPLIES[mediaAction], silent: true };
    }

    const gestureCommand = GESTURE_COMMANDS.get(normalizeCommand(question));
    if (gestureCommand) {
      const enabled =
        gestureCommand === "toggle" ? !gestureMode : gestureCommand === "on";
      setGestureMode(enabled);
      return {
        text: enabled ? "Gesture mode on" : "Gesture mode off",
        silent: true,
      };
    }

    // 3. CHANGED: everything else goes to Claude
    if (!(await isOnline())) {
      throw new Error("OFFLINE");
    }

    win.webContents.send("herbie:status", "thinking");

    const context = recentContext();
    const cleaned = stripTrigger(question);
    const input = context
      ? `Conversation so far:\n${context}\n\nNew question: ${cleaned}`
      : cleaned;

    console.log(`You: ${question}`);
    const answer = await askClaude(input, claudeWorkspace, USER_NAME);
    console.log(`Claude: ${answer.speech}`);

    rememberExchange(question, answer.speech);
    return { text: answer.display, speech: answer.speech, silent: false };
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

  ipcMain.on("herbie:gesture-action", (_event, action: unknown) => {
    if (typeof action !== "string" || !isMediaAction(action)) return;
    if (asleep || !gestureMode) return;

    console.log(`Gesture action: ${action}`);
    performMediaAction(action).catch((err) => {
      console.error("Gesture action failed:", err);
    });
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
    if (gestureMode) setGestureMode(false);
    win.hide();

    const transcriber = await transcriberReady;
    transcriberReady = Promise.resolve(null);
    await transcriber?.dispose?.();

    console.log("Herbie is asleep");
  }

  function wakeUp(): void {
    asleep = false;
    brainReady = isOnline(); // CHANGED
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

  const gestureRegistered = globalShortcut.register(GESTURE_SHORTCUT, () => {
    if (!asleep) setGestureMode(!gestureMode);
  });

  if (!gestureRegistered) {
    console.error(
      `Could not register ${GESTURE_SHORTCUT}; another app may be using it`,
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
