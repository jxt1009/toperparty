import { StateManager } from '../managers/state/StateManager.js';
import { NetflixController } from './netflix/NetflixController.js';
import { SyncManager } from '../managers/sync/SyncManager.js';
import { WebRTCManager } from '../services/webrtc/WebRTCManager.js';
import { UIManager } from '../ui/UIManager.js';
import { URLSync } from '../managers/url/URLSync.js';

const stateManager = new StateManager();
const uiManager = new UIManager();
const netflixController = new NetflixController();
const syncManager = new SyncManager(stateManager, netflixController);
const webrtcManager = new WebRTCManager(stateManager, uiManager);
const urlSync = new URLSync(stateManager);

let localStream = null;

(function checkRestorePartyState() {
  const restorationState = urlSync.getRestorationState();
  if (restorationState) {
    urlSync.clearState();
    stateManager.setRestoringFlag(true);
    setTimeout(function() {
      chrome.runtime.sendMessage({ type: 'RESTORE_PARTY', roomId: restorationState.roomId });
      setTimeout(function() {
        stateManager.setRestoringFlag(false);
      }, 2000);
    }, 1000);
  }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REQUEST_MEDIA_STREAM') {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        localStream = stream;
        webrtcManager.setLocalStream(stream);
        webrtcManager.onLocalStreamAvailable(stream);
        sendResponse({ success: true });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'PARTY_STARTED') {
    stateManager.startParty(request.userId, request.roomId);
    syncManager.setup();
    urlSync.start();
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    stateManager.stopParty();
    syncManager.teardown();
    urlSync.stop();
    urlSync.clearState();
    webrtcManager.clearAll();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    sendResponse({ success: true });
  }

  if (request.type === 'SIGNAL') {
    webrtcManager.handleSignal(request.message);
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    syncManager.handlePlaybackControl(request.control, request.fromUserId);
  }

  if (request.type === 'APPLY_SYNC_PLAYBACK') {
    syncManager.handlePassiveSync(request.currentTime, request.isPlaying, request.fromUserId, request.timestamp);
  }

  if (request.type === 'APPLY_SEEK') {
    syncManager.handleSeek(request.currentTime, request.isPlaying, request.fromUserId);
  }

  if (request.type === 'APPLY_URL_CHANGE') {
    if (!stateManager.restoringPartyState) {
      window.location.href = request.url;
    }
  }

  if (request.type === 'HANDLE_REQUEST_SYNC') {
    syncManager.handleRequestSync(request.fromUserId);
  }

  if (request.type === 'APPLY_SYNC_RESPONSE') {
    syncManager.handleSyncResponse(request.currentTime, request.isPlaying, request.fromUserId);
  }
});

window.addEventListener('beforeunload', () => {
  if (stateManager.isActive()) {
    urlSync.saveState();
  }
});
