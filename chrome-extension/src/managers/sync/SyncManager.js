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
      const video = await this.waitForVideo();
      if (!video) { console.warn('[SyncManager] Netflix video element not found'); return; }
      
      console.log('[SyncManager] Setting up event listeners');
      this.isInitializedRef.set(false);
      
      // Request initial sync from other clients
      this.state.safeSendMessage({ type: 'REQUEST_SYNC' });
      
      // If no response after 2 seconds, consider ourselves initialized
      setTimeout(() => {
        if (!this.isInitializedRef.get()) {
          console.log('[SyncManager] No sync response received, marking as initialized');
          this.isInitializedRef.set(true);
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
    } catch (err) { console.error('[SyncManager] Error setting up playback sync:', err); }
  }

  teardown() {
    if (this.listeners && this.listeners.video) {
      const { video, handlePlay, handlePause, handleSeeked } = this.listeners;
      try {
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('seeked', handleSeeked);
      } catch (e) { console.warn('[SyncManager] Error removing listeners:', e); }
      this.listeners = null;
    }
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

  broadcastPlay(video) {
    console.log('[SyncManager] Broadcasting PLAY event');
    this.state.safeSendMessage({ 
      type: 'PLAY_PAUSE', 
      control: 'play', 
      currentTime: video.currentTime 
    });
  }

  broadcastPause(video) {
    console.log('[SyncManager] Broadcasting PAUSE event');
    this.state.safeSendMessage({ 
      type: 'PLAY_PAUSE', 
      control: 'pause', 
      currentTime: video.currentTime 
    });
  }

  broadcastSeek(video) {
    console.log('[SyncManager] Broadcasting SEEK event at', video.currentTime);
    this.state.safeSendMessage({ 
      type: 'SEEK', 
      currentTime: video.currentTime, 
      isPlaying: !video.paused 
    });
  }

  // Remote event handlers
  handleRequestSync(fromUserId) { return this.remote.handleRequestSync(fromUserId); }
  handleSyncResponse(currentTime, isPlaying, fromUserId) { return this.remote.handleSyncResponse(currentTime, isPlaying, fromUserId); }
  handlePlaybackControl(control, currentTime, fromUserId) { return this.remote.handlePlaybackControl(control, currentTime, fromUserId); }
  handleSeek(currentTime, isPlaying, fromUserId) { return this.remote.handleSeek(currentTime, isPlaying, fromUserId); }
}
