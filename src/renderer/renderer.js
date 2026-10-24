import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

let currentReplyHeight = 0;
let hasAsked = false;
let isBusy = false;
let currentPrompt = "";
let asleep = false;
let audioKeepAlive = null;
const AUDIO_WAKE_DELAY_MS = 1000;

const voiceContext = new AudioContext({ sampleRate: 16000 });
const MIN_RECORDING_SECONDS = 0.3;

let micStream = null;
let recorder = null;
let chunks = [];
let recordingStarted = null;

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function speak(text, onDone) {
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) {
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onend = onDone;
  synth.speak(utterance);
}

function waitForTransform(el) {
  return new Promise((resolve) => {
    el.addEventListener("transitionend", function handler(e) {
      if (e.propertyName === "transform") {
        el.removeEventListener("transitionend", handler);
        resolve();
      }
    });
  });
}

async function flyToOrb() {
  const reactor = document.querySelector(".reactor");
  const target = await window.herbie.getOrbTarget();
  const rect = reactor.getBoundingClientRect();

  reactor.style.setProperty(
    "--dx",
    `${target.x - (rect.left + rect.width / 2)}px`,
  );
  reactor.style.setProperty(
    "--dy",
    `${target.y - (rect.top + rect.height / 2)}px`,
  );

  document.body.classList.add("flying");
  await waitForTransform(reactor);

  window.addEventListener(
    "resize",
    () => document.body.classList.replace("flying", "orb-mode"),
    { once: true },
  );
  window.herbie.shrink();
}

function showReply(text) {
  const reply = document.querySelector(".reply");
  reply.textContent = text;
  reply.classList.remove("ready");
  document.body.classList.add("has-reply");

  const height = reply.offsetHeight;

  if (height === currentReplyHeight) {
    reply.classList.add("ready");
    return;
  }

  currentReplyHeight = height;
  window.addEventListener("resize", () => reply.classList.add("ready"), {
    once: true,
  });
  window.herbie.setReplyHeight(height);
}

function clearReply() {
  const reply = document.querySelector(".reply");
  reply.textContent = "";
  reply.classList.remove("ready");
  document.body.classList.remove("has-reply");
  currentReplyHeight = 0;
}

function openBar() {
  if (document.body.classList.contains("bar-open")) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.addEventListener(
      "resize",
      () => {
        document.body.classList.add("bar-open");
        document.querySelector(".bar-input").focus();
        resolve();
      },
      { once: true },
    );
    window.herbie.openBar();
  });
}

function closeBar() {
  clearReply();
  document.body.classList.remove("bar-open");
  window.herbie.closeBar();
}

function getErrorMessage(err) {
  const message = String(err?.message ?? "");

  // NEW
  if (message.includes("OFFLINE")) {
    return "I'm offline, so I can't answer questions right now. I can still control media.";
  }

  if (message.includes("STT_DOWN")) {
    return "My speech recognition isn't ready. The first launch needs internet to download it.";
  }

  if (message.includes("CLAUDE_MISSING")) {
    return "I can't answer questions because Claude Code isn't installed.";
  }

  if (message.includes("CLAUDE_TIMEOUT")) {
    return "That took too long. Try again in a moment.";
  }

  if (message.includes("CLAUDE_FAILED")) {
    return "Something went wrong. Check that you're signed in to Claude Code.";
  }

  return "Sorry, something went wrong while thinking about that.";
}

async function askHerbie(prompt) {
  if (isBusy) return;
  isBusy = true;
  hasAsked = true;
  currentPrompt = prompt;

  const input = document.querySelector(".bar-input");
  input.value = "";
  input.disabled = true;
  input.placeholder = "Thinking...";
  showReply(`"${prompt}"\nThinking...`);

  try {
    const { text, speech, silent } = await window.herbie.ask(prompt);
    showReply(text);
    if (!silent) speak(speech ?? text);
  } catch (err) {
    console.error(err);
    const message = getErrorMessage(err);
    showReply(message);
    speak(message);
  } finally {
    isBusy = false;
    input.disabled = false;
    input.placeholder = "Ask Herbie...";
    input.focus();
  }
}

async function startRecording() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  chunks = [];
  recorder = new MediaRecorder(micStream);
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    recorder.onstop = async () => {
      micStream.getTracks().forEach((track) => track.stop());
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const audio = await voiceContext.decodeAudioData(
          await blob.arrayBuffer(),
        );
        resolve(audio.getChannelData(0));
      } catch (err) {
        reject(err);
      }
    };
    recorder.stop();
  });
}

async function handleVoice(samples) {
  if (!document.body.classList.contains("orb-mode") || isBusy) return;

  isBusy = true;
  let text = "";

  try {
    await openBar();
    showReply("Transcribing...");
    text = await window.herbie.transcribe(samples);
  } catch (err) {
    console.error(err);
    const message = getErrorMessage(err);
    showReply(message);
    speak(message);
    return;
  } finally {
    isBusy = false;
  }

  if (!text) {
    showReply("I didn't catch that.");
    speak("I didn't catch that.");
    return;
  }

  askHerbie(text);
}

document.querySelector(".reactor").addEventListener("click", () => {
  if (!document.body.classList.contains("orb-mode")) return;

  if (document.body.classList.contains("bar-open")) {
    closeBar();
  } else {
    openBar();
  }
});

document.querySelector(".bar-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const prompt = e.target.value.trim();
  if (prompt) askHerbie(prompt);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;

  if (document.body.classList.contains("bar-open")) {
    closeBar();
  } else {
    window.herbie.quit();
  }
});

function cancelRecording() {
  if (recorder && recorder.state === "recording") {
    recorder.onstop = null;
    recorder.stop();
  }
  micStream?.getTracks().forEach((track) => track.stop());
  document.body.classList.remove("listening");
}

// ---------- Camera and gesture recognition ----------

let cameraStream = null;
const cameraVideo = document.createElement("video");
cameraVideo.muted = true;
cameraVideo.playsInline = true;

const GESTURE_INTERVAL_MS = 66;
let recognizer = null;
let gestureTimer = null;
let lastVideoTime = -1;

const GESTURE_ACTIONS = new Map([
  ["Open_Palm", { action: "playPause", label: "Play / pause", repeat: false }],
  ["Thumb_Up", { action: "volumeUp", label: "Volume up", repeat: true }],
  ["Thumb_Down", { action: "volumeDown", label: "Volume down", repeat: true }],
  ["Victory", { action: "next", label: "Next track", repeat: false }],
]);

const MIN_GESTURE_SCORE = 0.75;
const GESTURE_HOLD_MS = 400;
const GESTURE_REARM_MS = 500;
const GESTURE_REPEAT_MS = 800;
const ACTION_LABEL_MS = 1000;

let candidateGesture = null;
let candidateSince = 0;
let firedGesture = null;
let firedLastSeen = 0;
let lastFireTime = 0;
let actionLabelUntil = 0;

async function loadRecognizer() {
  if (recognizer) return;

  const vision = await FilesetResolver.forVisionTasks("./mediapipe/wasm");
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/gesture_recognizer.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

function showGesture(top) {
  if (performance.now() < actionLabelUntil) return;

  const label = document.querySelector(".gesture-label");
  label.textContent = top
    ? `${top.categoryName} ${Math.round(top.score * 100)}%`
    : "No hand";
}

function fireGesture(name, now) {
  const { action, label } = GESTURE_ACTIONS.get(name);

  firedGesture = name;
  firedLastSeen = now;
  lastFireTime = now;

  window.herbie.gestureAction(action);

  document.querySelector(".gesture-label").textContent = label;
  actionLabelUntil = now + ACTION_LABEL_MS;

  document.body.classList.add("gesture-fired");
  setTimeout(() => document.body.classList.remove("gesture-fired"), 300);
}

function handleGesture(top) {
  const now = performance.now();
  const name = top && top.score >= MIN_GESTURE_SCORE ? top.categoryName : null;

  if (name !== candidateGesture) {
    candidateGesture = name;
    candidateSince = now;
  }

  if (firedGesture && name === firedGesture) {
    firedLastSeen = now;
    const { repeat } = GESTURE_ACTIONS.get(name);
    if (repeat && now - lastFireTime >= GESTURE_REPEAT_MS) {
      fireGesture(name, now);
    }
    return;
  }

  if (firedGesture && now - firedLastSeen >= GESTURE_REARM_MS) {
    firedGesture = null;
  }

  if (
    !firedGesture &&
    name &&
    GESTURE_ACTIONS.has(name) &&
    now - candidateSince >= GESTURE_HOLD_MS
  ) {
    fireGesture(name, now);
  }
}

function detectGesture() {
  if (!recognizer || !cameraStream) return;

  if (
    cameraVideo.readyState >= 2 &&
    cameraVideo.currentTime !== lastVideoTime
  ) {
    lastVideoTime = cameraVideo.currentTime;
    const result = recognizer.recognizeForVideo(cameraVideo, performance.now());
    const top = result.gestures[0]?.[0];
    showGesture(top);
    handleGesture(top);
  }

  gestureTimer = setTimeout(detectGesture, GESTURE_INTERVAL_MS);
}

async function startCamera() {
  if (cameraStream) return;

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, frameRate: { ideal: 30 } },
    audio: false,
  });
  cameraVideo.srcObject = cameraStream;
  await cameraVideo.play();
  document.body.classList.add("camera-on");

  await loadRecognizer();
  lastVideoTime = -1;
  detectGesture();
}

function stopCamera() {
  clearTimeout(gestureTimer);
  gestureTimer = null;

  recognizer?.close();
  recognizer = null;

  candidateGesture = null;
  firedGesture = null;
  actionLabelUntil = 0;

  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;

  document.body.classList.remove("camera-on");
  document.querySelector(".gesture-label").textContent = "";
}

window.herbie.onGestureMode(async (enabled) => {
  if (enabled) {
    try {
      await startCamera();
      speak("Gesture mode on.");
    } catch (err) {
      console.error(err);
      stopCamera();
      speak("I couldn't start gesture mode.");
    }
    return;
  }

  stopCamera();
  if (!asleep) speak("Gesture mode off.");
});

// ---------- Status, push-to-talk, startup ----------

window.herbie.onStatus(async (status) => {
  if (status === "thinking") {
    showReply(`"${currentPrompt}"\nThinking...`);
    speak("One moment.");
    return;
  }

  if (status === "sleeping") {
    asleep = true;
    window.speechSynthesis.cancel();
    cancelRecording();
    if (document.body.classList.contains("bar-open")) closeBar();
    await audioKeepAlive?.suspend();
    return;
  }

  if (status === "waking") {
    asleep = false;
    await audioKeepAlive?.resume();
    await new Promise((resolve) => setTimeout(resolve, AUDIO_WAKE_DELAY_MS));
    speak("I'm back.");

    const ready = await window.herbie.waitForBrain();

    speak(
      ready
        ? "I'm connected and ready."
        : "I'm offline. I can still control media.",
    );
  }
});

window.herbie.onPushToTalk(async (state) => {
  if (asleep) return;

  document.body.classList.toggle("listening", state === "down");

  if (state === "down") {
    window.speechSynthesis.cancel();
    recordingStarted = startRecording();
    return;
  }

  let samples;
  try {
    await recordingStarted;
    samples = await stopRecording();
  } catch (err) {
    console.error(err);
    speak("I couldn't access the microphone.");
    return;
  }

  if (samples.length / 16000 < MIN_RECORDING_SECONDS) return;
  handleVoice(samples);
});

async function announceBrain() {
  const ready = await window.herbie.waitForBrain();
  if (hasAsked) return;

  speak(
    ready
      ? "I'm connected and ready. Ask me anything."
      : "I'm offline. I can still control media.",
  );
}

async function keepAudioAwake() {
  const ctx = new AudioContext();
  const source = ctx.createConstantSource();
  const gain = ctx.createGain();

  gain.gain.value = 0.0001;
  source.connect(gain).connect(ctx.destination);
  source.start();
  await ctx.resume();

  audioKeepAlive = ctx;

  await new Promise((resolve) => setTimeout(resolve, AUDIO_WAKE_DELAY_MS));
}

function primeSpeech() {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance("Hello");
    utterance.volume = 0;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);

    setTimeout(resolve, 3000);
  });
}

async function start() {
  await keepAudioAwake();
  await primeSpeech();
  const name = await window.herbie.getUserName();
  const message = `${getGreeting()}, ${name}. Herbie is online.`;
  document.querySelector("h1").textContent = message;

  speak(message, () => {
    flyToOrb();
    announceBrain();
  });
}

start();
