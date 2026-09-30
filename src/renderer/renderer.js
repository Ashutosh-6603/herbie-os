function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function speak(text, onDone) {
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

document.querySelector(".reactor").addEventListener("click", () => {
  if (!document.body.classList.contains("orb-mode")) return;

  if (document.body.classList.contains("bar-open")) {
    closeBar();
  } else {
    openBar();
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
