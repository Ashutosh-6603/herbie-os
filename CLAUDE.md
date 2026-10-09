# Herbie: Jarvis-style AI assistant

## How to work with me (Ashutosh)

- Don't just agree with everything I say. Push back when something is a bad idea, and explain why.
- Ask for clarification when something is ambiguous instead of assuming.
- Go step by step: one small step at a time, with a short explanation of WHY. Wait for me to run it and report back before the next step.
- When writing code, guide me through writing it in small pieces. Don't dump full files.
- After each completed step, update the "Current status" section below.

## Requirements

1. Hybrid assistant:
   - Local AI (Ollama) plus direct code for laptop control: media play/pause in the browser (YouTube, Netflix), folder drag and drop, etc. Triggered by hand gestures or voice commands.
   - Claude API for web-related things: news on AI, politics, the Indian stock market, anything I'd normally open a browser for.
2. Futuristic user interface.
3. Starts automatically when I log into my laptop and greets me.
4. Start simple and improve progressively.
5. Developed in WSL (terminal, git, Claude Code), but it runs as a normal desktop app, not a terminal program.
6. Local AI = Ollama (works offline).
7. Installable app that other people can use on their own laptops/PCs.

## Key design decisions

- Stack: Electron + TypeScript. UI in HTML/CSS; electron-builder for installers (Windows first, then Linux, then macOS); Electron's login-item API for autostart.
- Gestures and clear voice commands call actions DIRECTLY (e.g., open palm → media play/pause key). Ollama is used only to interpret ambiguous voice commands. Claude is used for web/knowledge queries.
- Gestures: MediaPipe (JavaScript version) running inside the app with the webcam.
- Claude: Anthropic Node SDK with its web search tool. The API is billed separately from a Claude.ai subscription.
- Speech-to-text: to be decided at the voice stage (offline Whisper in Node needs extra setup).

## Dev environment rules

- The repo lives on the Windows drive: /mnt/c/Users/ashut/Projects/personal/herbie-os (symlinked from ~/Projects/personal/herbie-os).
- Edit, git, and Claude Code: in WSL.
- Install and run: ALWAYS use Windows Node through PowerShell, e.g., `powershell.exe -c "npm install"`, `powershell.exe -c "npm run dev"`.
- NEVER run npm install from WSL's Linux Node. Native modules built for Linux break on Windows and vice versa.
- Ollama: use the WINDOWS install (autostarts at login, localhost:11434). There's also an Ollama install inside WSL. Don't run both at the same time, since they share port 11434.
- Hardware: RTX 3070 Ti Laptop GPU (8GB VRAM).

## Roadmap (each version usable before moving on)

- v0.1: Futuristic window that opens at login and greets me by voice
- v0.2: Type to Herbie, and it answers using Ollama
- v0.3: Media controls (play/pause/next) via buttons, then keyboard shortcuts
- v0.4: Voice commands
- v0.5: Claude for web questions, with Herbie routing between local AI and Claude
- v0.6: Hand gestures
- v1.0: Installer for other people

## Current status

- v0.1 DONE (tagged): full-screen Jarvis HUD at login, spoken greeting, glides and docks
  to a 140px orb in the bottom-right, autostart via app.setLoginItemSettings
  (`npm run autostart:off` removes it).
- v0.2 DONE (tagged): click orb → floating chat bar; Enter sends the question to Ollama
  via main (`herbie:ask`, input validated); reply panel above the bar grows the window
  to fit (max 240px, scrolls); answers spoken aloud.
  - Ollama: warm-up at startup with keep_alive 30m and num_ctx 16384 (both requests must
    use the same num_ctx); health check via /api/version; spoken announcement when the
    local brain is ready or failed.
  - Memory: session-only history in main, last 60 messages; user name lives in main
    (USER_NAME) and the greeting fetches it via `herbie:get-user-name`.
  - Audio: silent AudioContext keeps the output awake; a muted priming utterance warms up
    speechSynthesis; AUDIO_WAKE_DELAY_MS = 1000 before the greeting.
- Model: llama3.2 3B, 100% GPU, ~4.1GB VRAM at 16K context.
- Known TODOs: autostart re-enables itself every launch (make it a setting); ORB/BAR sizes
  duplicated between main.ts and styles.css; history trimmed by message count, not tokens;
  memory doesn't survive restarts.
- Next: v0.3, media controls (play/pause/next) for YouTube/Netflix in the browser.
