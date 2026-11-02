const HERBIE_URL = "ws://127.0.0.1:47616/extension";
const RECONNECT_ALARM = "herbie-reconnect";

let socket = null;

async function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return; // connecting or open

  const { token } = await chrome.storage.local.get("token");
  if (!token) {
    console.log("Herbie: no pairing token set (open the extension options)");
    return;
  }

  socket = new WebSocket(HERBIE_URL);

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "hello", token }));
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "welcome") {
      console.log("Herbie: connected");
    }
    // "ping" needs no reply: receiving it is what keeps this worker alive
  };

  socket.onclose = (event) => {
    console.log(`Herbie: disconnected (${event.code} ${event.reason})`);
    socket = null;
  };
}

// Try to connect when the browser starts, when the extension installs or updates,
// and every 30 seconds via an alarm (in case Herbie wasn't running earlier)
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connect();
});

// Reconnect straight away when a new token is saved
chrome.storage.onChanged.addListener((changes) => {
  if (changes.token) {
    socket?.close();
    socket = null;
    connect();
  }
});

connect();
