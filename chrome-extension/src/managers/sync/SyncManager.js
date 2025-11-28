import { SyncLock } from './lock.js';
import { EventDebouncer } from './debounce.js';
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
    this.debouncer = new EventDebouncer(200);
    this.isInitializedRef = new MutableRef(false);
    this.listeners = null;
    this.contextRef = new MutableRef({ lastUserInteractionAt: 0 });

    this.remote = createRemoteHandlers({
      state: this.state,
      netflix: this.netflix,
      lock: this.lock,
      isInitializedRef: this.isInitializedRef,
      contextRef: this.contextRef,
    });
  }

  async setup() {
    try {
      const video = await this.waitForVideo();
      if (!video) { console.warn('[SyncManager] Netflix video element not found'); return; }
      this.isInitializedRef.set(false);
      this.state.safeSendMessage({ type: 'REQUEST_SYNC' });
      setTimeout(() => {
        if (!this.isInitializedRef.get()) { this.isInitializedRef.set(true); }
      }, 2000);
      const listeners = attachPlaybackListeners({
        video,
        state: this.state,
        isInitializedRef: this.isInitializedRef,
        lock: this.lock,
        debouncer: this.debouncer,
        onBroadcast: (vid) => this.broadcastLocalState(vid),
        onPassiveSyncContext: ({ now }) => {
          this.state.safeSendMessage({
            type: 'SYNC_TIME',
            currentTime: video.currentTime,
            isPlaying: !video.paused,
            timestamp: now,
          });
        }
      });
      this.listeners = listeners;
      this.contextRef.set(listeners.context);
    } catch (err) { console.error('[SyncManager] Error setting up playback sync:', err); }
  }

  teardown() {
    if (this.listeners && this.listeners.video) {
      const { video, handleLocalEvent, handleTimeUpdate } = this.listeners;
      try {
        video.removeEventListener('play', handleLocalEvent);
        video.removeEventListener('pause', handleLocalEvent);
        video.removeEventListener('seeked', handleLocalEvent);
        video.removeEventListener('timeupdate', handleTimeUpdate);
      } catch (e) { console.warn('[SyncManager] Error removing listeners:', e); }
      this.listeners = null;
    }
    this.debouncer.cancel();
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

  broadcastLocalState(video) {
    const currentTime = video.currentTime;
    const isPlaying = !video.paused;
    const events = new Set(this.debouncer.events);
    console.log('[SyncManager] Broadcasting local state - events:', Array.from(events), 'time:', currentTime.toFixed(2), 'playing:', isPlaying);
    
    // Priority: Seek > Play/Pause
    if (events.has('seeked')) {
      console.log('[SyncManager] Sending SEEK:', currentTime.toFixed(2), 'playing:', isPlaying);
      this.state.safeSendMessage({ type: 'SEEK', currentTime, isPlaying });
    } else if (events.has('play') || events.has('pause')) {
      const control = isPlaying ? 'play' : 'pause';
      console.log('[SyncManager] Sending PLAY_PAUSE:', control, 'at time:', currentTime.toFixed(2));
      this.state.safeSendMessage({ type: 'PLAY_PAUSE', control, timestamp: currentTime });
    }
  }

  // Remote API mirrors original methods
  handleRequestSync(fromUserId) { return this.remote.handleRequestSync(fromUserId); }
  handleSyncResponse(currentTime, isPlaying, fromUserId) { return this.remote.handleSyncResponse(currentTime, isPlaying, fromUserId); }
  handlePlaybackControl(control, fromUserId) { return this.remote.handlePlaybackControl(control, fromUserId); }
  handleSeek(currentTime, isPlaying, fromUserId) { return this.remote.handleSeek(currentTime, isPlaying, fromUserId); }
  handlePassiveSync(currentTime, isPlaying, fromUserId, timestamp) { return this.remote.handlePassiveSync(currentTime, isPlaying, fromUserId, timestamp); }
}
