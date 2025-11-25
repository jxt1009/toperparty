// background.js - Manages WebSocket connection and media streams

let ws = null;
let localStream = null;
let peerConnections = new Map();
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

  peerConnections.forEach((pc) => {
    pc.close();
  });
  peerConnections.clear();
}

// Handle signaling messages
async function handleSignalingMessage(data) {
  try {
    const message = JSON.parse(data);

    if (message.type === 'JOIN' && message.userId !== userId) {
      // Another user joined, initiate WebRTC connection
      await initiateWebRTCConnection(message.userId);
    }

    if (message.type === 'OFFER' && message.to === userId) {
      // Receive WebRTC offer
      const pc = peerConnections.get(message.from) || createPeerConnection(message.from);
      peerConnections.set(message.from, pc);

      const offer = new RTCSessionDescription(message.offer);
      await pc.setRemoteDescription(offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: 'ANSWER',
        from: userId,
        to: message.from,
        answer: pc.localDescription
      }));
    }

    if (message.type === 'ANSWER' && message.to === userId) {
      // Receive WebRTC answer
      const pc = peerConnections.get(message.from);
      if (pc) {
        const answer = new RTCSessionDescription(message.answer);
        await pc.setRemoteDescription(answer);
      }
    }

    if (message.type === 'ICE_CANDIDATE' && message.to === userId) {
      // Receive ICE candidate
      const pc = peerConnections.get(message.from);
      if (pc && message.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch (err) {
          console.error('Failed to add ICE candidate:', err);
        }
      }
    }

    if (message.type === 'PLAYBACK_CONTROL' && message.userId !== userId) {
      // Sync playback control
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'APPLY_PLAYBACK_CONTROL',
            control: message.control,
            timestamp: message.timestamp
          }).catch(() => {});
        });
      });
    }

    if (message.type === 'SYNC_PLAYBACK' && message.userId !== userId) {
      // Sync playback time
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'APPLY_SYNC_PLAYBACK',
            currentTime: message.currentTime,
            isPlaying: message.isPlaying
          }).catch(() => {});
        });
      });
    }
  } catch (err) {
    console.error('Error handling signaling message:', err);
  }
}

// Initiate WebRTC connection
async function initiateWebRTCConnection(peerId) {
  if (peerConnections.has(peerId)) {
    return; // Already connected
  }

  const pc = createPeerConnection(peerId);
  peerConnections.set(peerId, pc);

  // Add local stream tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: 'OFFER',
    from: userId,
    to: peerId,
    offer: pc.localDescription
  }));
}

// Create WebRTC peer connection
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'ICE_CANDIDATE',
        from: userId,
        to: peerId,
        candidate: event.candidate
      }));
    }
  };

  pc.ontrack = (event) => {
    console.log('Received remote stream from', peerId);
    // Notify popup about remote stream
    chrome.runtime.sendMessage({
      type: 'REMOTE_STREAM_RECEIVED',
      peerId,
      stream: event.streams[0]
    }).catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState, 'for peer:', peerId);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      peerConnections.delete(peerId);
    }
  };

  return pc;
}

// Broadcast message to all peers
function broadcastMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
