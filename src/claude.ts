import { execFile, type ExecFileException } from "node:child_process";

const CLAUDE_MODEL = "haiku";
const CLAUDE_TIMEOUT_MS = 90_000;

// Questions starting with these go to Claude, and the phrase is removed
const TRIGGER = /^\s*(search(\s+for)?|look\s+up|lookup|google)\b[\s,:]*/i;

// Questions containing these words go to Claude
// const WEB_KEYWORDS =
//   /\b(news|latest|today|current|currently|recent|stocks?|share\s+price|market|sensex|nifty)\b/i;

const CLAUDE_INSTRUCTIONS =
  "You are the web-research brain of Herbie, a voice assistant. " +
  "Make sure to make the answers point-wise and concise. " +
  "If you are unable to find an answer, say 'I don't know' and do not make up an answer. " +
  "If the user asks for a web search, use the WebSearch tool to find relevant information. " +
  "If the user asks for a specific webpage, use the WebFetch tool to retrieve the content of that page. ";

export type ClaudeAnswer = {
  speech: string; // what Herbie says
  display: string; // what Herbie shows (answer + sources)
};

export function needsClaude(prompt: string): boolean {
  return TRIGGER.test(prompt);
  //   return TRIGGER.test(prompt) || WEB_KEYWORDS.test(prompt);
}

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
): Promise<ClaudeAnswer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      [
        "-p",
        "--model",
        CLAUDE_MODEL,
        "--allowedTools",
        "WebSearch,WebFetch",
        "--append-system-prompt",
        CLAUDE_INSTRUCTIONS,
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
