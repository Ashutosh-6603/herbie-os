import { execFile } from "node:child_process";

export type MediaAction =
  | "playPause"
  | "next"
  | "previous"
  | "volumeUp"
  | "volumeDown"
  | "mute";

const MEDIA_KEYS: Record<MediaAction, { code: number; times: number }> = {
  playPause: { code: 179, times: 1 },
  next: { code: 176, times: 1 },
  previous: { code: 177, times: 1 },
  volumeUp: { code: 175, times: 5 },
  volumeDown: { code: 174, times: 5 },
  mute: { code: 173, times: 1 },
};

export const MEDIA_REPLIES: Record<MediaAction, string> = {
  playPause: "Play / pause",
  next: "Next track",
  previous: "Previous track",
  volumeUp: "Volume up",
  volumeDown: "Volume down",
  mute: "Mute toggled",
};

const COMMANDS = new Map<string, MediaAction>([
  ["pause", "playPause"],
  ["play", "playPause"],
  ["resume", "playPause"],
  ["stop", "playPause"],
  ["next", "next"],
  ["skip", "next"],
  ["next one", "next"],
  ["previous", "previous"],
  ["go back", "previous"],
  ["last one", "previous"],
  ["volume up", "volumeUp"],
  ["louder", "volumeUp"],
  ["turn it up", "volumeUp"],
  ["volume down", "volumeDown"],
  ["quieter", "volumeDown"],
  ["turn it down", "volumeDown"],
  ["mute", "mute"],
  ["unmute", "mute"],
]);

const FILLER_WORDS = /\b(herbie|please|the|video|music|song|track|this)\b/g;

export function matchMediaCommand(text: string): MediaAction | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(FILLER_WORDS, "")
    .replace(/\s+/g, " ")
    .trim();

  return COMMANDS.get(normalized) ?? null;
}

export function performMediaAction(action: MediaAction): Promise<void> {
  if (process.platform !== "win32") {
    return Promise.reject(
      new Error("Media control is only implemented for Windows"),
    );
  }

  const { code, times } = MEDIA_KEYS[action];
  const script =
    "$shell = New-Object -ComObject WScript.Shell; " +
    `1..${times} | ForEach-Object { $shell.SendKeys([char]${code}) }`;

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
