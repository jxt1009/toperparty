// sync-manager.js - clean, minimal playback synchronisation with echo prevention

export class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;

    this.listeners = null;

    // Echo-prevention and context
    this.expectedEvents = new Set(); // 'play' | 'pause' | 'seeked'
    this.lastProgrammaticSeekAt = 0; // ms since epoch
    this.lastUserSeekAt = 0;        // ms since epoch
    this.lastRemoteCommandAt = 0;   // ms since epoch
  }

  // ---- Public lifecycle -------------------------------------------------

  async setup() {
    try {
      const video = await this.waitForVideo();
      if (!video) {
        console.warn('Netflix video element not found after wait');
        return;
      }

      this.attachEventListeners(video);
      console.log('[SyncManager] Playback sync setup complete');
    } catch (err) {
      console.error('[SyncManager] Error setting up playback sync:', err);
    }
  }

  teardown() {
    if (this.listeners && this.listeners.video) {
      const { video, onPlay, onPause, onSeeked, onTimeUpdate } = this.listeners;
      try {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('timeupdate', onTimeUpdate);
      } catch (e) {
        console.warn('[SyncManager] Error removing video event listeners:', e);
      }
      this.listeners = null;
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
    // PLAY -----------------------------------------------------------------
    const onPlay = () => {
      if (!this.state.isActive()) return;

      console.log('[SyncManager] play event, expectedEvents =', Array.from(this.expectedEvents));

      if (this.expectedEvents.has('play')) {
        this.expectedEvents.delete('play');
        console.log('[SyncManager] play suppressed (expected programmatic)');
        return;
      }

      console.log('[SyncManager] play from user → broadcasting');
      this.state.safeSendMessage({
        type: 'PLAY_PAUSE',
        control: 'play',
        // timestamp is primarily informational here
        timestamp: video.currentTime,
      });
    };

    // PAUSE ----------------------------------------------------------------
    const onPause = () => {
      if (!this.state.isActive()) return;

      console.log('[SyncManager] pause event, expectedEvents =', Array.from(this.expectedEvents));

      if (this.expectedEvents.has('pause')) {
        this.expectedEvents.delete('pause');
        console.log('[SyncManager] pause suppressed (expected programmatic)');
        return;
      }

      console.log('[SyncManager] pause from user → broadcasting');
      this.state.safeSendMessage({
        type: 'PLAY_PAUSE',
        control: 'pause',
        timestamp: video.currentTime,
      });
    };

    // SEEKED ---------------------------------------------------------------
    const onSeeked = () => {
      if (!this.state.isActive()) return;

      const now = Date.now();
      const currentTime = video.currentTime;
      const sinceProgSeek = now - this.lastProgrammaticSeekAt;

      console.log('[SyncManager] seeked event @', currentTime, 's, expectedEvents =', Array.from(this.expectedEvents), 'sinceProgSeek =', sinceProgSeek, 'ms');

      // Any seeked within 1s of a programmatic seek is treated as programmatic.
      if (sinceProgSeek >= 0 && sinceProgSeek < 1000) {
        this.expectedEvents.delete('seeked');
        console.log('[SyncManager] seeked suppressed (within 1s of programmatic seek)');
        return;
      }

      // Ignore seeks that happen very shortly after initialization (e.g. auto-restore)
      // This prevents the "seek to 0" on load from broadcasting if it happens late
      if (now - this.lastProgrammaticSeekAt < 2000 && currentTime < 5) {
         console.log('[SyncManager] early seek suppressed (likely auto-play/restore artifact)');
         return;
      }

      if (this.expectedEvents.has('seeked')) {
        this.expectedEvents.delete('seeked');
        console.log('[SyncManager] seeked suppressed (expected programmatic)');
        return;
      }

      // This is a genuine user seek.
      this.lastUserSeekAt = now;
      console.log('[SyncManager] user seek → broadcasting');

      this.state.safeSendMessage({
        type: 'SEEK',
        currentTime: video.currentTime,
        isPlaying: !video.paused,
      });
    };

    // PASSIVE SYNC SENDER --------------------------------------------------
    let lastPassiveSentAt = 0;

    const onTimeUpdate = () => {
      if (!this.state.isActive()) return;

      const now = Date.now();

      // Only send at most once every 10s.
      if (now - lastPassiveSentAt < 10000) return;

      // Dont send around active user/remote actions.
      if (now - this.lastUserSeekAt < 10000) {
        console.log('[SyncManager] passive send skipped (recent local seek)');
        return;
      }
      if (now - this.lastRemoteCommandAt < 10000) {
        console.log('[SyncManager] passive send skipped (recent remote command)');
        return;
      }

      if (video.paused) return; // only sync while playing

      lastPassiveSentAt = now;

      const payload = {
        type: 'SYNC_TIME',
        currentTime: video.currentTime,
        isPlaying: !video.paused,
        timestamp: now,
      };

      console.log('[SyncManager] passive send', payload);
      this.state.safeSendMessage(payload);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('timeupdate', onTimeUpdate);

    this.listeners = { video, onPlay, onPause, onSeeked, onTimeUpdate };
  }

  // ---- Remote explicit commands ----------------------------------------

  async handlePlaybackControl(control, fromUserId) {
    console.log('[SyncManager] remote PLAY_PAUSE', control, 'from', fromUserId);

    this.lastRemoteCommandAt = Date.now();
    this.expectedEvents.add(control); // 'play' or 'pause'

    try {
      if (control === 'play') {
        await this.netflix.play();
      } else if (control === 'pause') {
        await this.netflix.pause();
      }
    } catch (err) {
      console.error('[SyncManager] error executing remote', control, err);
      this.expectedEvents.delete(control);
    }
  }

  async handleSeek(currentTime, isPlaying, fromUserId) {
    console.log('[SyncManager] remote SEEK to', currentTime, 's from', fromUserId, 'isPlaying =', isPlaying);

    const targetMs = currentTime * 1000;
    this.lastRemoteCommandAt = Date.now();
    this.lastProgrammaticSeekAt = Date.now();
    this.expectedEvents.add('seeked');

    try {
      await this.netflix.seek(targetMs);

      const isPaused = await this.netflix.isPaused();

      if (isPlaying && isPaused) {
        this.expectedEvents.add('play');
        await this.netflix.play();
      } else if (!isPlaying && !isPaused) {
        this.expectedEvents.add('pause');
        await this.netflix.pause();
      }
    } catch (err) {
      console.error('[SyncManager] error during remote seek', err);
      this.expectedEvents.clear();
    }
  }

  // ---- Passive sync receiver -------------------------------------------

  async handlePassiveSync(currentTime, isPlaying, fromUserId, messageTimestamp) {
    const now = Date.now();

    // Never let passive sync override a recent *local* seek.
    const sinceUserSeek = now - this.lastUserSeekAt;
    if (sinceUserSeek >= 0 && sinceUserSeek < 10000) {
      console.log('[SyncManager] passive recv ignored (local seek', (sinceUserSeek / 1000).toFixed(1), 's ago)');
      return;
    }

    if (messageTimestamp) {
      const age = now - messageTimestamp;
      if (age > 3000) {
        console.log('[SyncManager] passive recv ignored (stale,', (age / 1000).toFixed(1), 's)');
        return;
      }
    }

    try {
      const localTimeMs = await this.netflix.getCurrentTime();
      const localPaused = await this.netflix.isPaused();
      const targetMs = currentTime * 1000;
      const driftMs = Math.abs(localTimeMs - targetMs);

      console.log('[SyncManager] passive recv from', fromUserId, 'remote =', currentTime.toFixed(2), 's, local =', (localTimeMs / 1000).toFixed(2), 's, drift =', (driftMs / 1000).toFixed(2), 's');

      // Only correct significant drift.
      if (driftMs <= 3000) {
        console.log('[SyncManager] passive recv: within drift threshold, no correction');
        return;
      }

      // Apply correction like a remote seek, but without rebroadcast.
      this.lastProgrammaticSeekAt = now;
      this.expectedEvents.add('seeked');

      if (isPlaying && localPaused) {
        this.expectedEvents.add('play');
      } else if (!isPlaying && !localPaused) {
        this.expectedEvents.add('pause');
      }

      await this.netflix.seek(targetMs);

      if (isPlaying && localPaused) {
        await this.netflix.play();
      } else if (!isPlaying && !localPaused) {
        await this.netflix.pause();
      }
    } catch (err) {
      console.error('[SyncManager] error handling passive sync', err);
      this.expectedEvents.clear();
    }
  }
}
