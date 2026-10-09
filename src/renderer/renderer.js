let currentReplyHeight = 0;
let hasAsked = false;
let audioKeepAlive = null;
const AUDIO_WAKE_DELAY_MS = 1000;

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
  window.addEventListener(
    "resize",
    () => {
      document.body.classList.add("bar-open");
      document.querySelector(".bar-input").focus();
    },
    { once: true },
  );
  window.herbie.openBar();
}

function closeBar() {
  clearReply();
  document.body.classList.remove("bar-open");
  window.herbie.closeBar();
}

function getErrorMessage(err) {
  const message = String(err?.message ?? "");
  if (message.includes("OLLAMA_DOWN")) {
    return "I am having some error connecting to Ollama. Please check that it is running.";
  }
  if (message.toLowerCase().includes("timeout")) {
    return "It is taking too long to respond. Try again in a moment.";
  }
  return "Sorry, something went wrong while thinking about that.";
}

async function handleAsk(input) {
  const prompt = input.value.trim();
  if (!prompt || input.disabled) return;

  hasAsked = true;
  input.value = "";
  input.disabled = true;
  input.placeholder = "Thinking...";
  showReply("Thinking...");

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
    input.disabled = false;
    input.placeholder = "Ask Herbie...";
    input.focus();
  }
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
  if (e.key === "Enter") {
    handleAsk(e.target);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;

  if (document.body.classList.contains("bar-open")) {
    closeBar();
  } else {
    window.herbie.quit();
  }
});

async function announceBrain() {
  const ready = await window.herbie.waitForBrain();
  if (hasAsked) return;

  speak(
    ready
      ? "What do you have in mind? You can ask me anything."
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
