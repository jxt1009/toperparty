/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./chrome-extension/modules/netflix-controller.js":
/*!********************************************************!*\
  !*** ./chrome-extension/modules/netflix-controller.js ***!
  \********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NetflixController: () => (/* binding */ NetflixController)
/* harmony export */ });
// netflix-controller.js - Netflix player API wrapper

class NetflixController {
  constructor() {
    this.injectAPIBridge();
  }
  
  // Inject Netflix API access script into page context
  injectAPIBridge() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('netflix-api-bridge.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = function() {
      console.log('Netflix API bridge loaded');
      script.remove();
    };
  }
  
  // Send command to Netflix API via custom events
  _sendCommand(command, args = []) {
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
  }
  
  play() {
    return this._sendCommand('play');
  }
  
  pause() {
    return this._sendCommand('pause');
  }
  
  seek(timeMs) {
    return this._sendCommand('seek', [timeMs]);
  }
  
  getCurrentTime() {
    return this._sendCommand('getCurrentTime');
  }
  
  isPaused() {
    return this._sendCommand('isPaused');
  }
  
  // Find Netflix video element (fallback)
  getVideoElement() {
    return document.querySelector('video');
  }
}


/***/ }),

/***/ "./chrome-extension/modules/state-manager.js":
/*!***************************************************!*\
  !*** ./chrome-extension/modules/state-manager.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   StateManager: () => (/* binding */ StateManager)
/* harmony export */ });
// state-manager.js - Manages party state and action tracking

class StateManager {
  constructor() {
    // Party state
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    this.restoringPartyState = false;
    
    // Action tracking for echo prevention
    this.lastLocalAction = { type: null, time: 0 };
    this.lastRemoteAction = { type: null, time: 0 };
  }
  
  // Party state management
  startParty(userId, roomId) {
    this.partyActive = true;
    this.userId = userId;
    this.roomId = roomId;
    console.log('Party started! Room:', roomId, 'User:', userId);
  }
  
  stopParty() {
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    this.lastLocalAction = { type: null, time: 0 };
    this.lastRemoteAction = { type: null, time: 0 };
    console.log('Party stopped');
  }
  
  isActive() {
    return this.partyActive;
  }
  
  getUserId() {
    return this.userId;
  }
  
  getRoomId() {
    return this.roomId;
  }
  
  getState() {
    return {
      partyActive: this.partyActive,
      userId: this.userId,
      roomId: this.roomId,
      restoringPartyState: this.restoringPartyState
    };
  }
  
  setRestoringFlag(value) {
    this.restoringPartyState = value;
  }
  
  // Echo prevention helpers
  isEcho(actionType) {
    const now = Date.now();
    const timeSinceLocal = now - this.lastLocalAction.time;
    
    // If we just performed this action within 500ms, it's likely an echo
    if (this.lastLocalAction.type === actionType && timeSinceLocal < 500) {
      console.log(`Ignoring echo of ${actionType} (${timeSinceLocal}ms ago)`);
      return true;
    }
    return false;
  }
  
  recordLocalAction(actionType) {
    this.lastLocalAction = { type: actionType, time: Date.now() };
    console.log(`Recorded local action: ${actionType}`);
  }
  
  recordRemoteAction(actionType) {
    this.lastRemoteAction = { type: actionType, time: Date.now() };
    console.log(`Recorded remote action: ${actionType}`);
  }
  
  getTimeSinceLocalAction() {
    return Date.now() - this.lastLocalAction.time;
  }
  
  getTimeSinceRemoteAction() {
    return Date.now() - this.lastRemoteAction.time;
  }
  
  // Extension context validation
  isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }
  
  // Safe message sending
  safeSendMessage(message, callback) {
    if (!this.isExtensionContextValid()) {
      console.warn('Extension context invalidated - please reload the page');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.warn('Failed to send message, extension may have been reloaded:', e.message);
    }
  }
}


/***/ }),

/***/ "./chrome-extension/modules/sync-manager.js":
/*!**************************************************!*\
  !*** ./chrome-extension/modules/sync-manager.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SyncManager: () => (/* binding */ SyncManager)
/* harmony export */ });
// sync-manager.js - Handles playback synchronization
// Rebuilt with simple, reliable logic to prevent feedback loops

class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;
    this.listeners = null;
    this.syncInterval = null;
    this.suppressBroadcast = false; // Flag to suppress broadcasting when we control video programmatically
  }
  
  // Setup playback synchronization
  async setup() {
    try {
      const video = await this.waitForVideo();
      if (!video) {
        console.warn('Netflix video element not found after wait');
        return;
      }
      
      this.attachEventListeners(video);
      this.startPeriodicSync(video);
      
      console.log('Playback sync setup complete');
    } catch (err) {
      console.error('Error setting up playback sync:', err);
    }
  }
  
  // Wait for Netflix video element to appear
  waitForVideo() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video element timeout')), 10000);
      
      const check = () => {
        const video = this.netflix.getVideoElement();
        if (video) {
          clearTimeout(timeout);
          resolve(video);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }
  
  // Attach event listeners to video element
  attachEventListeners(video) {
    // Play event - broadcast to peers ONLY if it's a user action
    const onPlay = () => {
      console.log('[Play event] Fired - suppressBroadcast:', this.suppressBroadcast, 'partyActive:', this.state.isActive());
      
      if (!this.state.isActive()) return;
      
      // If we're programmatically controlling, don't broadcast
      if (this.suppressBroadcast) {
        console.log('[Play event] ✓ Suppressed - programmatic control');
        return;
      }
      
      console.log('[Play event] ✓ User action - broadcasting to peers');
      this.state.safeSendMessage({ 
        type: 'PLAY_PAUSE', 
        control: 'play', 
        timestamp: video.currentTime 
      });
    };
    
    // Pause event - broadcast to peers ONLY if it's a user action
    const onPause = () => {
      console.log('[Pause event] Fired - suppressBroadcast:', this.suppressBroadcast, 'partyActive:', this.state.isActive());
      
      if (!this.state.isActive()) return;
      
      // If we're programmatically controlling, don't broadcast
      if (this.suppressBroadcast) {
        console.log('[Pause event] ✓ Suppressed - programmatic control');
        return;
      }
      
      console.log('[Pause event] ✓ User action - broadcasting to peers');
      this.state.safeSendMessage({ 
        type: 'PLAY_PAUSE', 
        control: 'pause', 
        timestamp: video.currentTime 
      });
    };
    
    // Seek event - broadcast to peers ONLY if it's a user action
    const onSeeked = () => {
      const currentTime = video.currentTime;
      console.log('[Seeked event] Fired - suppressBroadcast:', this.suppressBroadcast, 'partyActive:', this.state.isActive(), 'time:', currentTime);
      
      if (!this.state.isActive()) return;
      
      // If we're programmatically controlling, don't broadcast
      if (this.suppressBroadcast) {
        console.log('[Seeked event] ✓ Suppressed - programmatic control');
        return;
      }
      
      console.log('[Seeked event] ✓ User action - broadcasting to peers');
      this.state.safeSendMessage({ 
        type: 'SEEK', 
        currentTime: video.currentTime, 
        isPlaying: !video.paused 
      });
    };
    
    // Passive sync via timeupdate - send position periodically for drift correction
    let lastSentAt = 0;
    const onTimeUpdate = () => {
      if (!this.state.isActive()) return;
      
      const now = Date.now();
      if (now - lastSentAt < 2000) return; // throttle to every 2s
      lastSentAt = now;
      
      // Send passive sync (other clients will decide if they need to correct)
      this.state.safeSendMessage({ 
        type: 'SYNC_TIME', 
        currentTime: video.currentTime, 
        isPlaying: !video.paused,
        timestamp: now
      });
    };
    
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('timeupdate', onTimeUpdate);
    
    // Save references for teardown
    this.listeners = { onPlay, onPause, onSeeked, onTimeUpdate, video };
  }
  
  // Periodic fallback sync (every 10 seconds)
  startPeriodicSync(video) {
    this.syncInterval = setInterval(() => {
      if (!this.state.isActive() || !video) return;
      
      const now = Date.now();
      this.state.safeSendMessage({ 
        type: 'SYNC_TIME', 
        currentTime: video.currentTime, 
        isPlaying: !video.paused,
        timestamp: now
      });
    }, 10000);
  }
  
  // Teardown playback synchronization
  teardown() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    if (this.listeners && this.listeners.video) {
      const { video, onPlay, onPause, onSeeked, onTimeUpdate } = this.listeners;
      try {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('timeupdate', onTimeUpdate);
      } catch (e) {
        console.warn('Error removing video event listeners:', e);
      }
      this.listeners = null;
    }
  }
  
  // Execute an action with broadcast suppression
  async executeWithSuppression(actionFn) {
    this.suppressBroadcast = true;
    try {
      await actionFn();
    } finally {
      // Keep suppression for a brief moment to ensure all events are caught
      setTimeout(() => {
        this.suppressBroadcast = false;
      }, 100);
    }
  }
  
  // Handle remote playback control commands (explicit play/pause)
  async handlePlaybackControl(control, fromUserId) {
    console.log('[Remote command] Received', control, 'from', fromUserId);
    console.log('[Remote command] Setting suppressBroadcast=true');
    
    await this.executeWithSuppression(async () => {
      if (control === 'play') {
        console.log('[Remote command] Executing play()...');
        await this.netflix.play();
        console.log('[Remote command] Play completed');
      } else if (control === 'pause') {
        console.log('[Remote command] Executing pause()...');
        await this.netflix.pause();
        console.log('[Remote command] Pause completed');
      }
    });
    
    console.log('[Remote command] suppressBroadcast=false (after 100ms delay)');
  }
  
  // Handle remote seek commands (explicit seek)
  async handleSeek(currentTime, isPlaying, fromUserId) {
    console.log('[Remote command] Received SEEK to', currentTime, 's from', fromUserId, 'isPlaying:', isPlaying);
    console.log('[Remote command] Setting suppressBroadcast=true');
    
    const requestedTime = currentTime * 1000; // Convert to ms
    
    await this.executeWithSuppression(async () => {
      console.log('[Remote command] Executing seek(' + requestedTime + 'ms)...');
      await this.netflix.seek(requestedTime);
      console.log('[Remote command] Seek completed');
      
      // Also sync play/pause state
      const isPaused = await this.netflix.isPaused();
      console.log('[Remote command] Current state - isPaused:', isPaused);
      
      if (isPlaying && isPaused) {
        console.log('[Remote command] Need to resume - executing play()...');
        await this.netflix.play();
        console.log('[Remote command] Resumed after seek');
      } else if (!isPlaying && !isPaused) {
        console.log('[Remote command] Need to pause - executing pause()...');
        await this.netflix.pause();
        console.log('[Remote command] Paused after seek');
      }
    });
    
    console.log('[Remote command] suppressBroadcast=false (after 100ms delay)');
  }
  
  // Handle passive sync (drift correction only)
  async handlePassiveSync(currentTime, isPlaying, fromUserId, messageTimestamp) {
    // DISABLED FOR NOW - Let's get explicit commands working first
    console.log('[Passive sync] Disabled - use explicit commands only');
    return;
    
    /* 
    // Ignore stale messages (older than 5 seconds)
    if (messageTimestamp) {
      const messageAge = Date.now() - messageTimestamp;
      if (messageAge > 5000) {
        console.log('[Passive sync] Ignoring stale message - age:', (messageAge / 1000).toFixed(1), 's');
        return;
      }
    }
    
    try {
      const localTime = await this.netflix.getCurrentTime();
      const requestedTime = currentTime * 1000; // Convert to ms
      const timeDiff = Math.abs(localTime - requestedTime);
      
      // Only correct significant drift (>10 seconds)
      // Passive sync is ONLY for fixing real problems, not micro-adjustments
      if (timeDiff > 10000) {
        console.log('[Passive sync] Large drift detected:', (timeDiff / 1000).toFixed(1), 's - correcting');
        
        await this.executeWithSuppression(async () => {
          await this.netflix.seek(requestedTime);
        });
      }
      
      // Sync play/pause state only if significantly out of sync
      const isPaused = await this.netflix.isPaused();
      
      if (isPlaying !== !isPaused) {
        console.log('[Passive sync] Play/pause state mismatch - correcting');
        
        await this.executeWithSuppression(async () => {
          if (isPlaying && isPaused) {
            await this.netflix.play();
          } else if (!isPlaying && !isPaused) {
            await this.netflix.pause();
          }
        });
      }
    } catch (err) {
      console.error('[Passive sync] Error:', err);
    }
    */
  }
}


/***/ }),

/***/ "./chrome-extension/modules/ui-manager.js":
/*!************************************************!*\
  !*** ./chrome-extension/modules/ui-manager.js ***!
  \************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   UIManager: () => (/* binding */ UIManager)
/* harmony export */ });
// ui-manager.js - Manages UI components (preview videos)
// Note: Keeping this simple for now, full extraction in future refactor

class UIManager {
  constructor() {
    this.localPreviewVideo = null;
    this.remoteVideos = new Map();
    this.remoteStreams = new Map();
    this.streamMonitorInterval = null;
  }
  
  getRemoteVideos() {
    return this.remoteVideos;
  }
  
  getRemoteStreams() {
    return this.remoteStreams;
  }
  
  setLocalPreviewVideo(video) {
    this.localPreviewVideo = video;
  }
  
  getLocalPreviewVideo() {
    return this.localPreviewVideo;
  }
  
  setStreamMonitorInterval(interval) {
    this.streamMonitorInterval = interval;
  }
  
  getStreamMonitorInterval() {
    return this.streamMonitorInterval;
  }
  
  clearStreamMonitorInterval() {
    if (this.streamMonitorInterval) {
      clearInterval(this.streamMonitorInterval);
      this.streamMonitorInterval = null;
    }
  }
  
  clearAll() {
    this.localPreviewVideo = null;
    this.remoteVideos.clear();
    this.remoteStreams.clear();
    this.clearStreamMonitorInterval();
  }
}


/***/ }),

/***/ "./chrome-extension/modules/url-sync.js":
/*!**********************************************!*\
  !*** ./chrome-extension/modules/url-sync.js ***!
  \**********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   URLSync: () => (/* binding */ URLSync)
/* harmony export */ });
// url-sync.js - Manages URL monitoring and party state persistence
// Note: Keeping this simple for now, full extraction in future refactor

class URLSync {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.urlMonitorInterval = null;
    this.lastUrl = null;
  }
  
  start() {
    this.lastUrl = window.location.href;
    // URL monitoring logic will be moved here in full extraction
  }
  
  stop() {
    if (this.urlMonitorInterval) {
      clearInterval(this.urlMonitorInterval);
      this.urlMonitorInterval = null;
    }
  }
  
  saveState() {
    // Party state persistence logic will be moved here
    const state = this.stateManager.getState();
    if (state.partyActive) {
      sessionStorage.setItem('toperparty_restore', JSON.stringify({
        userId: state.userId,
        roomId: state.roomId,
        timestamp: Date.now()
      }));
    }
  }
  
  clearState() {
    sessionStorage.removeItem('toperparty_restore');
  }
  
  getRestorationState() {
    const stored = sessionStorage.getItem('toperparty_restore');
    if (!stored) return null;
    
    try {
      const state = JSON.parse(stored);
      // Check if restoration state is recent (within 30 seconds)
      if (Date.now() - state.timestamp < 30000) {
        return state;
      }
    } catch (e) {
      console.error('[toperparty] Failed to parse restoration state:', e);
    }
    
    return null;
  }
}


/***/ }),

/***/ "./chrome-extension/modules/webrtc-manager.js":
/*!****************************************************!*\
  !*** ./chrome-extension/modules/webrtc-manager.js ***!
  \****************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   WebRTCManager: () => (/* binding */ WebRTCManager)
/* harmony export */ });
// webrtc-manager.js - Manages WebRTC peer connections
// Note: This is a large module that handles peer connections, signaling, and reconnection logic
// For now, keeping the core WebRTC functionality in the main file to avoid breaking changes
// TODO: Extract this properly in a future refactor

class WebRTCManager {
  constructor(stateManager) {
    this.state = stateManager;
    this.peerConnections = new Map();
    this.reconnectionAttempts = new Map();
    this.reconnectionTimeouts = new Map();
    this.localStream = null;
  }
  
  setLocalStream(stream) {
    this.localStream = stream;
  }
  
  getLocalStream() {
    return this.localStream;
  }
  
  getPeerConnections() {
    return this.peerConnections;
  }
  
  getReconnectionAttempts() {
    return this.reconnectionAttempts;
  }
  
  getReconnectionTimeouts() {
    return this.reconnectionTimeouts;
  }
  
  clearAll() {
    // Close all peer connections
    this.peerConnections.forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    this.peerConnections.clear();
    
    // Clear reconnection state
    this.reconnectionTimeouts.forEach((timeoutHandle) => {
      clearTimeout(timeoutHandle);
    });
    this.reconnectionTimeouts.clear();
    this.reconnectionAttempts.clear();
    
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!********************************************!*\
  !*** ./chrome-extension/content-script.js ***!
  \********************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _modules_state_manager_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./modules/state-manager.js */ "./chrome-extension/modules/state-manager.js");
/* harmony import */ var _modules_netflix_controller_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./modules/netflix-controller.js */ "./chrome-extension/modules/netflix-controller.js");
/* harmony import */ var _modules_sync_manager_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./modules/sync-manager.js */ "./chrome-extension/modules/sync-manager.js");
/* harmony import */ var _modules_webrtc_manager_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./modules/webrtc-manager.js */ "./chrome-extension/modules/webrtc-manager.js");
/* harmony import */ var _modules_ui_manager_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./modules/ui-manager.js */ "./chrome-extension/modules/ui-manager.js");
/* harmony import */ var _modules_url_sync_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./modules/url-sync.js */ "./chrome-extension/modules/url-sync.js");
// content-script.js - Modular version with ES6 imports








// Initialize managers
const stateManager = new _modules_state_manager_js__WEBPACK_IMPORTED_MODULE_0__.StateManager();
const netflixController = new _modules_netflix_controller_js__WEBPACK_IMPORTED_MODULE_1__.NetflixController();
const syncManager = new _modules_sync_manager_js__WEBPACK_IMPORTED_MODULE_2__.SyncManager(stateManager, netflixController);
const webrtcManager = new _modules_webrtc_manager_js__WEBPACK_IMPORTED_MODULE_3__.WebRTCManager();
const uiManager = new _modules_ui_manager_js__WEBPACK_IMPORTED_MODULE_4__.UIManager();
const urlSync = new _modules_url_sync_js__WEBPACK_IMPORTED_MODULE_5__.URLSync(stateManager);

// WebRTC variables (keeping these in main file for now)
let localStream = null;
const peerConnections = webrtcManager.peerConnections;
const remoteVideos = uiManager.getRemoteVideos();
const remoteStreams = uiManager.getRemoteStreams();
const reconnectionAttempts = webrtcManager.reconnectionAttempts;
const reconnectionTimeouts = webrtcManager.reconnectionTimeouts;

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
  const state = stateManager.getState();
  
  // Save party state whenever URL is about to change (for hard navigations)
  window.addEventListener('beforeunload', function savePartyStateBeforeUnload() {
    if (state.partyActive && state.userId && state.roomId) {
      urlSync.saveState();
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
    stateManager.startParty(request.userId, request.roomId);
    console.log('Party started! Room:', request.roomId, 'User:', request.userId);
    
    // Start monitoring URL changes
    startUrlMonitoring();
    
    // Setup playback sync
    syncManager.setup();
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
      urlSync.saveState();
      console.log('Saved party state before navigation');
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

// --- WebRTC signaling helpers ---

function sendSignal(message) {
  stateManager.safeSendMessage({ type: 'SIGNAL_SEND', message }, function(resp) {
    // optionally handle response
  });
}

async function handleSignalingMessage(message) {
  if (!message || !message.type) return;
  const type = message.type;
  const from = message.userId || message.from;
  const to = message.to;
  const state = stateManager.getState();

  // Ignore messages not for us (if addressed)
  if (to && to !== state.userId) return;

  if (type === 'JOIN' && from && from !== state.userId) {
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
        sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
      } catch (err) {
        console.error('Error handling JOIN and creating offer:', err);
        peerConnections.delete(from);
      }
    }
    return;
  }

  if (type === 'OFFER' && message.offer && from && from !== state.userId) {
    // Received an offer from a peer
    let pc = peerConnections.get(from);
    
    // If connection exists, check if we need to recreate it
    if (pc) {
      const pcState = pc.signalingState;
      // Close and recreate if in any non-stable, non-closed state
      // OR if stable (renegotiation scenario - safer to recreate)
      if (pcState !== 'closed') {
        console.log('[WebRTC] Received new offer while in state:', pcState, '- recreating connection for', from);
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
      sendSignal({ type: 'ANSWER', from: state.userId, to: from, answer: pc.localDescription });
    } catch (err) {
      console.error('Error handling offer:', err);
      // Clean up failed connection
      peerConnections.delete(from);
      try { pc.close(); } catch (e) {}
    }
    return;
  }  if (type === 'ANSWER' && message.answer && from && from !== state.userId) {
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

  if (type === 'ICE_CANDIDATE' && message.candidate && from && from !== state.userId) {
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
  const state = stateManager.getState();
  if (!state.partyActive || !state.userId || !state.roomId) {
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
      sendSignal({ type: 'OFFER', from: state.userId, to: peerId, offer: pc.localDescription });
      
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
  const state = stateManager.getState();
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['stun:stun1.l.google.com:19302'] }
    ]
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: 'ICE_CANDIDATE', from: state.userId, to: peerId, candidate: event.candidate });
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

})();

/******/ })()
;
//# sourceMappingURL=content-script.js.map