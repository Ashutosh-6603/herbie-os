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

- Done: repo moved to the Windows drive; git initialized; Electron + TypeScript skeleton (src/main.ts, src/renderer/index.html); Node/Electron .gitignore.
- Windows Ollama has llama3.2:latest (3B). Fine for now; may try a larger model at v0.4.
- Next: check that Node.js is installed on Windows.
