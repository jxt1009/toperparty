import { StateManager } from '../managers/state/StateManager.js';
import { NetflixController } from './netflix/NetflixController.js';
import { SyncManager } from '../managers/sync/SyncManager.js';
import { WebRTCManager } from '../services/webrtc/WebRTCManager.js';
import { UIManager } from '../ui/UIManager.js';
import { URLSync } from '../managers/url/URLSync.js';

console.log('[Content Script] Initializing managers...');
const stateManager = new StateManager();
const uiManager = new UIManager();
const netflixController = new NetflixController();
const syncManager = new SyncManager(stateManager, netflixController);
const webrtcManager = new WebRTCManager(stateManager, uiManager);

// Callback when we navigate to a different /watch page
const handleWatchPageChange = () => {
  console.log('[Content Script] Watch page changed - reinitializing sync manager');
  syncManager.teardown();
  syncManager.setup().catch(err => {
    console.error('[Content Script] Failed to reinitialize sync manager:', err);
  });
};

const urlSync = new URLSync(stateManager, handleWatchPageChange);
console.log('[Content Script] Managers initialized');

let localStream = null;
let videoElementMonitor = null;

// Monitor and restore video elements if they get removed during navigation
function startVideoElementMonitoring() {
  if (videoElementMonitor) return;
  
  videoElementMonitor = setInterval(() => {
    const state = stateManager.getState();
    if (!state.partyActive) return;
    
    // Check if local preview exists
    if (localStream && !document.getElementById('toperparty-local-preview')) {
      console.log('[Content Script] Local preview missing, re-attaching');
      uiManager.attachLocalPreview(localStream);
    }
    
    // Check if remote videos exist
    const remoteVideos = uiManager.getRemoteVideos();
    const remoteStreams = uiManager.getRemoteStreams();
    remoteStreams.forEach((stream, peerId) => {
      const videoId = 'toperparty-remote-' + peerId;
      if (!document.getElementById(videoId)) {
        console.log('[Content Script] Remote video missing for peer:', peerId, 're-adding');
        const videoManager = webrtcManager.videoManager;
        if (videoManager && videoManager.add) {
          videoManager.add(peerId, stream);
        }
      }
    });
  }, 1000); // Check every second
  
  console.log('[Content Script] Started video element monitoring');
}

function stopVideoElementMonitoring() {
  if (videoElementMonitor) {
    clearInterval(videoElementMonitor);
    videoElementMonitor = null;
    console.log('[Content Script] Stopped video element monitoring');
  }
}

(function checkRestorePartyState() {
  const restorationState = urlSync.getRestorationState();
  if (restorationState) {
    console.log('[Content Script] Restoring party state for room:', restorationState.roomId);
    urlSync.clearState();
    stateManager.setRestoringFlag(true);
    
    setTimeout(function() {
      console.log('[Content Script] Sending RESTORE_PARTY message');
      chrome.runtime.sendMessage({ type: 'RESTORE_PARTY', roomId: restorationState.roomId }, (response) => {
        if (response && response.success) {
          console.log('[Content Script] Party restoration successful - media stream and sync will be re-initialized');
        } else {
          console.error('[Content Script] Party restoration failed:', response ? response.error : 'Unknown error');
        }
        setTimeout(function() {
          stateManager.setRestoringFlag(false);
        }, 2000);
      });
    }, 1000);
  }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content Script] Received message:', request.type);
  if (request.type === 'REQUEST_MEDIA_STREAM') {
    console.log('[Content Script] Processing REQUEST_MEDIA_STREAM');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log('[Content Script] Media stream obtained, tracks:', stream.getTracks().length);
        localStream = stream;
        console.log('[Content Script] Setting local stream on WebRTC manager');
        webrtcManager.setLocalStream(stream);
        webrtcManager.onLocalStreamAvailable(stream);
        console.log('[Content Script] Attaching local preview to UI');
        uiManager.attachLocalPreview(stream);
        console.log('[Content Script] Local preview attached, sending success response');
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[Content Script] Failed to get media stream:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.type === 'PARTY_STARTED') {
    console.log('[Content Script] Party started:', request.userId, request.roomId);
    stateManager.startParty(request.userId, request.roomId);
    
    // Teardown existing sync manager if already set up
    syncManager.teardown();
    
    // Setup sync manager (will wait for video element)
    syncManager.setup().catch(err => {
      console.error('[Content Script] Failed to setup sync manager:', err);
    });
    
    urlSync.start();
    startVideoElementMonitoring();
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    console.log('[Content Script] Stopping party');
    stopVideoElementMonitoring();
    stateManager.stopParty();
    syncManager.teardown();
    urlSync.stop();
    urlSync.clearState();
    webrtcManager.clearAll();
    uiManager.removeLocalPreview();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    sendResponse({ success: true });
  }

  if (request.type === 'SIGNAL') {
    console.log('[Content Script] Handling SIGNAL:', request.message?.type);
    webrtcManager.handleSignal(request.message);
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    console.log('[Content Script] Applying playback control:', request.control, 'at', request.currentTime, 'from', request.fromUserId);
    syncManager.handlePlaybackControl(request.control, request.currentTime, request.fromUserId);
  }

  // Passive sync removed - using event-based sync only

  if (request.type === 'APPLY_SEEK') {
    syncManager.handleSeek(request.currentTime, request.isPlaying, request.fromUserId);
  }

  if (request.type === 'APPLY_URL_CHANGE') {
    console.log('[Content Script] Received URL change request:', request.url, 'from', request.fromUserId);
    
    if (stateManager.restoringPartyState) {
      console.log('[Content Script] Ignoring URL change - currently restoring party state');
      return;
    }
    
    // Only apply URL changes to /watch pages
    const incomingUrl = new URL(request.url);
    const currentPath = window.location.pathname;
    const isOnWatch = currentPath.startsWith('/watch');
    const incomingIsWatch = incomingUrl.pathname.startsWith('/watch');
    
    if (!incomingIsWatch) {
      console.log('[Content Script] Ignoring URL change - incoming URL is not a /watch page:', incomingUrl.pathname);
      return;
    }
    
    if (!isOnWatch) {
      console.log('[Content Script] Ignoring URL change - not currently on a /watch page (on:', currentPath + ')');
      return;
    }
    
    console.log('[Content Script] Navigating to new watch page:', request.url);
    // Save state before navigating
    urlSync.saveState();
    window.location.href = request.url;
  }

  if (request.type === 'HANDLE_REQUEST_SYNC') {
    syncManager.handleRequestSync(request.fromUserId);
  }

  if (request.type === 'APPLY_SYNC_RESPONSE') {
    console.log('[Content Script] Applying sync response from', request.fromUserId, 'URL:', request.url);
    syncManager.handleSyncResponse(request.currentTime, request.isPlaying, request.fromUserId, request.url);
  }

  if (request.type === 'RESET_SYNC') {
    console.log('[Content Script] Resetting sync manager - someone joined the party');
    syncManager.teardown();
    syncManager.setup().catch(err => {
      console.error('[Content Script] Failed to reset sync manager:', err);
    });
  }
});

window.addEventListener('beforeunload', () => {
  if (stateManager.isActive()) {
    urlSync.saveState();
  }
});
