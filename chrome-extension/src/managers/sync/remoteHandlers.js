export function createRemoteHandlers({ state, netflix, lock, isInitializedRef }) {
  async function applyRemote(actionName, durationMs, actionFn) {
    lock.set(durationMs);
    try { await actionFn(); } catch (err) {
      console.error(`[SyncManager] Error applying remote ${actionName}:`, err);
    }
  }

  return {
    async handleRequestSync(fromUserId) {
      if (!isInitializedRef.get()) {
        console.log('[SyncManager] Not yet initialized, ignoring sync request');
        return;
      }
      
      try {
        const currentTime = await netflix.getCurrentTime();
        const isPaused = await netflix.isPaused();
        const currentUrl = window.location.href;
        
        if (currentTime == null) {
          console.log('[SyncManager] Invalid playback state, ignoring sync request');
          return;
        }
        
        const currentTimeSeconds = currentTime / 1000;
        console.log('[SyncManager] Sending SYNC_RESPONSE to', fromUserId, 'at', currentTimeSeconds.toFixed(2) + 's', isPaused ? 'paused' : 'playing', 'URL:', currentUrl);
        
        state.safeSendMessage({
          type: 'SYNC_RESPONSE',
          targetUserId: fromUserId,
          currentTime: currentTimeSeconds,
          isPlaying: !isPaused,
          url: currentUrl
        });
      } catch (e) { console.error('[SyncManager] Error handling sync request:', e); }
    },
    async handleSyncResponse(currentTime, isPlaying, fromUserId, url) {
      if (isInitializedRef.get()) {
        console.log('[SyncManager] Already initialized, ignoring late SYNC_RESPONSE');
        return;
      }
      
      if (currentTime == null || typeof currentTime !== 'number' || currentTime < 0) {
        console.warn('[SyncManager] Invalid SYNC_RESPONSE - bad currentTime:', currentTime);
        return;
      }
      
      console.log('[SyncManager] Initial sync from', fromUserId, 'seeking to', currentTime.toFixed(2) + 's', isPlaying ? 'playing' : 'paused', 'URL:', url);
      
      // Check if we need to navigate to a different URL
      const currentUrl = window.location.href;
      if (url && url !== currentUrl) {
        console.log('[SyncManager] URL mismatch - navigating from', currentUrl, 'to', url);
        // Store the sync state to apply after navigation
        sessionStorage.setItem('toperparty_pending_sync', JSON.stringify({
          currentTime,
          isPlaying,
          timestamp: Date.now()
        }));
        // Navigate to the correct URL
        window.location.href = url;
        return;
      }
      
      isInitializedRef.set(true);
      
      await applyRemote('initial-sync', 1500, async () => {
        await netflix.seek(currentTime * 1000);
        const localPaused = await netflix.isPaused();
        if (isPlaying && localPaused) {
          await netflix.play();
        } else if (!isPlaying && !localPaused) {
          await netflix.pause();
        }
      });
    },
    async handlePlaybackControl(control, currentTime, fromUserId) {
      console.log('[SyncManager] Remote', control.toUpperCase(), 'at', currentTime, 'from', fromUserId);
      
      await applyRemote(control, 1000, async () => {
        // Seek to the exact position first
        if (currentTime != null) {
          const currentTimeMs = currentTime * 1000;
          await netflix.seek(currentTimeMs);
          console.log('[SyncManager] Seeked to', currentTime.toFixed(2) + 's before', control);
        }
        
        // Then apply play/pause
        if (control === 'play') {
          await netflix.play();
        } else {
          await netflix.pause();
        }
      });
    },
    async handleSeek(currentTime, isPlaying, fromUserId) {
      console.log('[SyncManager] Remote SEEK to', currentTime.toFixed(2) + 's', isPlaying ? 'playing' : 'paused', 'from', fromUserId);
      
      await applyRemote('seek', 1200, async () => {
        await netflix.seek(currentTime * 1000);
        const isPaused = await netflix.isPaused();
        
        if (isPlaying && isPaused) {
          await netflix.play();
        } else if (!isPlaying && !isPaused) {
          await netflix.pause();
        }
      });
    }
  };
}
