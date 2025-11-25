// sync-manager.js - Robust, debounced playback synchronization

export class SyncManager {
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
