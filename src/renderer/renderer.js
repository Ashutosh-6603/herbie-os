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

const message = `${getGreeting()}, Ashutosh. Herbie is online.`;
document.querySelector("h1").textContent = message;
speak(message, () => {
  document.body.classList.add("orb-mode");
  window.herbie.shrink();
});
