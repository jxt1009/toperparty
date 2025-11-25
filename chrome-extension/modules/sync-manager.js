// sync-manager.js - Handles playback synchronization
// Rebuilt with simple, reliable logic to prevent feedback loops

export class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;
    this.listeners = null;
    this.syncInterval = null;
    this.suppressBroadcast = false; // Flag to suppress broadcasting when we control video programmatically
    this.expectedEvents = new Set(); // Track which events we're expecting from programmatic control
    this.lastProgrammaticSeekAt = 0; // Track when we last did a programmatic seek
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
      console.log('[Play event] Fired - expectedEvents:', Array.from(this.expectedEvents), 'partyActive:', this.state.isActive());
      
      if (!this.state.isActive()) return;
      
      // If this is an expected programmatic event, consume it and don't broadcast
      if (this.expectedEvents.has('play')) {
        this.expectedEvents.delete('play');
        console.log('[Play event] ✓ Suppressed - programmatic control (expected event consumed)');
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
      console.log('[Pause event] Fired - expectedEvents:', Array.from(this.expectedEvents), 'partyActive:', this.state.isActive());
      
      if (!this.state.isActive()) return;
      
      // If this is an expected programmatic event, consume it and don't broadcast
      if (this.expectedEvents.has('pause')) {
        this.expectedEvents.delete('pause');
        console.log('[Pause event] ✓ Suppressed - programmatic control (expected event consumed)');
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
      const now = Date.now();
      const timeSinceLastProgrammaticSeek = now - this.lastProgrammaticSeekAt;
      
      console.log('[Seeked event] Fired - expectedEvents:', Array.from(this.expectedEvents), 'timeSinceProgSeek:', timeSinceLastProgrammaticSeek, 'ms, time:', currentTime);
      
      if (!this.state.isActive()) return;
      
      // Suppress ALL seeks within 1 second of a programmatic seek (catches multiple events)
      if (timeSinceLastProgrammaticSeek < 1000) {
        console.log('[Seeked event] ✓ Suppressed - within 1s of programmatic seek');
        this.expectedEvents.delete('seeked'); // Clean up if present
        return;
      }
      
      // Also check expected events (for explicit commands)
      if (this.expectedEvents.has('seeked')) {
        this.expectedEvents.delete('seeked');
        console.log('[Seeked event] ✓ Suppressed - programmatic control (expected event consumed)');
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
    let lastUserSeekAt = 0; // Track when user last seeked
    
    // Track user seeks so passive sync can avoid interfering
    const originalOnSeeked = onSeeked;
    const onSeekedWithTracking = () => {
      // If this was a user action (not suppressed), remember the time
      if (!this.expectedEvents.has('seeked')) {
        lastUserSeekAt = Date.now();
        console.log('[Passive sync] User seek detected - will pause passive sync for 5s');
      }
      originalOnSeeked();
    };
    
    const onTimeUpdate = () => {
      if (!this.state.isActive()) return;
      
      const now = Date.now();
      
      // Only send every 5 seconds (be conservative)
      if (now - lastSentAt < 5000) return;
      
      // Don't send if user seeked recently (within 5 seconds)
      if (now - lastUserSeekAt < 5000) {
        console.log('[Passive sync] Skipping send - user seeked recently');
        return;
      }
      
      lastSentAt = now;
      
      // Send our current position for others to sync to
      console.log('[Passive sync] Broadcasting position:', video.currentTime.toFixed(2), 's');
      this.state.safeSendMessage({ 
        type: 'SYNC_TIME', 
        currentTime: video.currentTime, 
        isPlaying: !video.paused,
        timestamp: now
      });
    };
    
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeekedWithTracking);
    video.addEventListener('timeupdate', onTimeUpdate);
    
    // Save references for teardown
    this.listeners = { onPlay, onPause, onSeeked: onSeekedWithTracking, onTimeUpdate, video };
  }
  
  // No longer needed - we use timeupdate events for passive sync
  startPeriodicSync(video) {
    // Removed - timeupdate does this for us now
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
  
  // Handle remote playback control commands (explicit play/pause)
  async handlePlaybackControl(control, fromUserId) {
    console.log('[Remote command] Received', control, 'from', fromUserId);
    
    // Mark that we expect this event
    this.expectedEvents.add(control); // 'play' or 'pause'
    console.log('[Remote command] Added expected event:', control);
    
    try {
      if (control === 'play') {
        console.log('[Remote command] Executing play()...');
        await this.netflix.play();
        console.log('[Remote command] Play completed');
      } else if (control === 'pause') {
        console.log('[Remote command] Executing pause()...');
        await this.netflix.pause();
        console.log('[Remote command] Pause completed');
      }
    } catch (err) {
      console.error('[Remote command] Error executing', control, err);
      // Clean up expected event on error
      this.expectedEvents.delete(control);
    }
  }
  
  // Handle remote seek commands (explicit seek)
  async handleSeek(currentTime, isPlaying, fromUserId) {
    console.log('[Remote command] Received SEEK to', currentTime, 's from', fromUserId, 'isPlaying:', isPlaying);
    
    const requestedTime = currentTime * 1000; // Convert to ms
    
    try {
      // Mark that we expect a seeked event AND record the timestamp
      this.expectedEvents.add('seeked');
      this.lastProgrammaticSeekAt = Date.now();
      console.log('[Remote command] Added expected event: seeked + timestamp');
      
      console.log('[Remote command] Executing seek(' + requestedTime + 'ms)...');
      await this.netflix.seek(requestedTime);
      console.log('[Remote command] Seek completed');
      
      // Also sync play/pause state
      const isPaused = await this.netflix.isPaused();
      console.log('[Remote command] Current state - isPaused:', isPaused);
      
      if (isPlaying && isPaused) {
        this.expectedEvents.add('play');
        console.log('[Remote command] Need to resume - executing play()...');
        await this.netflix.play();
        console.log('[Remote command] Resumed after seek');
      } else if (!isPlaying && !isPaused) {
        this.expectedEvents.add('pause');
        console.log('[Remote command] Need to pause - executing pause()...');
        await this.netflix.pause();
        console.log('[Remote command] Paused after seek');
      }
    } catch (err) {
      console.error('[Remote command] Error during seek:', err);
      // Clean up expected events on error
      this.expectedEvents.clear();
    }
  }
  
  // Handle passive sync (drift correction only)
  async handlePassiveSync(currentTime, isPlaying, fromUserId, messageTimestamp) {
    // Ignore stale messages (older than 3 seconds)
    if (messageTimestamp) {
      const messageAge = Date.now() - messageTimestamp;
      if (messageAge > 3000) {
        console.log('[Passive sync] Ignoring stale message - age:', (messageAge / 1000).toFixed(1), 's');
        return;
      }
    }
    
    try {
      const localTime = await this.netflix.getCurrentTime();
      const localPaused = await this.netflix.isPaused();
      const requestedTime = currentTime * 1000; // Convert to ms
      const timeDiff = Math.abs(localTime - requestedTime);
      
      console.log('[Passive sync] Received position:', currentTime.toFixed(2), 's from', fromUserId);
      console.log('[Passive sync] Local:', (localTime/1000).toFixed(2), 's | Drift:', (timeDiff/1000).toFixed(2), 's');
      
      // Only correct drift > 3 seconds (conservative threshold)
      if (timeDiff > 3000) {
        console.log('[Passive sync] ⚠️  Drift detected:', (timeDiff / 1000).toFixed(1), 's - correcting');
        
        // Add expected events AND record timestamp
        this.expectedEvents.add('seeked');
        this.lastProgrammaticSeekAt = Date.now();
        if (isPlaying && localPaused) {
          this.expectedEvents.add('play');
        } else if (!isPlaying && !localPaused) {
          this.expectedEvents.add('pause');
        }
        
        await this.netflix.seek(requestedTime);
        
        // Sync play/pause state too
        if (isPlaying && localPaused) {
          await this.netflix.play();
        } else if (!isPlaying && !localPaused) {
          await this.netflix.pause();
        }
      } else {
        console.log('[Passive sync] ✓ In sync - drift within threshold');
      }
    } catch (err) {
      console.error('[Passive sync] Error:', err);
      // Clean up expected events on error
      this.expectedEvents.clear();
    }
  }
}
