let currentReplyHeight = 0;
let hasAsked = false;
let isBusy = false; // NEW: true while Herbie is transcribing or thinking
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

// CHANGED: returns a Promise that resolves once the bar is visible
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

// CHANGED: added the speech-to-text failure case
function getErrorMessage(err) {
  const message = String(err?.message ?? "");
  if (message.includes("OLLAMA_DOWN")) {
    return "My local brain isn't running. Please start Ollama.";
  }
  if (message.includes("STT_DOWN")) {
    return "My speech recognition isn't ready. The first launch needs internet to download it.";
  }
  if (message.toLowerCase().includes("timeout")) {
    return "My local brain is taking too long to respond. Try again in a moment.";
  }
  return "Sorry, something went wrong while thinking about that.";
}

// CHANGED: was handleAsk(input); now takes the question text, used by typing and voice
async function askHerbie(prompt) {
  if (isBusy) return;
  isBusy = true;
  hasAsked = true;

  const input = document.querySelector(".bar-input");
  input.value = "";
  input.disabled = true;
  input.placeholder = "Thinking...";
  showReply(`"${prompt}"\nThinking...`);

  try {
    const reply = await window.herbie.ask(prompt);
    showReply(reply);
    speak(reply);
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

// NEW: transcribe a recording and ask Herbie about it
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

// CHANGED: typed questions go through askHerbie
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

// CHANGED: record while held, then transcribe and ask (playback test removed)
window.herbie.onPushToTalk(async (state) => {
  document.body.classList.toggle("listening", state === "down");

  if (state === "down") {
    window.speechSynthesis.cancel(); // NEW: talking interrupts Herbie
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
      ? "My local brain is online. Ask me anything."
      : "I couldn't start my local brain. Please check that Ollama is running.",
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
