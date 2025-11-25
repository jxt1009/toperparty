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

   // Convenience: are we currently in a valid party session?
  isInParty() {
    return !!(this.partyActive && this.userId && this.roomId);
  }
  
  setRestoringFlag(value) {
    this.restoringPartyState = value;
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
// sync-manager.js - Robust, debounced playback synchronization

class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;

    this.listeners = null;

    // Suppression system: Timestamp until which local events are ignored
    // Used to prevent echo when applying remote commands or during initialization
    this.suppressLocalUntil = 0;

    // Debounce system: Coalesce rapid events (e.g. pause+seek+play) into one broadcast
    this.debounceTimer = null;
    this.recentLocalEvents = new Set();
    
    // Context for passive sync
    this.lastUserInteractionAt = 0;
  }

  // ---- Public lifecycle -------------------------------------------------

  async setup() {
    try {
      const video = await this.waitForVideo();
      if (!video) {
        console.warn('[SyncManager] Netflix video element not found');
        return;
      }

      // Startup Grace Period: Ignore all local events for 3 seconds
      // This prevents the initial "seek to 0" or auto-play from broadcasting
      // and allows the restore logic to do its job without interference.
      this.suppressLocalUntil = Date.now() + 3000;

      this.attachEventListeners(video);
      console.log('[SyncManager] Setup complete. Local events suppressed for 3s.');
    } catch (err) {
      console.error('[SyncManager] Error setting up playback sync:', err);
    }
  }

  teardown() {
    if (this.listeners && this.listeners.video) {
      const { video, handleLocalEvent, handleTimeUpdate } = this.listeners;
      try {
        video.removeEventListener('play', handleLocalEvent);
        video.removeEventListener('pause', handleLocalEvent);
        video.removeEventListener('seeked', handleLocalEvent);
        video.removeEventListener('timeupdate', handleTimeUpdate);
      } catch (e) {
        console.warn('[SyncManager] Error removing listeners:', e);
      }
      this.listeners = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ---- DOM wiring -------------------------------------------------------

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

  attachEventListeners(video) {
    // Unified handler for user interactions
    const handleLocalEvent = (e) => {
      if (!this.state.isActive()) return;

      const now = Date.now();
      if (now < this.suppressLocalUntil) {
        console.log(`[SyncManager] Suppressed local ${e.type} (lock active)`);
        return;
      }

      this.lastUserInteractionAt = now;
      this.recentLocalEvents.add(e.type);

      // Debounce: Wait for the dust to settle before broadcasting
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      this.debounceTimer = setTimeout(() => {
        this.broadcastLocalState(video);
      }, 200); // 200ms window to capture complex interactions like seek
    };

    // Passive sync sender
    let lastPassiveSentAt = 0;
    const handleTimeUpdate = () => {
      if (!this.state.isActive()) return;
      
      const now = Date.now();
      // Don't send if we are currently suppressing local events (remote command active)
      if (now < this.suppressLocalUntil) return;
      
      // Don't send if user recently interacted (let the explicit events handle it)
      if (now - this.lastUserInteractionAt < 5000) return;

      // Rate limit: once every 10s
      if (now - lastPassiveSentAt < 10000) return;

      if (video.paused) return; // Only sync while playing

      lastPassiveSentAt = now;
      const payload = {
        type: 'SYNC_TIME',
        currentTime: video.currentTime,
        isPlaying: !video.paused,
        timestamp: now,
      };
      console.log('[SyncManager] Sending passive sync:', payload.currentTime.toFixed(2));
      this.state.safeSendMessage(payload);
    };

    video.addEventListener('play', handleLocalEvent);
    video.addEventListener('pause', handleLocalEvent);
    video.addEventListener('seeked', handleLocalEvent);
    video.addEventListener('timeupdate', handleTimeUpdate);

    this.listeners = { video, handleLocalEvent, handleTimeUpdate };
  }

  broadcastLocalState(video) {
    const events = this.recentLocalEvents;
    this.recentLocalEvents = new Set();
    this.debounceTimer = null;

    const currentTime = video.currentTime;
    const isPlaying = !video.paused;

    // Priority: Seek > Play/Pause
    if (events.has('seeked')) {
      console.log('[SyncManager] Broadcasting SEEK:', currentTime.toFixed(2));
      this.state.safeSendMessage({ 
        type: 'SEEK', 
        currentTime, 
        isPlaying 
      });
    } else if (events.has('play') || events.has('pause')) {
      const control = isPlaying ? 'play' : 'pause';
      console.log('[SyncManager] Broadcasting PLAY_PAUSE:', control);
      this.state.safeSendMessage({ 
        type: 'PLAY_PAUSE', 
        control, 
        timestamp: currentTime 
      });
    }
  }

  // ---- Remote Command Handlers ------------------------------------------

  // Helper to lock local events while applying remote changes
  async _applyRemoteAction(actionName, lockDurationMs, actionFn) {
    console.log(`[SyncManager] Applying remote ${actionName}...`);
    
    // Set lock
    this.suppressLocalUntil = Date.now() + lockDurationMs;
    
    try {
      await actionFn();
    } catch (err) {
      console.error(`[SyncManager] Error applying remote ${actionName}:`, err);
    }
  }

  async handlePlaybackControl(control, fromUserId) {
    await this._applyRemoteAction(control, 1000, async () => {
      if (control === 'play') await this.netflix.play();
      else await this.netflix.pause();
    });
  }

  async handleSeek(currentTime, isPlaying, fromUserId) {
    await this._applyRemoteAction('seek', 2000, async () => {
      await this.netflix.seek(currentTime * 1000);
      
      // Ensure play state matches
      const isPaused = await this.netflix.isPaused();
      if (isPlaying && isPaused) await this.netflix.play();
      else if (!isPlaying && !isPaused) await this.netflix.pause();
    });
  }

  async handlePassiveSync(currentTime, isPlaying, fromUserId, timestamp) {
    const now = Date.now();
    
    // Ignore stale messages (>5s old)
    if (timestamp && (now - timestamp > 5000)) return;

    // Ignore if we recently interacted locally
    if (now - this.lastUserInteractionAt < 10000) {
      console.log('[SyncManager] Ignoring passive sync (recent local interaction)');
      return;
    }

    // Ignore if we are currently locked (applying another remote command)
    if (now < this.suppressLocalUntil) return;

    try {
      const localTimeMs = await this.netflix.getCurrentTime();
      const targetMs = currentTime * 1000;
      const driftMs = Math.abs(localTimeMs - targetMs);

      // Only correct if drift is significant (>3s)
      if (driftMs <= 3000) return;

      console.log(`[SyncManager] Drift detected (${(driftMs/1000).toFixed(2)}s). Correcting...`);

      // Apply correction without broadcasting back
      await this._applyRemoteAction('passive-correction', 1500, async () => {
        await this.netflix.seek(targetMs);
        
        const localPaused = await this.netflix.isPaused();
        if (isPlaying && localPaused) await this.netflix.play();
        else if (!isPlaying && !localPaused) await this.netflix.pause();
      });

    } catch (err) {
      console.error('[SyncManager] Error handling passive sync:', err);
    }
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
    const state = this.stateManager.getState();
    if (!state.partyActive) return;

    // Persist basic party info; playback state will be updated separately by content-script
    const existing = this.getRestorationState() || {};
    const payload = {
      userId: state.userId,
      roomId: state.roomId,
      // keep any playback info that may have been written just before navigation
      currentTime: existing.currentTime || null,
      isPlaying: typeof existing.isPlaying === 'boolean' ? existing.isPlaying : null,
      timestamp: Date.now()
    };

    sessionStorage.setItem('toperparty_restore', JSON.stringify(payload));
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
// webrtc-manager.js - Centralised WebRTC peer connection management for the content script

class WebRTCManager {
  constructor(stateManager, uiManager) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;

    this.peerConnections = new Map();
    this.reconnectionAttempts = new Map();
    this.reconnectionTimeouts = new Map();
    this.remoteStreams = this.uiManager.getRemoteStreams();
    this.remoteVideos = this.uiManager.getRemoteVideos();

    this.peersThatLeft = new Set();
    this.localStream = null;
  }

  // --- Local media ------------------------------------------------------

  setLocalStream(stream) {
    this.localStream = stream;
  }

  getLocalStream() {
    return this.localStream;
  }

  // Called when we obtain/refresh local media so we can attach to existing PCs
  onLocalStreamAvailable(stream) {
    this.localStream = stream;
    this.peerConnections.forEach((pc) => {
      try {
        stream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, stream));
      } catch (e) {
        console.warn('[WebRTCManager] Error adding tracks to peer connection', e);
      }
    });
  }

  // --- Signaling entrypoint --------------------------------------------

  async handleSignal(message) {
    if (!message || !message.type) return;

    const type = message.type;
    const from = message.userId || message.from;
    const to = message.to;
    const state = this.stateManager.getState();

    // Ignore messages not for us (if addressed)
    if (to && to !== state.userId) return;

    if (type === 'JOIN' && from && from !== state.userId) {
      // Another user joined the room — initiate P2P if we have local media
      this.peersThatLeft.delete(from);
      if (!this.peerConnections.has(from)) {
        try {
          const pc = this._createPeerConnection(from);
          this.peerConnections.set(from, pc);
          if (this.localStream) {
            this.localStream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, this.localStream));
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this._sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
        } catch (err) {
          console.error('[WebRTCManager] Error handling JOIN and creating offer:', err);
          this.peerConnections.delete(from);
        }
      }
      return;
    }

    if (type === 'OFFER' && message.offer && from && from !== state.userId) {
      let pc = this.peerConnections.get(from);

      if (pc) {
        const pcState = pc.signalingState;
        if (pcState !== 'closed') {
          console.log('[WebRTCManager] Received new offer while in state:', pcState, '- recreating connection for', from);
          try { pc.close(); } catch (e) {}
          this.peerConnections.delete(from);
          pc = null;
        }
      }

      if (!pc) {
        pc = this._createPeerConnection(from);
        this.peerConnections.set(from, pc);
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
        if (this.localStream) {
          this.localStream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, this.localStream));
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._sendSignal({ type: 'ANSWER', from: state.userId, to: from, answer: pc.localDescription });
      } catch (err) {
        console.error('[WebRTCManager] Error handling offer:', err);
        this.peerConnections.delete(from);
        try { pc.close(); } catch (e) {}
      }
      return;
    }

    if (type === 'ANSWER' && message.answer && from && from !== state.userId) {
      const pc = this.peerConnections.get(from);
      if (pc) {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
          } else {
            console.warn('[WebRTCManager] Received answer in unexpected state:', pc.signalingState);
          }
        } catch (err) {
          console.error('[WebRTCManager] Error handling answer:', err);
        }
      }
      return;
    }

    if (type === 'ICE_CANDIDATE' && message.candidate && from && from !== state.userId) {
      const pc = this.peerConnections.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch (err) {
          console.warn('[WebRTCManager] Error adding received ICE candidate', err);
        }
      }
      return;
    }

    if (type === 'LEAVE' && from) {
      this.peersThatLeft.add(from);
      const pc = this.peerConnections.get(from);
      if (pc) {
        try { pc.close(); } catch (e) {}
        this.peerConnections.delete(from);
      }
      this._clearReconnectionState(from);
      this._removeRemoteVideo(from);
      return;
    }
  }

  // --- Reconnection logic ----------------------------------------------

  async attemptReconnection(peerId) {
    const state = this.stateManager.getState();
    if (!this.stateManager.isInParty()) {
      console.log('[WebRTCManager] Cannot reconnect - party not active');
      return;
    }

    if (this.peersThatLeft.has(peerId)) {
      console.log('[WebRTCManager] Not attempting reconnection to peer that has explicitly left:', peerId);
      this._clearReconnectionState(peerId);
      return;
    }

    const attempts = this.reconnectionAttempts.get(peerId) || 0;
    const maxAttempts = 5;
    const backoffDelay = Math.min(1000 * Math.pow(2, attempts), 30000);

    if (attempts >= maxAttempts) {
      console.log('[WebRTCManager] Max reconnection attempts reached for', peerId);
      this.reconnectionAttempts.delete(peerId);
      this.reconnectionTimeouts.delete(peerId);
      return;
    }

    console.log(`[WebRTCManager] Attempting reconnection to ${peerId} (attempt ${attempts + 1}/${maxAttempts}) in ${backoffDelay}ms`);
    this.reconnectionAttempts.set(peerId, attempts + 1);

    const existingTimeout = this.reconnectionTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeoutHandle = setTimeout(async () => {
      console.log('[WebRTCManager] Reconnecting to', peerId);

      const oldPc = this.peerConnections.get(peerId);
      if (oldPc) {
        try { oldPc.close(); } catch (e) { console.warn('[WebRTCManager] Error closing old peer connection:', e); }
        this.peerConnections.delete(peerId);
      }

      try {
        const pc = this._createPeerConnection(peerId);
        this.peerConnections.set(peerId, pc);

        if (this.localStream) {
          this.localStream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, this.localStream));
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._sendSignal({ type: 'OFFER', from: state.userId, to: peerId, offer: pc.localDescription });

        console.log('[WebRTCManager] Reconnection offer sent to', peerId);
      } catch (err) {
        console.error('[WebRTCManager] Failed to create reconnection offer:', err);
        this.attemptReconnection(peerId);
      }
    }, backoffDelay);

    this.reconnectionTimeouts.set(peerId, timeoutHandle);
  }

  _clearReconnectionState(peerId) {
    this.reconnectionAttempts.delete(peerId);
    const timeoutHandle = this.reconnectionTimeouts.get(peerId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.reconnectionTimeouts.delete(peerId);
    }
  }

  // --- Peer connection helpers -----------------------------------------

  _createPeerConnection(peerId) {
    const state = this.stateManager.getState();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignal({ type: 'ICE_CANDIDATE', from: state.userId, to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTCManager] Received remote track from', peerId, 'track=', event.track && event.track.kind);
      let stream = (event.streams && event.streams[0]) || this.remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      if (event.track) {
        try {
          stream.addTrack(event.track);
          event.track.onended = () => {
            console.warn('[WebRTCManager] Remote track ended from', peerId, 'kind=', event.track.kind);
          };
          console.log('[WebRTCManager] Added remote track to stream, kind=', event.track.kind, 'readyState=', event.track.readyState);
        } catch (e) {
          console.warn('[WebRTCManager] Failed to add remote track to stream', e);
        }
      }
      if (!this.remoteVideos.has(peerId)) {
        this._addRemoteVideo(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTCManager] PC state', pc.connectionState, 'for', peerId);

      if (pc.connectionState === 'connected') {
        console.log('[WebRTCManager] Connection established successfully with', peerId);
        this._clearReconnectionState(peerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (this.peersThatLeft.has(peerId)) {
          console.warn('[WebRTCManager] Connection', pc.connectionState, 'with peer that has left', peerId, '- not reconnecting');
          this.peerConnections.delete(peerId);
          this._removeRemoteVideo(peerId);
          this._clearReconnectionState(peerId);
        } else {
          console.warn('[WebRTCManager] Connection', pc.connectionState, 'with', peerId, '- attempting reconnection');
          this.peerConnections.delete(peerId);
          this._removeRemoteVideo(peerId);
          this.attemptReconnection(peerId);
        }
      } else if (pc.connectionState === 'closed') {
        console.log('[WebRTCManager] Connection closed with', peerId);
        this.peerConnections.delete(peerId);
        this._removeRemoteVideo(peerId);
        this._clearReconnectionState(peerId);
      }
    };

    return pc;
  }

  _addOrReplaceTrack(pc, track, stream) {
    const senders = pc.getSenders();
    const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
    if (existingSender) {
      existingSender.replaceTrack(track).catch(e => console.warn('[WebRTCManager] Error replacing track', e));
    } else {
      try {
        pc.addTrack(track, stream);
      } catch (e) {
        console.warn('[WebRTCManager] Error adding track', e);
      }
    }
  }

  // --- UI helpers -------------------------------------------------------

  _addRemoteVideo(peerId, stream) {
    this._removeRemoteVideo(peerId);
    const v = document.createElement('video');
    v.id = 'toperparty-remote-' + peerId;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.style.position = 'fixed';
    v.style.bottom = '20px';
    v.style.right = (20 + (this.remoteVideos.size * 180)) + 'px';
    v.style.width = '240px';
    v.style.height = '160px';
    v.style.zIndex = 10001;
    v.style.border = '2px solid #00aaff';
    v.style.borderRadius = '4px';

    const audioTracks = stream.getAudioTracks();
    console.log('[WebRTCManager] Remote stream audio tracks:', audioTracks.length);
    audioTracks.forEach((track) => {
      console.log('[WebRTCManager] Audio track:', track.id, 'enabled=', track.enabled, 'readyState=', track.readyState);
    });

    try {
      v.srcObject = stream;
    } catch (e) {
      v.src = URL.createObjectURL(stream);
    }
    document.body.appendChild(v);
    this.remoteVideos.set(peerId, v);

    try {
      v.play().then(() => {
        console.log('[WebRTCManager] Remote video playing, unmuting audio for', peerId);
        v.muted = false;
        v.volume = 1.0;
      }).catch((err) => {
        console.warn('[WebRTCManager] Remote video play() failed:', err);
        v.muted = false;
      });
    } catch (e) {
      console.error('[WebRTCManager] Exception calling play():', e);
    }
  }

  _removeRemoteVideo(peerId) {
    const v = this.remoteVideos.get(peerId);
    if (v) {
      try {
        if (v.srcObject) {
          v.srcObject = null;
        }
      } catch (e) {}
      v.remove();
      this.remoteVideos.delete(peerId);
    }
    this.remoteStreams.delete(peerId);
  }

  // --- Messaging to background -----------------------------------------

  _sendSignal(message) {
    this.stateManager.safeSendMessage({ type: 'SIGNAL_SEND', message }, function() {});
  }

  // --- Teardown ---------------------------------------------------------

  clearAll() {
    this.peerConnections.forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    this.peerConnections.clear();

    this.reconnectionTimeouts.forEach((timeoutHandle) => {
      clearTimeout(timeoutHandle);
    });
    this.reconnectionTimeouts.clear();
    this.reconnectionAttempts.clear();
    this.peersThatLeft.clear();

    this.remoteVideos.forEach((v, id) => {
      try {
        if (v.srcObject) {
          v.srcObject = null;
        }
      } catch (e) {}
      v.remove();
    });
    this.remoteVideos.clear();
    this.remoteStreams.clear();

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
const uiManager = new _modules_ui_manager_js__WEBPACK_IMPORTED_MODULE_4__.UIManager();
const netflixController = new _modules_netflix_controller_js__WEBPACK_IMPORTED_MODULE_1__.NetflixController();
const syncManager = new _modules_sync_manager_js__WEBPACK_IMPORTED_MODULE_2__.SyncManager(stateManager, netflixController);
const webrtcManager = new _modules_webrtc_manager_js__WEBPACK_IMPORTED_MODULE_3__.WebRTCManager(stateManager, uiManager);
const urlSync = new _modules_url_sync_js__WEBPACK_IMPORTED_MODULE_5__.URLSync(stateManager);

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

})();

/******/ })()
;
//# sourceMappingURL=content-script.js.map