let currentReplyHeight = 0; // NEW: tracks the reply panel's last height

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function speak(text, onDone) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onend = onDone;
  window.speechSynthesis.speak(utterance);
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

// NEW: show text in the reply panel, growing the window to fit
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

// NEW: empty and hide the reply panel
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
  clearReply(); // NEW: a closed bar starts fresh next time
  document.body.classList.remove("bar-open");
  window.herbie.closeBar();
}

// NEW: turn an error into a message Herbie can show and say
function getErrorMessage(err) {
  const message = String(err?.message ?? "");
  if (message.includes("OLLAMA_DOWN")) {
    return "My local brain isn't running. Please start Ollama.";
  }
  if (message.toLowerCase().includes("timeout")) {
    return "My local brain is taking too long to respond. Try again in a moment.";
  }
  return "Sorry, something went wrong while thinking about that.";
}

// CHANGED: shows "Thinking...", then the reply or error, in the panel
async function handleAsk(input) {
  const prompt = input.value.trim();
  if (!prompt || input.disabled) return;

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

const message = `${getGreeting()}, Ashutosh. Herbie is online.`;
document.querySelector("h1").textContent = message;
speak(message, flyToOrb);
