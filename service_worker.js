// service_worker.js
// Keeps extension alive for messaging; currently minimal, used if we want persistent chrome.runtime messaging in future.

chrome.runtime.onInstalled.addListener(() => {
  console.log('SyncWatch installed');
});

// Forwarding example (if needed)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // This worker can act as a hub between popup and content scripts in future
  // For now just reply OK
  sendResponse({ ok: true });
  return true;
});
