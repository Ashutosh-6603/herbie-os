function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);

  window.speechSynthesis.speak(utterance);
}

const message = `${getGreeting()}, Ashutosh. Herbie is online.`;
document.querySelector("h1").textContent = message;
speak(message);
