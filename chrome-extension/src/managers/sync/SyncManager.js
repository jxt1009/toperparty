import { SyncLock } from './lock.js';
import { attachPlaybackListeners } from './eventListeners.js';
import { createRemoteHandlers } from './remoteHandlers.js';

class MutableRef {
  constructor(value) { this.value = value; }
  get() { return this.value; }
  set(v) { this.value = v; }
}

export class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;
    this.lock = new SyncLock();
    this.isInitializedRef = new MutableRef(false);
    this.listeners = null;

    this.remote = createRemoteHandlers({
      state: this.state,
      netflix: this.netflix,
      lock: this.lock,
      isInitializedRef: this.isInitializedRef,
    });
  }

  async setup() {
    try {
      // Only setup sync manager on /watch pages
      if (!window.location.pathname.startsWith('/watch')) {
        console.log('[SyncManager] Not on /watch page, skipping setup');
        return;
      }
      
      console.log('[SyncManager] Starting setup - waiting for video element...');
      const video = await this.waitForVideo();
      if (!video) { 
        console.warn('[SyncManager] Netflix video element not found'); 
        return; 
      }
      
      console.log('[SyncManager] Video element found, setting up event listeners');
      
      // Check for pending sync from URL navigation
      const pendingSyncStr = sessionStorage.getItem('toperparty_pending_sync');
      if (pendingSyncStr) {
        try {
          const pendingSync = JSON.parse(pendingSyncStr);
          if (Date.now() - pendingSync.timestamp < 10000) {
            console.log('[SyncManager] Applying pending sync from URL navigation');
            sessionStorage.removeItem('toperparty_pending_sync');
            this.isInitializedRef.set(true);
            
            // Apply the pending sync state
            this.lock.set(1500);
            await this.netflix.seek(pendingSync.currentTime * 1000);
            const isPaused = await this.netflix.isPaused();
            if (pendingSync.isPlaying && isPaused) {
              await this.netflix.play();
            } else if (!pendingSync.isPlaying && !isPaused) {
              await this.netflix.pause();
            }
            
            const listeners = attachPlaybackListeners({
              video,
              state: this.state,
              isInitializedRef: this.isInitializedRef,
              lock: this.lock,
              onPlay: (vid) => this.broadcastPlay(vid),
              onPause: (vid) => this.broadcastPause(vid),
              onSeek: (vid) => this.broadcastSeek(vid)
            });
            this.listeners = listeners;
            console.log('[SyncManager] Setup complete with pending sync applied');
            return;
          } else {
            console.log('[SyncManager] Pending sync expired, ignoring');
            sessionStorage.removeItem('toperparty_pending_sync');
          }
        } catch (e) {
          console.error('[SyncManager] Error applying pending sync:', e);
          sessionStorage.removeItem('toperparty_pending_sync');
        }
      }
      
      this.isInitializedRef.set(false);
      
      // Request initial sync from other clients
      console.log('[SyncManager] Requesting initial sync from other clients');
      this.state.safeSendMessage({ type: 'REQUEST_SYNC' });
      
      // If no response after 2 seconds, consider ourselves initialized
      setTimeout(() => {
        if (!this.isInitializedRef.get()) {
          console.log('[SyncManager] No sync response received after 2s, marking as initialized');
          this.isInitializedRef.set(true);
          console.log('[SyncManager] isInitialized is now:', this.isInitializedRef.get());
        } else {
          console.log('[SyncManager] Already initialized, skipping timeout initialization');
        }
      }, 2000);
      
      const listeners = attachPlaybackListeners({
        video,
        state: this.state,
        isInitializedRef: this.isInitializedRef,
        lock: this.lock,
        onPlay: (vid) => this.broadcastPlay(vid),
        onPause: (vid) => this.broadcastPause(vid),
        onSeek: (vid) => this.broadcastSeek(vid)
      });
      this.listeners = listeners;
      console.log('[SyncManager] Setup complete - ready to sync');
    } catch (err) { 
      console.error('[SyncManager] Error setting up playback sync:', err); 
    }
  }

  teardown() {
    console.log('[SyncManager] Tearing down sync manager');
    if (this.listeners && this.listeners.video) {
      const { video, handlePlay, handlePause, handleSeeked } = this.listeners;
      try {
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('seeked', handleSeeked);
        console.log('[SyncManager] Event listeners removed');
      } catch (e) { console.warn('[SyncManager] Error removing listeners:', e); }
      this.listeners = null;
    }
    this.isInitializedRef.set(false);
  }

  waitForVideo() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video element timeout')), 10000);
      const check = () => {
        const video = this.netflix.getVideoElement();
        if (video) { clearTimeout(timeout); resolve(video); }
        else { setTimeout(check, 100); }
      };
      check();
    });
  }

  isOnWatchPage() {
    return window.location.pathname.startsWith('/watch');
  }

  broadcastPlay(video) {
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring PLAY event - not on /watch page');
      return;
    }
    console.log('[SyncManager] Broadcasting PLAY event');
    this.state.safeSendMessage({ 
      type: 'PLAY_PAUSE', 
      control: 'play', 
      currentTime: video.currentTime 
    });
  }

  broadcastPause(video) {
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring PAUSE event - not on /watch page');
      return;
    }
    console.log('[SyncManager] Broadcasting PAUSE event');
    this.state.safeSendMessage({ 
      type: 'PLAY_PAUSE', 
      control: 'pause', 
      currentTime: video.currentTime 
    });
  }

  broadcastSeek(video) {
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring SEEK event - not on /watch page');
      return;
    }
    console.log('[SyncManager] Broadcasting SEEK event at', video.currentTime);
    this.state.safeSendMessage({ 
      type: 'SEEK', 
      currentTime: video.currentTime, 
      isPlaying: !video.paused 
    });
  }

  // Remote event handlers
  handleRequestSync(fromUserId) { return this.remote.handleRequestSync(fromUserId); }
  handleSyncResponse(currentTime, isPlaying, fromUserId, url) { return this.remote.handleSyncResponse(currentTime, isPlaying, fromUserId, url); }
  handlePlaybackControl(control, currentTime, fromUserId) { return this.remote.handlePlaybackControl(control, currentTime, fromUserId); }
  handleSeek(currentTime, isPlaying, fromUserId) { return this.remote.handleSeek(currentTime, isPlaying, fromUserId); }
}
