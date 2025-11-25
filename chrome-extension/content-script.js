// content-script.js - Modular version with ES6 imports

import { StateManager } from './modules/state-manager.js';
import { NetflixController } from './modules/netflix-controller.js';
import { SyncManager } from './modules/sync-manager.js';
import { WebRTCManager } from './modules/webrtc-manager.js';
import { UIManager } from './modules/ui-manager.js';
import { URLSync } from './modules/url-sync.js';

// Initialize managers
const stateManager = new StateManager();
const uiManager = new UIManager();
const netflixController = new NetflixController();
const syncManager = new SyncManager(stateManager, netflixController);
const webrtcManager = new WebRTCManager(stateManager, uiManager);
const urlSync = new URLSync(stateManager);

// Local media stream (still tracked here, but WebRTCManager knows about it too)
let localStream = null;

// Check if we need to restore party state after navigation
(function checkRestorePartyState() {
  const restorationState = urlSync.getRestorationState();
  if (restorationState) {
    console.log('Detected party state after navigation, will restore:', restorationState);
    
    // Clear the stored state
    urlSync.clearState();
    
    // Set flag to prevent URL broadcast during restoration
    stateManager.setRestoringFlag(true);
    
    // Notify background that we need to rejoin
    setTimeout(function() {
      console.log('Triggering party reset and restoration...');
      chrome.runtime.sendMessage({
        type: 'RESTORE_PARTY',
        roomId: restorationState.roomId,
        userId: restorationState.userId
      });
      
      // Clear restoration flag after party is restored
      setTimeout(function() {
        stateManager.setRestoringFlag(false);
        console.log('Party restoration complete, URL monitoring active');
      }, 2000);
    }, 1000); // Wait 1s for page to stabilize
  }
})();

// Inject Netflix API access script into page context
netflixController.injectAPIBridge();

// Find Netflix video player (fallback for monitoring)
function getVideoElement() {
  return document.querySelector('video');
}

// URL monitoring - check for navigation changes
let lastKnownUrl = window.location.href;

function startUrlMonitoring() {
  // Save party state and inform server/peers that THIS tab is leaving on hard navigations
  window.addEventListener('beforeunload', function savePartyStateBeforeUnload() {
    const currentState = stateManager.getState();
    if (stateManager.isInParty()) {
      // Persist enough info so the refreshed tab can rejoin cleanly
      urlSync.saveState();

      // Send a LEAVE over the signaling channel for this user only, without
      // stopping the entire party for other tabs.
      try {
        stateManager.safeSendMessage({
          type: 'SIGNAL_SEND',
          message: {
            type: 'LEAVE',
            userId: currentState.userId,
            roomId: currentState.roomId,
            timestamp: Date.now()
          }
        });
      } catch (e) {
        console.warn('Error sending LEAVE on beforeunload:', e);
      }

      // Local, immediate cleanup to avoid dangling timers/PCs during unload
      try {
        webrtcManager.clearAll();
      } catch (e) {
        console.warn('Error clearing WebRTC state on beforeunload:', e);
      }
    }
  });
  
  // Also monitor for soft navigations (client-side routing)
  setInterval(function checkUrlChange() {
    const currentUrl = window.location.href;
    const state = stateManager.getState();
    
    // Check if URL changed and party is active (but not during restoration)
    if (currentUrl !== lastKnownUrl && state.partyActive && !state.restoringPartyState) {
      console.log('URL changed from', lastKnownUrl, 'to', currentUrl);
      lastKnownUrl = currentUrl;
      
      // Broadcast URL change to other clients
      stateManager.safeSendMessage({
        type: 'URL_CHANGE',
        url: currentUrl
      });
    } else if (!state.restoringPartyState) {
      // Silently update lastKnownUrl if we're not in restoration mode
      lastKnownUrl = currentUrl;
    }
  }, 500); // Check every 500ms
}

function stopUrlMonitoring() {
  lastKnownUrl = window.location.href;
  urlSync.stop();
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Signaling messages forwarded from background
  if (request.type === 'SIGNAL' && request.message) {
    webrtcManager.handleSignal(request.message).catch(err => console.error('Signal handling error:', err));
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
        webrtcManager.setLocalStream(stream);
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
      
        // Let WebRTC manager attach tracks to existing peer connections
        webrtcManager.onLocalStreamAvailable(stream);
        sendResponse({ success: true, message: 'Media stream obtained' });
      })
      .catch((err) => {
        console.error('Failed to get media stream:', err);
        sendResponse({ success: false, error: err.message });
      });
    
    return true; // Keep channel open for async response
  }

  if (request.type === 'PARTY_STARTED') {
    stateManager.startParty(request.userId, request.roomId);
    console.log('Party started! Room:', request.roomId, 'User:', request.userId);
    
    // Start monitoring URL changes
    startUrlMonitoring();
    
    // Setup playback sync, then attempt to restore prior playback state (if any)
    Promise.resolve(syncManager.setup())
      .then(() => {
        // Mark a programmatic seek time so SyncManager ignores the initial jump
        syncManager.lastProgrammaticSeekAt = Date.now();
        tryRestorePlaybackState();
      })
      .catch((err) => {
        console.error('[ContentScript] Error setting up sync manager:', err);
      });
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    stateManager.stopParty();
    
    // Stop URL monitoring
    stopUrlMonitoring();
    
    // Teardown sync
    syncManager.teardown();
    
    // Stop stream monitor
    stopLocalStreamMonitor();
    
    // Stop media stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
      webrtcManager.setLocalStream(null);
    }
    
    // Remove local preview UI
    removeLocalPreview();
    
    // Remove injected controls
    removeInjectedControls();
    
    // Let WebRTC manager fully clean up connections, reconnection state, and remote UI
    webrtcManager.clearAll();
    
    console.log('Party stopped');
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    syncManager.handlePlaybackControl(request.control, request.fromUserId);
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_SYNC_PLAYBACK') {
    syncManager.handlePassiveSync(request.currentTime, request.isPlaying, request.fromUserId, request.timestamp);
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_SEEK') {
    syncManager.handleSeek(request.currentTime, request.isPlaying, request.fromUserId);
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_URL_CHANGE') {
    console.log('Applying URL change from remote user:', request.url, 'from user:', request.fromUserId);
    
    // Save party state before navigation so we can restore after reload
    const state = stateManager.getState();
    if (state.partyActive && state.userId && state.roomId) {
      // Capture approximate playback state so refreshed tab rejoins near same position
      netflixController.getCurrentTime()
        .then((ms) => {
          const currentTime = ms != null ? ms / 1000 : null;
          return netflixController.isPaused().then((paused) => ({ currentTime, isPlaying: !paused }));
        })
        .then((playback) => {
          const existing = urlSync.getRestorationState() || {};
          const payload = {
            userId: state.userId,
            roomId: state.roomId,
            currentTime: playback.currentTime != null ? playback.currentTime : existing.currentTime || null,
            isPlaying: typeof playback.isPlaying === 'boolean' ? playback.isPlaying : (typeof existing.isPlaying === 'boolean' ? existing.isPlaying : null),
            timestamp: Date.now()
          };
          sessionStorage.setItem('toperparty_restore', JSON.stringify(payload));
          console.log('Saved party + playback state before navigation', payload);
        })
        .catch((e) => {
          console.warn('Failed to capture playback state before navigation, falling back to basic party state:', e);
          urlSync.saveState();
        });
    }
    
    // Always use hard navigation to ensure Netflix properly loads the new video
    // This will cause a page reload, but state will be restored automatically
    window.location.href = request.url;
    
    sendResponse({ success: true });
  }
});

// --- UI Functions (kept in main file for now) ---

function removeInjectedControls() {
  const controls = document.getElementById('netflix-party-controls');
  if (controls) {
    controls.remove();
  }
}

function attachLocalPreview(stream) {
  let localPreviewVideo = uiManager.getLocalPreviewVideo();
  
  // Remove existing preview if any
  if (localPreviewVideo) {
    try {
      if (localPreviewVideo.srcObject) {
        localPreviewVideo.srcObject = null;
      }
    } catch (e) {}
    localPreviewVideo.remove();
    localPreviewVideo = null;
  }

  // Create new video element for local preview
  const v = document.createElement('video');
  v.id = 'toperparty-local-preview';
  v.autoplay = true;
  v.muted = true; // Always mute local preview to avoid feedback
  v.playsInline = true;
  v.style.position = 'fixed';
  v.style.bottom = '20px';
  v.style.left = '20px';
  v.style.width = '240px';
  v.style.height = '160px';
  v.style.zIndex = 10001;
  v.style.border = '2px solid #e50914';
  v.style.borderRadius = '4px';
  v.style.transform = 'scaleX(-1)'; // Mirror for natural preview

  try {
    v.srcObject = stream;
  } catch (e) {
    v.src = URL.createObjectURL(stream);
  }

  document.body.appendChild(v);
  uiManager.setLocalPreviewVideo(v);

  v.play().catch(function(err) {
    console.warn('Local preview play() failed (this is usually fine):', err);
  });
}

function removeLocalPreview() {
  const localPreviewVideo = uiManager.getLocalPreviewVideo();
  if (localPreviewVideo) {
    try {
      // Stop the tracks managed by this video's srcObject (only if we own them)
      if (localPreviewVideo.srcObject) {
        localPreviewVideo.srcObject.getTracks().forEach(function(track) {
          track.stop();
        });
        localPreviewVideo.srcObject = null;
      }
    } catch (e) {
      console.warn('Error stopping local preview tracks:', e);
    }
    localPreviewVideo.remove();
    uiManager.setLocalPreviewVideo(null);
  }
}

function startLocalStreamMonitor(stream) {
  uiManager.clearStreamMonitorInterval();
  
  const interval = setInterval(function monitorLocalStream() {
    if (!stream) {
      console.warn('Local stream is null, stopping monitor');
      uiManager.clearStreamMonitorInterval();
      return;
    }

    const tracks = stream.getTracks();
    if (tracks.length === 0) {
      console.warn('Local stream has no tracks');
      uiManager.clearStreamMonitorInterval();
      return;
    }

    let allActive = true;
    tracks.forEach(function(track) {
      if (track.readyState !== 'live') {
        console.error('Local stream track not live:', track.kind, 'readyState=', track.readyState);
        allActive = false;
      }
    });

    if (!allActive) {
      console.warn('Some local stream tracks are not active - may need to restart stream');
    }
  }, 5000); // Check every 5 seconds
  
  uiManager.setStreamMonitorInterval(interval);
}

function stopLocalStreamMonitor() {
  uiManager.clearStreamMonitorInterval();
}

// After RESTORE_PARTY and PARTY_STARTED, attempt to restore playback state
// captured before navigation so the refreshed tab doesn't start from 0.
function tryRestorePlaybackState() {
  const restorationState = urlSync.getRestorationState();
  if (!restorationState || restorationState.currentTime == null) return;

  const targetSeconds = restorationState.currentTime;
  const shouldPlay = typeof restorationState.isPlaying === 'boolean' ? restorationState.isPlaying : null;

  // Clear the restoration state so we don't re-apply on subsequent operations
  urlSync.clearState();

  // Apply a local, non-broadcast correction using NetflixController
  netflixController.getCurrentTime()
    .then((ms) => {
      const currentSeconds = ms != null ? ms / 1000 : 0;
      const drift = Math.abs(currentSeconds - targetSeconds);

      // Only correct if we're meaningfully off
      if (drift > 2) {
        console.log('[ContentScript] Restoring playback position after navigation from', currentSeconds, 'to', targetSeconds);
        return netflixController.seek(targetSeconds * 1000);
      }
    })
    .then(() => {
      if (shouldPlay === null) return;
      return netflixController.isPaused().then((paused) => {
        if (shouldPlay && paused) {
          console.log('[ContentScript] Resuming playback after navigation');
          return netflixController.play();
        }
        if (!shouldPlay && !paused) {
          console.log('[ContentScript] Pausing playback after navigation');
          return netflixController.pause();
        }
      });
    })
    .catch((e) => {
      console.warn('[ContentScript] Failed to restore playback state after navigation:', e);
    });
}

function addOrReplaceTrack(pc, track, stream) {
  const senders = pc.getSenders();
  const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
  if (existingSender) {
    existingSender.replaceTrack(track).catch(e => console.warn('Error replacing track', e));
  } else {
    try {
      pc.addTrack(track, stream);
    } catch (e) {
      console.warn('Error adding track', e);
    }
  }
}

// WebRTC signaling and connection details now live in WebRTCManager
