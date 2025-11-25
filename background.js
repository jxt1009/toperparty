let ws = null;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket("wss://watch.toper.dev/ws");

  ws.onopen = () => console.log("WS connected");
  ws.onclose = () => {
    console.log("WS closed, retrying...");
    setTimeout(connect, 2000); // auto-reconnect
  };
  ws.onmessage = (msg) => {
    // forward messages to tabs or popup
    chrome.runtime.sendMessage({ type: "ws-message", data: msg.data });
  };
}

connect();

// Handle outbound messages from popup or content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ws-send" && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(msg.data);
  }
});
