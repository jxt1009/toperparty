// sync-manager.js - Handles playback synchronization

export class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;
    this.listeners = null;
    this.syncInterval = null;
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
      this.sendInitialSync(video);
      
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
    // Play event - always broadcast unless it's an echo
    const onPlay = () => {
      if (!this.state.isActive()) return;
      if (this.state.isEcho('play')) return;
      
      console.log('Local play - broadcasting to peers');
      this.state.recordLocalAction('play');
      this.state.safeSendMessage({ type: 'PLAY_PAUSE', control: 'play', timestamp: video.currentTime });
    };
    
    // Pause event - always broadcast unless it's an echo
    const onPause = () => {
      if (!this.state.isActive()) return;
      if (this.state.isEcho('pause')) return;
      
      console.log('Local pause - broadcasting to peers');
      this.state.recordLocalAction('pause');
      this.state.safeSendMessage({ type: 'PLAY_PAUSE', control: 'pause', timestamp: video.currentTime });
    };
    
    // Seek event - always broadcast unless it's an echo
    const onSeeked = () => {
      if (!this.state.isActive()) return;
      if (this.state.isEcho('seek')) return;
      
      console.log('Local seek to', video.currentTime, '- broadcasting to peers');
      this.state.recordLocalAction('seek');
      this.state.safeSendMessage({ type: 'SEEK', currentTime: video.currentTime, isPlaying: !video.paused });
    };
    
    // Throttled timeupdate sender (passive drift correction)
    let lastSentAt = 0;
    const onTimeUpdate = () => {
      if (!this.state.isActive()) return;
      
      // Don't send passive sync right after a local OR remote seek - prevents sending stale position
      const timeSinceLocalAction = this.state.getTimeSinceLocalAction();
      const timeSinceRemoteAction = this.state.getTimeSinceRemoteAction();
      
      if (this.state.lastLocalAction.type === 'seek' && timeSinceLocalAction < 6000) {
        return; // Suppress passive sync for 6s after local seek
      }
      
      if (this.state.lastRemoteAction.type === 'seek' && timeSinceRemoteAction < 6000) {
        return; // Suppress passive sync for 6s after remote seek
      }
      
      const now = Date.now();
      if (now - lastSentAt < 1000) return; // throttle to ~1s
      lastSentAt = now;
      this.state.safeSendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused, timestamp: now });
    };
    
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('timeupdate', onTimeUpdate);
    
    // Save references for teardown
    this.listeners = { onPlay, onPause, onSeeked, onTimeUpdate, video };
  }
  
  // Periodic fallback sync (every 5 seconds)
  startPeriodicSync(video) {
    this.syncInterval = setInterval(() => {
      if (!this.state.isActive() || !video) return;
      
      // Don't send passive sync right after a local OR remote seek - prevents sending stale position
      const timeSinceLocalAction = this.state.getTimeSinceLocalAction();
      const timeSinceRemoteAction = this.state.getTimeSinceRemoteAction();
      
      if (this.state.lastLocalAction.type === 'seek' && timeSinceLocalAction < 6000) {
        return; // Suppress passive sync for 6s after local seek
      }
      
      if (this.state.lastRemoteAction.type === 'seek' && timeSinceRemoteAction < 6000) {
        return; // Suppress passive sync for 6s after remote seek
      }
      
      const now = Date.now();
      this.state.safeSendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused, timestamp: now });
    }, 5000);
  }
  
  // Send initial sync after setup
  sendInitialSync(video) {
    setTimeout(() => {
      if (this.state.isActive() && video) {
        console.log('Sending initial sync after video setup');
        this.state.safeSendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused });
      }
    }, 2000);
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
  
  // Handle remote playback control commands
  async handlePlaybackControl(control, fromUserId) {
    console.log('Applying remote', control, 'command from', fromUserId);
    this.state.recordRemoteAction(control);
    
    try {
      if (control === 'play') {
        this.state.recordLocalAction('play'); // Record BEFORE play to prevent echo
        await this.netflix.play();
        console.log('Remote play completed');
      } else if (control === 'pause') {
        this.state.recordLocalAction('pause'); // Record BEFORE pause to prevent echo
        await this.netflix.pause();
        console.log('Remote pause completed');
      }
    } catch (err) {
      console.error('Failed to apply remote', control, ':', err);
    }
  }
  
  // Handle remote seek commands
  async handleSeek(currentTime, isPlaying, fromUserId) {
    console.log('Applying remote SEEK to', currentTime, 's from', fromUserId);
    this.state.recordRemoteAction('seek');
    
    const requestedTime = currentTime * 1000; // Convert to ms
    
    try {
      this.state.recordLocalAction('seek'); // Record BEFORE seek to prevent echo
      await this.netflix.seek(requestedTime);
      console.log('Remote seek completed');
      
      // Also sync play/pause state
      const isPaused = await this.netflix.isPaused();
      if (isPlaying && isPaused) {
        this.state.recordLocalAction('play'); // Record BEFORE play to prevent echo
        await this.netflix.play();
      } else if (!isPlaying && !isPaused) {
        this.state.recordLocalAction('pause'); // Record BEFORE pause to prevent echo
        await this.netflix.pause();
      }
    } catch (err) {
      console.error('Failed to apply remote seek:', err);
    }
  }
  
  // Handle passive sync (drift correction)
  async handlePassiveSync(currentTime, isPlaying, fromUserId, messageTimestamp) {
    try {
      // Reject stale passive sync messages (older than 3 seconds)
      if (messageTimestamp) {
        const messageAge = Date.now() - messageTimestamp;
        if (messageAge > 3000) {
          console.log('Ignoring stale passive sync message - age:', messageAge, 'ms');
          return;
        }
      }
      
      const localTime = await this.netflix.getCurrentTime();
      const requestedTime = currentTime * 1000; // Convert to ms
      const timeDiff = Math.abs(localTime - requestedTime);
      
      // Check if we just did a local action - don't override it
      const timeSinceLocalAction = this.state.getTimeSinceLocalAction();
      const timeSinceRemoteAction = this.state.getTimeSinceRemoteAction();
      const lastActionType = this.state.lastLocalAction.type;
      const lastRemoteActionType = this.state.lastRemoteAction.type;
      
      // Very long protection window after explicit seeks to prevent ANY passive sync interference
      if (lastActionType === 'seek' && timeSinceLocalAction < 6000) {
        console.log('Ignoring passive sync - recent local seek:', timeSinceLocalAction, 'ms ago');
        return;
      }
      
      if (lastRemoteActionType === 'seek' && timeSinceRemoteAction < 6000) {
        console.log('Ignoring passive sync - recent remote seek:', timeSinceRemoteAction, 'ms ago');
        return;
      }
      
      // Standard protection for other actions
      if (timeSinceLocalAction < 2000) {
        console.log('Ignoring passive sync - recent local action:', lastActionType, timeSinceLocalAction, 'ms ago');
        return;
      }
      
      // MUCH higher threshold - passive sync is ONLY for fixing real drift, not normal playback differences
      // Increased to 5 seconds to avoid interfering with seeks
      if (timeDiff > 5000) {
        console.log('Passive sync: diff was', (timeDiff / 1000).toFixed(1), 's - correcting');
        this.state.recordLocalAction('seek'); // Record BEFORE seek to prevent echo
        await this.netflix.seek(requestedTime);
      }
      
      // Handle play/pause state sync - but with stricter checks
      const isPaused = await this.netflix.isPaused();
      
      // Only sync play/pause if there's been no local play/pause action recently (3 seconds)
      if (lastActionType === 'play' || lastActionType === 'pause') {
        if (timeSinceLocalAction < 3000) {
          console.log('Ignoring passive play/pause sync - recent local', lastActionType, timeSinceLocalAction, 'ms ago');
          return;
        }
      }
      
      if (isPlaying && isPaused) {
        console.log('Passive sync: resuming playback');
        this.state.recordLocalAction('play'); // Record BEFORE play to prevent echo
        await this.netflix.play();
      } else if (!isPlaying && !isPaused) {
        console.log('Passive sync: pausing playback');
        this.state.recordLocalAction('pause'); // Record BEFORE pause to prevent echo
        await this.netflix.pause();
      }
    } catch (err) {
      console.error('Error handling passive sync:', err);
    }
  }
}
