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
  document.body.classList.remove("bar-open");
  window.herbie.closeBar();
}

async function handleAsk(input) {
  const prompt = input.value.trim();
  if (!prompt || input.disabled) return;

  input.value = "";
  input.disabled = true;
  input.placeholder = "Thinking...";

  try {
    const reply = await window.herbie.ask(prompt);
    speak(reply);
  } catch (err) {
    console.error(err);
    // CHANGED: say what actually went wrong
    const message = String(err?.message ?? "");
    if (message.includes("OLLAMA_DOWN")) {
      speak("My local brain isn't running. Please start Ollama.");
    } else if (message.toLowerCase().includes("timeout")) {
      speak(
        "My local brain is taking too long to respond. Try again in a moment.",
      );
    } else {
      speak("Sorry, something went wrong while thinking about that.");
    }
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
