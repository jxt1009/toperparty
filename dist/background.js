/******/ (() => { // webpackBootstrap
/*!****************************************!*\
  !*** ./chrome-extension/background.js ***!
  \****************************************/
// background.js - Manages WebSocket connection and media streams

let ws = null;
let localStream = null;
let isConnected = false;
let roomId = null;
let userId = generateUserId();

// WebRTC Configuration
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] }
  ]
};

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
}

// Initialize connection
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.type);
  
  if (request.type === 'START_PARTY') {
    startParty(request.roomId).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  }

  if (request.type === 'STOP_PARTY') {
    stopParty();
    sendResponse({ success: true });
  }

  if (request.type === 'RESTORE_PARTY') {
    console.log('Restoring party after navigation:', request.roomId);
    
    // Force a clean slate by stopping any existing party session first (Reset behavior)
    console.log('Performing full party reset (Stop -> Start) for restoration');
    stopParty();

    // Use the saved userId instead of generating a new one
    if (request.userId) {
      userId = request.userId;
    }
    startParty(request.roomId).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      console.error('Failed to restore party:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  }

  if (request.type === 'GET_STATUS') {
    console.log('Sending status:', { isConnected, roomId, userId, hasLocalStream: !!localStream });
    sendResponse({
      isConnected,
      roomId,
      userId,
      hasLocalStream: !!localStream
    });
    return true;
  }

  if (request.type === 'PLAY_PAUSE') {
    broadcastMessage({
      type: 'PLAYBACK_CONTROL',
      control: request.control,
      timestamp: request.timestamp,
      userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_TIME') {
    broadcastMessage({
      type: 'SYNC_PLAYBACK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SEEK') {
    console.log('Broadcasting SEEK command:', request.currentTime);
    broadcastMessage({
      type: 'SEEK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'URL_CHANGE') {
    console.log('Broadcasting URL change:', request.url);
    broadcastMessage({
      type: 'URL_CHANGE',
      url: request.url,
      userId
    });
    sendResponse({ success: true });
  }

  // Relay signaling messages from content scripts (offers/answers/ice)
  if (request.type === 'SIGNAL_SEND') {
    const msg = Object.assign({}, request.message || {});
    // ensure identifying info is present
    msg.userId = msg.userId || userId;
    msg.roomId = msg.roomId || roomId;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: 'Not connected to signaling server' });
    }
    return true;
  }
});

// Start party mode
async function startParty(inputRoomId) {
  roomId = inputRoomId || 'default_room_' + Date.now();

  // Request media stream from content script
  return new Promise((resolve, reject) => {
    try {
      // First, try to get media access through the content script
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        if (tabs.length === 0) {
          // If no Netflix tab, we can still try to get media in the background
          getMediaStreamInBackground()
            .then(() => connectToSignalingServer(resolve, reject))
            .catch(reject);
        } else {
          // Ask the Netflix content script to get media
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'REQUEST_MEDIA_STREAM'
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn('Content script not ready, trying background:', chrome.runtime.lastError);
              getMediaStreamInBackground()
                .then(() => connectToSignalingServer(resolve, reject))
                .catch(reject);
              return;
            }
            
            if (response && response.success) {
              console.log('Got media stream from content script');
              connectToSignalingServer(resolve, reject);
            } else {
              // Fallback to background attempt
              console.warn('Content script failed to get media, trying background');
              getMediaStreamInBackground()
                .then(() => connectToSignalingServer(resolve, reject))
                .catch(reject);
            }
          });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Try to get media stream in background (for testing without Netflix tab)
async function getMediaStreamInBackground() {
  try {
    // This will fail in service worker, but we set a flag so we can continue
    // In production, the content script will handle this
    console.log('Note: Media stream will be obtained from Netflix page');
    return;
  } catch (err) {
    console.error('Could not get media in background:', err);
    throw err;
  }
}

// Connect to signaling server
function connectToSignalingServer(resolve, reject) {
  try {
    ws = new WebSocket('ws://watch.toper.dev/ws');

    ws.onopen = () => {
      console.log('Connected to signaling server');
      isConnected = true;

      // Send join message
      ws.send(JSON.stringify({
        type: 'JOIN',
        userId,
        roomId,
        timestamp: Date.now()
      }));

      // Notify all tabs
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'PARTY_STARTED',
            userId,
            roomId
          }).catch(() => {}); // Ignore errors if content script not ready
        });
      });

      resolve();
    };

    ws.onmessage = (event) => {
      handleSignalingMessage(event.data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(new Error('Failed to connect to signaling server'));
    };

    ws.onclose = () => {
      console.log('Disconnected from signaling server');
      isConnected = false;
      cleanup();
    };
  } catch (err) {
    reject(err);
  }
}

// Stop party mode
function stopParty() {
  if (ws) {
    ws.send(JSON.stringify({
      type: 'LEAVE',
      userId,
      roomId,
      timestamp: Date.now()
    }));
    ws.close();
    ws = null;
  }

  cleanup();
  isConnected = false;

  // Notify all tabs
  chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'PARTY_STOPPED'
      }).catch(() => {});
    });
  });
}

// Cleanup resources
function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
}

// Handle signaling messages
async function handleSignalingMessage(data) {
  try {
    const message = JSON.parse(data);

    // Forward signaling payloads to all Netflix tabs so content scripts can handle WebRTC
    chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'SIGNAL', message }).catch(() => {});
      });
    });

    // Additionally handle playback control / sync specially (apply immediately)
    if (message.type === 'PLAYBACK_CONTROL' && message.userId !== userId) {
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'APPLY_PLAYBACK_CONTROL', 
            control: message.control, 
            timestamp: message.timestamp,
            fromUserId: message.userId 
          }).catch(() => {});
        });
      });
    }

    if (message.type === 'SYNC_PLAYBACK' && message.userId !== userId) {
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'APPLY_SYNC_PLAYBACK', 
            currentTime: message.currentTime, 
            isPlaying: message.isPlaying,
            timestamp: message.timestamp,
            fromUserId: message.userId 
          }).catch(() => {});
        });
      });
    }

    if (message.type === 'SEEK' && message.userId !== userId) {
      console.log('Forwarding SEEK command from remote user');
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'APPLY_SEEK', 
            currentTime: message.currentTime, 
            isPlaying: message.isPlaying,
            fromUserId: message.userId 
          }).catch(() => {});
        });
      });
    }

    if (message.type === 'URL_CHANGE' && message.userId !== userId) {
      console.log('Received URL change from remote user:', message.url);
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'APPLY_URL_CHANGE', 
            url: message.url,
            fromUserId: message.userId 
          }).catch(() => {});
        });
      });
    }
  } catch (err) {
    console.error('Error handling signaling message:', err);
  }
}

// Note: WebRTC peer connection management is handled in the content script.

// Broadcast message to all peers
function broadcastMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/******/ })()
;
//# sourceMappingURL=background.js.map