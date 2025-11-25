// content-script.js - Injected into Netflix pages

let partyActive = false;
let userId = null;
let roomId = null;
let localStream = null;
let localPreviewVideo = null;
const peerConnections = new Map();
const remoteVideos = new Map();
const remoteStreams = new Map();
const reconnectionAttempts = new Map(); // Track reconnection attempts per peer
const reconnectionTimeouts = new Map(); // Track reconnection timeout handles

// Simple state tracking for echo prevention
let lastLocalAction = { type: null, time: 0 }; // Track last local action to prevent echo
let lastRemoteAction = { type: null, time: 0 }; // Track last remote action for logging

// URL monitoring - track when user navigates to different shows
let lastKnownUrl = window.location.href;
let restoringPartyState = false; // prevent URL broadcast during restoration

// Check if we need to restore party state after navigation
(function checkRestorePartyState() {
  const partyState = sessionStorage.getItem('toperparty_state');
  if (partyState) {
    try {
      const state = JSON.parse(partyState);
      console.log('Detected party state after navigation, will restore:', state);
      
      // Set flag to prevent URL broadcast during restoration
      restoringPartyState = true;
      
      // Clear the stored state
      sessionStorage.removeItem('toperparty_state');
      
      // Notify background that we need to rejoin
      setTimeout(function() {
        chrome.runtime.sendMessage({
          type: 'RESTORE_PARTY',
          roomId: state.roomId,
          userId: state.userId
        });
        
        // Clear restoration flag after party is restored
        setTimeout(function() {
          restoringPartyState = false;
          console.log('Party restoration complete, URL monitoring active');
        }, 2000);
      }, 1000); // Wait 1s for page to stabilize
    } catch (e) {
      console.error('Failed to restore party state:', e);
      sessionStorage.removeItem('toperparty_state');
      restoringPartyState = false;
    }
  }
})();

// Inject Netflix API access script into page context
(function injectNetflixAPIHelper() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('netflix-api-bridge.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = function() {
    console.log('Netflix API bridge loaded');
    script.remove();
  };
})();

// Netflix API wrapper for content script
const NetflixPlayer = {
  _sendCommand: function(command, args = []) {
    return new Promise(function(resolve) {
      const handler = function(e) {
        if (e.detail.command === command) {
          document.removeEventListener('__toperparty_response', handler);
          resolve(e.detail.result);
        }
      };
      document.addEventListener('__toperparty_response', handler);
      setTimeout(function() { resolve(null); }, 1000); // timeout fallback
      document.dispatchEvent(new CustomEvent('__toperparty_command', { detail: { command, args } }));
    });
  },
  
  play: function() {
    return this._sendCommand('play');
  },
  
  pause: function() {
    return this._sendCommand('pause');
  },
  
  seek: function(timeMs) {
    return this._sendCommand('seek', [timeMs]);
  },
  
  getCurrentTime: function() {
    return this._sendCommand('getCurrentTime');
  },
  
  isPaused: function() {
    return this._sendCommand('isPaused');
  }
};

// Find Netflix video player (fallback for monitoring)
function getVideoElement() {
  return document.querySelector('video');
}

// Check if extension context is still valid
function isExtensionContextValid() {
  try {
    // Try to access chrome.runtime.id - will throw if context is invalidated
    return chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Safely send message to background, handling invalidated context
function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) {
    console.warn('Extension context invalidated - please reload the page');
    return;
  }
  try {
    chrome.runtime.sendMessage(message, callback);
  } catch (e) {
    console.warn('Failed to send message, extension may have been reloaded:', e.message);
  }
}

// Helper to check if an action is an echo of what we just did
function isEcho(actionType) {
  const now = Date.now();
  const timeSinceLocal = now - lastLocalAction.time;
  
  // If we just performed this action within 500ms, it's likely an echo
  if (lastLocalAction.type === actionType && timeSinceLocal < 500) {
    console.log(`Ignoring echo of ${actionType} (${timeSinceLocal}ms ago)`);
    return true;
  }
  return false;
}

// Helper to track that we performed an action
function recordLocalAction(actionType) {
  lastLocalAction = { type: actionType, time: Date.now() };
  console.log(`Recorded local action: ${actionType}`);
}

// Helper to track remote actions
function recordRemoteAction(actionType) {
  lastRemoteAction = { type: actionType, time: Date.now() };
  console.log(`Recorded remote action: ${actionType}`);
}

// URL monitoring - check for navigation changes
function startUrlMonitoring() {
  // Save party state whenever URL is about to change (for hard navigations)
  window.addEventListener('beforeunload', function savePartyStateBeforeUnload() {
    if (partyActive && userId && roomId) {
      const stateToSave = {
        roomId: roomId,
        userId: userId,
        navigatedFrom: window.location.href,
        timestamp: Date.now()
      };
      sessionStorage.setItem('toperparty_state', JSON.stringify(stateToSave));
      console.log('Saved party state before unload');
    }
  });
  
  // Also monitor for soft navigations (client-side routing)
  setInterval(function checkUrlChange() {
    const currentUrl = window.location.href;
    
    // Check if URL changed and party is active (but not during restoration)
    if (currentUrl !== lastKnownUrl && partyActive && !restoringPartyState) {
      console.log('URL changed from', lastKnownUrl, 'to', currentUrl);
      lastKnownUrl = currentUrl;
      
      // Broadcast URL change to other clients
      safeSendMessage({
        type: 'URL_CHANGE',
        url: currentUrl
      });
    } else if (!restoringPartyState) {
      // Silently update lastKnownUrl if we're not in restoration mode
      lastKnownUrl = currentUrl;
    }
  }, 500); // Check every 500ms
}

function stopUrlMonitoring() {
  lastKnownUrl = window.location.href;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Signaling messages forwarded from background
  if (request.type === 'SIGNAL' && request.message) {
    handleSignalingMessage(request.message).catch(err => console.error('Signal handling error:', err));
    return; // no sendResponse needed
  }
  if (request.type === 'REQUEST_MEDIA_STREAM') {
    // Get media stream for webcam/mic
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true
    })
      .then((stream) => {
        localStream = stream;
        console.log('Media stream obtained in content script');
        
        // Monitor stream tracks for unexpected ending
        stream.getTracks().forEach(function(track) {
          console.log('Local stream track obtained:', track.kind, 'id=', track.id, 'readyState=', track.readyState);
          track.onended = function() {
            console.error('LOCAL STREAM TRACK ENDED UNEXPECTEDLY:', track.kind, 'id=', track.id);
          };
          track.onmute = function() {
            console.warn('Local stream track muted:', track.kind);
          };
          track.onunmute = function() {
            console.log('Local stream track unmuted:', track.kind);
          };
        });
        
        // Create or update local preview
        attachLocalPreview(stream);
        
        // Start monitoring local stream health
        startLocalStreamMonitor(stream);
        
        // add or replace tracks to any existing peer connections
        peerConnections.forEach((pc) => {
          try { stream.getTracks().forEach(t => addOrReplaceTrack(pc, t, stream)); } catch (e) { console.warn('Error adding tracks to pc', e); }
        });
        sendResponse({ success: true, message: 'Media stream obtained' });
      })
      .catch((err) => {
        console.error('Failed to get media stream:', err);
        sendResponse({ success: false, error: err.message });
      });
    
    return true; // Keep channel open for async response
  }

  if (request.type === 'PARTY_STARTED') {
    partyActive = true;
    userId = request.userId;
    roomId = request.roomId;
    console.log('Party started! Room:', roomId, 'User:', userId);
    
    // Start monitoring URL changes
    startUrlMonitoring();
    
    // Inject controls and setup playback sync (wait for video if necessary)
    //injectControls();
    setupPlaybackSync();
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    partyActive = false;
    userId = null;
    roomId = null;
    
    // Stop URL monitoring
    stopUrlMonitoring();
    
    teardownPlaybackSync();
    
    // Stop stream monitor
    stopLocalStreamMonitor();
    
    // Stop media stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    // Remove local preview UI
    removeLocalPreview();
    // Remove injected controls
    removeInjectedControls();
    // Clear all reconnection attempts and timeouts
    reconnectionTimeouts.forEach((timeoutHandle) => {
      clearTimeout(timeoutHandle);
    });
    reconnectionTimeouts.clear();
    reconnectionAttempts.clear();
    
    // Close and clear peer connections
    try {
      peerConnections.forEach((pc) => {
        try { pc.close(); } catch (e) {}
      });
      peerConnections.clear();
    } catch (e) {}
    // Remove remote video elements
    try {
      remoteVideos.forEach((v, id) => removeRemoteVideo(id));
    } catch (e) {}
    
    console.log('Party stopped');
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    console.log('Applying remote', request.control, 'command from', request.fromUserId);
    recordRemoteAction(request.control);
    
    if (request.control === 'play') {
      NetflixPlayer.play().then(function() {
        console.log('Remote play completed');
        recordLocalAction('play'); // Prevent echo of this action
      }).catch(function(err) {
        console.error('Failed to apply remote play:', err);
      });
    } else if (request.control === 'pause') {
      NetflixPlayer.pause().then(function() {
        console.log('Remote pause completed');
        recordLocalAction('pause'); // Prevent echo of this action
      }).catch(function(err) {
        console.error('Failed to apply remote pause:', err);
      });
    }
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_SYNC_PLAYBACK') {
    // Passive sync - only correct significant drift
    NetflixPlayer.getCurrentTime().then(function(currentTime) {
      const requestedTime = request.currentTime * 1000; // Convert to ms
      const timeDiff = Math.abs(currentTime - requestedTime);
      
      // Check if we just did a local action - don't override it with passive sync
      const timeSinceLocalAction = Date.now() - lastLocalAction.time;
      if (timeSinceLocalAction < 1000) { // Reduced from 2000ms to 1000ms
        console.log('Ignoring passive sync - recent local action:', lastLocalAction.type, timeSinceLocalAction, 'ms ago');
        return;
      }
      
      // Only sync if times differ significantly (avoid micro-adjustments)
      if (timeDiff > 2000) { // 2 second threshold
        console.log('Passive sync: diff was', (timeDiff / 1000).toFixed(1), 's - correcting');
        NetflixPlayer.seek(requestedTime).then(function() {
          recordLocalAction('seek'); // Prevent echo
        });
      }
      
      // Handle play/pause state sync
      NetflixPlayer.isPaused().then(function(isPaused) {
        if (request.isPlaying && isPaused && timeSinceLocalAction > 1000) {
          console.log('Passive sync: resuming playback');
          NetflixPlayer.play().then(function() {
            recordLocalAction('play');
          });
        } else if (!request.isPlaying && !isPaused && timeSinceLocalAction > 1000) {
          console.log('Passive sync: pausing playback');
          NetflixPlayer.pause().then(function() {
            recordLocalAction('pause');
          });
        }
      });
    });
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_SEEK') {
    console.log('Applying remote SEEK to', request.currentTime, 's from', request.fromUserId);
    recordRemoteAction('seek');
    
    // Always seek to exact position (explicit command, no threshold)
    const requestedTime = request.currentTime * 1000; // Convert to ms
    
    NetflixPlayer.seek(requestedTime).then(function() {
      console.log('Remote seek completed');
      recordLocalAction('seek'); // Prevent echo
      
      // Also sync play/pause state
      NetflixPlayer.isPaused().then(function(isPaused) {
        if (request.isPlaying && isPaused) {
          NetflixPlayer.play().then(function() {
            recordLocalAction('play');
          });
        } else if (!request.isPlaying && !isPaused) {
          NetflixPlayer.pause().then(function() {
            recordLocalAction('pause');
          });
        }
      });
    }).catch(function(err) {
      console.error('Failed to apply remote seek:', err);
    });
    
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_URL_CHANGE') {
    console.log('Applying URL change from remote user:', request.url, 'from user:', request.fromUserId);
    
    // Save party state before navigation so we can restore after reload
    if (partyActive && userId && roomId) {
      const stateToSave = {
        roomId: roomId,
        userId: userId,
        navigatedFrom: window.location.href,
        timestamp: Date.now()
      };
      sessionStorage.setItem('toperparty_state', JSON.stringify(stateToSave));
      console.log('Saved party state before navigation');
    }
    
    // Always use hard navigation to ensure Netflix properly loads the new video
    // This will cause a page reload, but state will be restored automatically
    window.location.href = request.url;
    
    sendResponse({ success: true });
  }
});

// Setup playback synchronization
function setupPlaybackSync() {
  // Wait for the Netflix <video> element to be present, then attach listeners
  waitForVideo().then(function onVideoReady(video) {
    if (!video) {
      console.warn('Netflix video element not found after wait');
      return;
    }

    // Track play events - simple approach: always broadcast unless it's an echo
    const onPlay = function handlePlayEvent() {
      if (!partyActive) return;
      
      if (isEcho('play')) return;
      
      console.log('Local play - broadcasting to peers');
      recordLocalAction('play');
      safeSendMessage({ type: 'PLAY_PAUSE', control: 'play', timestamp: video.currentTime });
    };

    // Track pause events - simple approach: always broadcast unless it's an echo
    const onPause = function handlePauseEvent() {
      if (!partyActive) return;
      
      if (isEcho('pause')) return;
      
      console.log('Local pause - broadcasting to peers');
      recordLocalAction('pause');
      safeSendMessage({ type: 'PLAY_PAUSE', control: 'pause', timestamp: video.currentTime });
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    // Track seeking events - always broadcast unless it's an echo
    const onSeeked = function handleSeekedEvent() {
      if (!partyActive) return;
      
      if (isEcho('seek')) return;
      
      console.log('Local seek to', video.currentTime, '- broadcasting to peers');
      recordLocalAction('seek');
      safeSendMessage({ type: 'SEEK', currentTime: video.currentTime, isPlaying: !video.paused });
    };
    
    video.addEventListener('seeked', onSeeked);

    // Throttled timeupdate sender (every ~1s at most) - for passive drift correction only
    let lastSentAt = 0;
    const onTimeUpdate = function handleTimeUpdate() {
      if (!partyActive) return;
      
      const now = Date.now();
      if (now - lastSentAt < 1000) return; // throttle to ~1s
      lastSentAt = now;
      safeSendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused });
    };

    video.addEventListener('timeupdate', onTimeUpdate);

    // Periodic fallback sync (every 5 seconds) - for passive drift correction
    window.playbackSyncInterval = setInterval(function syncPlaybackPeriodic() {
      if (partyActive && video) {
        safeSendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused });
      }
    }, 5000);

    // Save references for teardown
    window.__toperparty_video_listeners = { onPlay, onPause, onSeeked, onTimeUpdate, video };

    console.log('Playback sync setup complete');
    
    // Send initial sync after setup to catch up others (especially after URL change)
    // Wait a bit for video to initialize
    setTimeout(function sendInitialSync() {
      if (partyActive && video) {
        console.log('Sending initial sync after video setup');
        safeSendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused });
      }
    }, 2000);
  }).catch(function onVideoWaitError(err) {
    console.error('Error waiting for video element:', err);
  });
}

// Teardown playback synchronization
function teardownPlaybackSync() {
  if (window.playbackSyncInterval) {
    clearInterval(window.playbackSyncInterval);
    window.playbackSyncInterval = null;
  }
  // Remove listeners attached to the video element
  const refs = window.__toperparty_video_listeners;
  if (refs && refs.video) {
    try {
      refs.video.removeEventListener('play', refs.onPlay);
      refs.video.removeEventListener('pause', refs.onPause);
      refs.video.removeEventListener('seeked', refs.onSeeked);
      refs.video.removeEventListener('timeupdate', refs.onTimeUpdate);
    } catch (e) {
      // ignore
    }
  }
  window.__toperparty_video_listeners = null;
}

// Inject play/pause controls into page
function injectControls() {
  if (document.getElementById('netflix-party-controls')) {
    return; // Already injected
  }

  const controlsDiv = document.createElement('div');
  controlsDiv.id = 'netflix-party-controls';
  controlsDiv.innerHTML = `
    <style>
      #netflix-party-controls {
        position: fixed;
        bottom: 150px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        border: 2px solid #e50914;
        border-radius: 8px;
        padding: 15px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        color: white;
      }
      .control-button {
        background: #e50914;
        color: white;
        border: none;
        padding: 8px 15px;
        margin: 5px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
      }
      .control-button:hover {
        background: #bb070f;
      }
      .status-text {
        font-size: 12px;
        margin: 5px 0;
      }
    </style>
    <div class="status-text">Party Mode Active</div>
    <button class="control-button" id="play-btn">Play</button>
    <button class="control-button" id="pause-btn">Pause</button>
  `;

  document.body.appendChild(controlsDiv);

  // Add event listeners - use Netflix API instead of video element
  document.getElementById('play-btn')?.addEventListener('click', function() {
    NetflixPlayer.play().then(function() {
      console.log('Play button clicked - using Netflix API');
    });
  });

  document.getElementById('pause-btn')?.addEventListener('click', function() {
    NetflixPlayer.pause().then(function() {
      console.log('Pause button clicked - using Netflix API');
    });
  });
}

function removeInjectedControls() {
  const el = document.getElementById('netflix-party-controls');
  if (el) el.remove();
}

// Create a small local preview video element and attach a media stream to it
function attachLocalPreview(stream) {
  if (!stream) return;
  
  // If preview already exists, just update the stream
  if (localPreviewVideo && document.body.contains(localPreviewVideo)) {
    console.log('Updating existing local preview with new stream');
    try {
      localPreviewVideo.srcObject = stream;
      localPreviewVideo.play().catch(function() {});
    } catch (e) {
      console.error('Failed to update preview stream:', e);
    }
    return;
  }
  
  // Create new preview element
  const v = document.createElement('video');
  v.id = 'toperparty-local-preview';
  v.autoplay = true;
  v.muted = true; // mute local preview
  v.playsInline = true;
  v.style.position = 'fixed';
  v.style.bottom = '20px';
  v.style.left = '20px';
  v.style.width = '240px';
  v.style.height = '160px';
  v.style.zIndex = 10001;
  v.style.border = '2px solid #e50914';
  v.style.borderRadius = '4px';
  
  // Monitor video element events
  v.onloadedmetadata = function() {
    console.log('Local preview metadata loaded, videoWidth=', v.videoWidth, 'videoHeight=', v.videoHeight);
  };
  v.onplaying = function() {
    console.log('Local preview playing');
  };
  v.onstalled = function() {
    console.warn('Local preview stalled');
  };
  v.onsuspend = function() {
    console.warn('Local preview suspended');
  };
  
  try {
    v.srcObject = stream;
  } catch (e) {
    console.error('Failed to set srcObject, trying fallback:', e);
    // older browsers: createObjectURL fallback
    v.src = URL.createObjectURL(stream);
  }
  
  document.body.appendChild(v);
  localPreviewVideo = v;
  
  try {
    // Ensure the video element starts playing (muted allows autoplay in most browsers)
    v.play().catch(function(err) {
      console.error('Local preview play() failed:', err);
    });
  } catch (e) {
    console.error('Exception calling play():', e);
  }

  console.log('Created local preview, tracks=', (stream && stream.getTracks) ? stream.getTracks().length : 0);
}

function removeLocalPreview() {
  if (localPreviewVideo) {
    try {
      // Do NOT stop the captured stream's tracks here - stopping the preview
      // element should not stop the camera/mic itself. Clearing the srcObject
      // prevents the element from holding the stream reference.
      if (localPreviewVideo.srcObject) {
        try { localPreviewVideo.srcObject = null; } catch (e) {}
      }
    } catch (e) {}
    try { localPreviewVideo.remove(); } catch (e) {}
    localPreviewVideo = null;
  }
}

// Monitor local stream health and log issues
let streamMonitorInterval = null;
function startLocalStreamMonitor(stream) {
  // Clear any existing monitor
  if (streamMonitorInterval) {
    clearInterval(streamMonitorInterval);
  }
  
  let lastFrameCheck = Date.now();
  let wasLive = true;
  
  streamMonitorInterval = setInterval(function() {
    if (!stream || !localPreviewVideo) {
      clearInterval(streamMonitorInterval);
      streamMonitorInterval = null;
      return;
    }
    
    const tracks = stream.getTracks();
    const videoTrack = tracks.find(function(t) { return t.kind === 'video'; });
    
    if (videoTrack) {
      const isLive = videoTrack.readyState === 'live' && videoTrack.enabled;
      
      // Check if video element is actually playing
      const videoElement = localPreviewVideo;
      const isPlaying = videoElement && !videoElement.paused && videoElement.readyState >= 2;
      
      if (!isLive && wasLive) {
        console.error('LOCAL VIDEO TRACK IS NO LONGER LIVE!', 
          'readyState=', videoTrack.readyState, 
          'enabled=', videoTrack.enabled,
          'muted=', videoTrack.muted);
      }
      
      if (!isPlaying && isLive) {
        console.warn('Local preview element not playing despite live track',
          'paused=', videoElement.paused,
          'readyState=', videoElement.readyState,
          'currentTime=', videoElement.currentTime);
        // Try to restart playback
        try {
          videoElement.play().catch(function(e) {
            console.error('Failed to restart local preview:', e);
          });
        } catch (e) {}
      }
      
      wasLive = isLive;
    }
  }, 2000); // Check every 2 seconds
}

function stopLocalStreamMonitor() {
  if (streamMonitorInterval) {
    clearInterval(streamMonitorInterval);
    streamMonitorInterval = null;
  }
}

// Add or replace a track on an RTCPeerConnection to avoid duplicate senders
function addOrReplaceTrack(pc, track, stream) {
  try {
    const kind = track.kind;
    const sender = pc.getSenders().find(s => s.track && s.track.kind === kind);
    if (sender) {
      // replace existing track
      sender.replaceTrack(track);
      console.log('Replaced sender track for kind', kind);
    } else {
      pc.addTrack(track, stream);
      console.log('Added sender track for kind', kind);
    }
  } catch (e) {
    console.warn('addOrReplaceTrack failed', e);
  }
}

// Wait for the page <video> element to appear (MutationObserver + fallback)
function waitForVideo(timeoutMs = 10000) {
  return new Promise((resolve) => {
    try {
      const existing = getVideoElement();
      if (existing) return resolve(existing);

      const root = document.body || document.documentElement || document;
      let timer = null;
      const observer = new MutationObserver((mutations, obs) => {
        const v = getVideoElement();
        if (v) {
          if (timer) clearTimeout(timer);
          try { obs.disconnect(); } catch (e) {}
          resolve(v);
        }
      });

      observer.observe(root, { childList: true, subtree: true });

      timer = setTimeout(() => {
        try { observer.disconnect(); } catch (e) {}
        // final attempt
        resolve(getVideoElement());
      }, timeoutMs);
    } catch (err) {
      resolve(null);
    }
  });
}

// --- WebRTC signaling helpers (content-script side) ---
function sendSignal(message) {
  safeSendMessage({ type: 'SIGNAL_SEND', message }, function(resp) {
    // optionally handle response
  });
}

async function handleSignalingMessage(message) {
  if (!message || !message.type) return;
  const type = message.type;
  const from = message.userId || message.from;
  const to = message.to;

  // Ignore messages not for us (if addressed)
  if (to && to !== userId) return;

  if (type === 'JOIN' && from && from !== userId) {
    // Another user joined the room — initiate P2P if we have local media
    if (!peerConnections.has(from)) {
      try {
        const pc = createPeerConnection(from);
        peerConnections.set(from, pc);
        if (localStream) {
          localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'OFFER', from: userId, to: from, offer: pc.localDescription });
      } catch (err) {
        console.error('Error handling JOIN and creating offer:', err);
        peerConnections.delete(from);
      }
    }
    return;
  }

  if (type === 'OFFER' && message.offer && from && from !== userId) {
    // Received an offer from a peer
    let pc = peerConnections.get(from);
    
    // If connection exists and is not in a good state for receiving an offer, close and recreate
    if (pc) {
      const state = pc.signalingState;
      if (state !== 'stable' && state !== 'closed') {
        console.warn('Received offer while in signaling state:', state, '- recreating connection');
        try {
          pc.close();
        } catch (e) {}
        peerConnections.delete(from);
        pc = null;
      }
    }
    
    if (!pc) {
      pc = createPeerConnection(from);
      peerConnections.set(from, pc);
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
      if (localStream) {
        localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'ANSWER', from: userId, to: from, answer: pc.localDescription });
    } catch (err) {
      console.error('Error handling offer:', err);
      // Clean up failed connection
      peerConnections.delete(from);
      try { pc.close(); } catch (e) {}
    }
    return;
  }

  if (type === 'ANSWER' && message.answer && from && from !== userId) {
    const pc = peerConnections.get(from);
    if (pc) {
      try {
        // Check if we're expecting an answer
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        } else {
          console.warn('Received answer in unexpected state:', pc.signalingState);
        }
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    }
    return;
  }

  if (type === 'ICE_CANDIDATE' && message.candidate && from && from !== userId) {
    const pc = peerConnections.get(from);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (err) {
        console.warn('Error adding received ICE candidate', err);
      }
    }
    return;
  }

  if (type === 'LEAVE' && from) {
    // Peer left
    const pc = peerConnections.get(from);
    if (pc) {
      pc.close();
      peerConnections.delete(from);
    }
    removeRemoteVideo(from);
    return;
  }
}

// Attempt to reconnect to a peer
async function attemptReconnection(peerId) {
  if (!partyActive || !userId || !roomId) {
    console.log('Cannot reconnect - party not active');
    return;
  }

  const attempts = reconnectionAttempts.get(peerId) || 0;
  const maxAttempts = 5;
  const backoffDelay = Math.min(1000 * Math.pow(2, attempts), 30000); // Exponential backoff, max 30s

  if (attempts >= maxAttempts) {
    console.log('Max reconnection attempts reached for', peerId);
    reconnectionAttempts.delete(peerId);
    reconnectionTimeouts.delete(peerId);
    return;
  }

  console.log(`Attempting reconnection to ${peerId} (attempt ${attempts + 1}/${maxAttempts}) in ${backoffDelay}ms`);
  reconnectionAttempts.set(peerId, attempts + 1);

  // Clear any existing timeout for this peer
  const existingTimeout = reconnectionTimeouts.get(peerId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Schedule reconnection attempt
  const timeoutHandle = setTimeout(async function() {
    console.log('Reconnecting to', peerId);
    
    // Remove old connection
    const oldPc = peerConnections.get(peerId);
    if (oldPc) {
      try {
        oldPc.close();
      } catch (e) {
        console.warn('Error closing old peer connection:', e);
      }
      peerConnections.delete(peerId);
    }
    
    // Create new connection and send offer
    try {
      const pc = createPeerConnection(peerId);
      peerConnections.set(peerId, pc);
      
      if (localStream) {
        localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
      }
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'OFFER', from: userId, to: peerId, offer: pc.localDescription });
      
      console.log('Reconnection offer sent to', peerId);
    } catch (err) {
      console.error('Failed to create reconnection offer:', err);
      // Retry with next attempt
      attemptReconnection(peerId);
    }
  }, backoffDelay);

  reconnectionTimeouts.set(peerId, timeoutHandle);
}

// Clear reconnection state for a peer (called on successful connection)
function clearReconnectionState(peerId) {
  reconnectionAttempts.delete(peerId);
  const timeoutHandle = reconnectionTimeouts.get(peerId);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    reconnectionTimeouts.delete(peerId);
  }
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['stun:stun1.l.google.com:19302'] }
    ]
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: 'ICE_CANDIDATE', from: userId, to: peerId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    console.log('Received remote track from', peerId, 'track=', event.track && event.track.kind);
    // Some browsers populate event.streams[0], others deliver individual tracks.
    let stream = (event.streams && event.streams[0]) || remoteStreams.get(peerId);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(peerId, stream);
    }
    if (event.track) {
      try { 
        stream.addTrack(event.track);
        // Monitor track state
        event.track.onended = function() {
          console.warn('Remote track ended from', peerId, 'kind=', event.track.kind);
        };
        console.log('Added remote track to stream, kind=', event.track.kind, 'readyState=', event.track.readyState);
      } catch (e) { 
        console.warn('Failed to add remote track to stream', e); 
      }
    }
    // Only create the video element once, not on every track
    if (!remoteVideos.has(peerId)) {
      addRemoteVideo(peerId, stream);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('PC state', pc.connectionState, 'for', peerId);
    
    if (pc.connectionState === 'connected') {
      // Connection successful - clear any reconnection attempts
      console.log('Connection established successfully with', peerId);
      clearReconnectionState(peerId);
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      // Connection lost - attempt reconnection
      console.warn('Connection', pc.connectionState, 'with', peerId, '- attempting reconnection');
      peerConnections.delete(peerId);
      removeRemoteVideo(peerId);
      
      // Attempt to reconnect
      attemptReconnection(peerId);
    } else if (pc.connectionState === 'closed') {
      // Connection intentionally closed - clean up without reconnecting
      console.log('Connection closed with', peerId);
      peerConnections.delete(peerId);
      removeRemoteVideo(peerId);
      clearReconnectionState(peerId);
    }
  };

  return pc;
}

function addRemoteVideo(peerId, stream) {
  removeRemoteVideo(peerId);
  const v = document.createElement('video');
  v.id = 'toperparty-remote-' + peerId;
  v.autoplay = true;
  v.playsInline = true;
  // Start muted to allow autoplay, then unmute after playing
  v.muted = true;
  v.style.position = 'fixed';
  v.style.bottom = '20px';
  v.style.right = (20 + (remoteVideos.size * 180)) + 'px';
  v.style.width = '240px';
  v.style.height = '160px';
  v.style.zIndex = 10001;
  v.style.border = '2px solid #00aaff';
  v.style.borderRadius = '4px';
  
  // Log audio tracks for debugging
  const audioTracks = stream.getAudioTracks();
  console.log('Remote stream audio tracks:', audioTracks.length);
  audioTracks.forEach(function(track) {
    console.log('Audio track:', track.id, 'enabled=', track.enabled, 'readyState=', track.readyState);
  });
  
  try {
    v.srcObject = stream;
  } catch (e) {
    v.src = URL.createObjectURL(stream);
  }
  document.body.appendChild(v);
  remoteVideos.set(peerId, v);
  
  try {
    v.play().then(function() {
      // Unmute after successful play to enable audio
      console.log('Remote video playing, unmuting audio for', peerId);
      v.muted = false;
      v.volume = 1.0;
    }).catch(function(err) {
      console.warn('Remote video play() failed:', err);
      // Try unmuting anyway
      v.muted = false;
    });
  } catch (e) {
    console.error('Exception calling play():', e);
  }
}

function removeRemoteVideo(peerId) {
  const v = remoteVideos.get(peerId);
  if (v) {
    try {
      // Do NOT stop remote tracks - they are managed by the sender
      // Just clear the srcObject to release the reference
      if (v.srcObject) {
        v.srcObject = null;
      }
    } catch (e) {}
    v.remove();
    remoteVideos.delete(peerId);
  }
  // Also clean up the stream reference
  remoteStreams.delete(peerId);
}

// Done
