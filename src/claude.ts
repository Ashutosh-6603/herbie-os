import { execFile, type ExecFileException } from "node:child_process";

const CLAUDE_MODEL = "haiku";
const CLAUDE_EFFORT = "low";
const CLAUDE_MAX_TURNS = 6;
const CLAUDE_TIMEOUT_MS = 90_000;

const TRIGGER = /^\s*(search(\s+for)?|look\s+up|lookup|google)\b[\s,:]*/i;

function buildInstructions(userName: string): string {
  return (
    `You are Herbie, a voice desktop assistant for ${userName}. ` +
    "Answer in at most three short sentences that sound natural when spoken aloud, " +
    "with no markdown, lists, or URLs in the answer. " +
    "Use web search only when the question needs current or recent information. " +
    "If you used web sources, after the answer write a line containing only SOURCES: " +
    "followed by up to three source URLs, one per line."
  );
}

export type ClaudeAnswer = {
  speech: string;
  display: string;
};

export function stripTrigger(prompt: string): string {
  return prompt.replace(TRIGGER, "").trim() || prompt.trim();
}

function parseAnswer(output: string): ClaudeAnswer {
  const [answerPart = "", sourcesPart = ""] = output.split(/^\s*SOURCES:/m);
  const speech = answerPart.trim();
  const sources = sourcesPart.trim();

  return {
    speech,
    display: sources ? `${speech}\n\nSources:\n${sources}` : speech,
  };
}

export function askClaude(
  input: string,
  workspace: string,
  userName: string,
): Promise<ClaudeAnswer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      [
        "-p",
        "--model",
        CLAUDE_MODEL,
        "--effort",
        CLAUDE_EFFORT,
        "--max-turns",
        String(CLAUDE_MAX_TURNS),
        "--no-session-persistence",
        "--allowedTools",
        "WebSearch,WebFetch",
        "--append-system-prompt",
        buildInstructions(userName),
      ],
      {
        cwd: workspace,
        timeout: CLAUDE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        if (err) {
          if (err.code === "ENOENT") return reject(new Error("CLAUDE_MISSING"));
          if (err.killed) return reject(new Error("CLAUDE_TIMEOUT"));
          console.error("Claude failed:", stderr || err.message);
          return reject(new Error("CLAUDE_FAILED"));
        }
        resolve(parseAnswer(stdout));
      },
    );

    child.stdin?.end(input);
  });
}
