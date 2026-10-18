import { cpSync } from "node:fs";

cpSync(
  "node_modules/@mediapipe/tasks-vision/wasm",
  "src/renderer/public/mediapipe/wasm",
  { recursive: true },
);

console.log("Copied MediaPipe WebAssembly files");
