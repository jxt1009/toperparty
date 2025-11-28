export function createRemoteHandlers({ state, netflix, lock, isInitializedRef, contextRef }) {
  async function applyRemote(actionName, durationMs, actionFn) {
    lock.set(durationMs);
    try { await actionFn(); } catch (err) {
      console.error(`[SyncManager] Error applying remote ${actionName}:`, err);
    }
  }

  return {
    async handleRequestSync(fromUserId) {
      if (!isInitializedRef.get()) return;
      try {
        const currentTime = await netflix.getCurrentTime();
        const isPaused = await netflix.isPaused();
        
        // Validate playback state
        if (currentTime == null) {
          console.log('[SyncManager] Ignoring sync request - invalid playback state');
          return;
        }
        
        const currentTimeSeconds = currentTime / 1000;
        
        // Don't send position 0 if we haven't had user interaction
        if (currentTimeSeconds === 0 && contextRef.get().lastUserInteractionAt === 0) {
          console.log('[SyncManager] Ignoring sync request - at position 0 with no user interaction');
          return;
        }
        
        console.log('[SyncManager] Sending SYNC_RESPONSE to', fromUserId, 'Time:', currentTimeSeconds, 'Playing:', !isPaused);
        state.safeSendMessage({
          type: 'SYNC_RESPONSE',
          targetUserId: fromUserId,
          currentTime: currentTimeSeconds,
          isPlaying: !isPaused
        });
      } catch (e) { console.error('[SyncManager] Error handling sync request:', e); }
    },
    async handleSyncResponse(currentTime, isPlaying, fromUserId) {
      if (isInitializedRef.get()) {
        console.log('[SyncManager] Received late SYNC_RESPONSE, ignoring');
        return;
      }
      
      // Validate received state
      if (currentTime == null || typeof currentTime !== 'number' || currentTime < 0) {
        console.warn('[SyncManager] Received invalid SYNC_RESPONSE with bad currentTime:', currentTime);
        return;
      }
      
      console.log('[SyncManager] Received initial state from', fromUserId, 'Time:', currentTime, 'Playing:', isPlaying);
      isInitializedRef.set(true);
      await applyRemote('initial-sync', 2000, async () => {
        await netflix.seek(currentTime * 1000);
        const localPaused = await netflix.isPaused();
        if (isPlaying && localPaused) await netflix.play();
        else if (!isPlaying && !localPaused) await netflix.pause();
      });
    },
    async handlePlaybackControl(control, fromUserId) {
      console.log('[SyncManager] Handling playback control:', control, 'from:', fromUserId);
      await applyRemote(control, 1000, async () => {
        if (control === 'play') {
          console.log('[SyncManager] Executing remote PLAY command');
          await netflix.play();
        } else {
          console.log('[SyncManager] Executing remote PAUSE command');
          await netflix.pause();
        }
      });
    },
    async handleSeek(currentTime, isPlaying, fromUserId) {
      console.log('[SyncManager] Handling SEEK to:', currentTime, 'playing:', isPlaying, 'from:', fromUserId);
      await applyRemote('seek', 2000, async () => {
        await netflix.seek(currentTime * 1000);
        const isPaused = await netflix.isPaused();
        if (isPlaying && isPaused) {
          console.log('[SyncManager] Resuming playback after seek');
          await netflix.play();
        } else if (!isPlaying && !isPaused) {
          console.log('[SyncManager] Pausing playback after seek');
          await netflix.pause();
        }
      });
    },
    async handlePassiveSync(currentTime, isPlaying, fromUserId, timestamp) {
      const now = Date.now();
      const timeSinceInteraction = now - contextRef.get().lastUserInteractionAt;
      
      if (timestamp && (now - timestamp > 5000)) {
        console.log('[SyncManager] Ignoring stale passive sync (message too old)');
        return;
      }
      
      if (timeSinceInteraction < 10000) {
        console.log('[SyncManager] Ignoring passive sync - recent local interaction (' + timeSinceInteraction + 'ms ago)');
        return;
      }
      
      if (lock.isActive()) {
        console.log('[SyncManager] Ignoring passive sync - lock is active');
        return;
      }
      
      try {
        const localTimeMs = await netflix.getCurrentTime();
        const targetMs = currentTime * 1000;
        const driftMs = Math.abs(localTimeMs - targetMs);
        
        console.log('[SyncManager] Passive sync check - drift:', (driftMs/1000).toFixed(2) + 's', 'target:', (targetMs/1000).toFixed(2) + 's', 'local:', (localTimeMs/1000).toFixed(2) + 's');
        
        if (driftMs <= 3000) {
          console.log('[SyncManager] Drift acceptable, no correction needed');
          return;
        }
        
        console.log('[SyncManager] Applying passive correction');
        await applyRemote('passive-correction', 1500, async () => {
          await netflix.seek(targetMs);
          const localPaused = await netflix.isPaused();
          if (isPlaying && localPaused) {
            console.log('[SyncManager] Resuming playback (passive sync)');
            await netflix.play();
          } else if (!isPlaying && !localPaused) {
            console.log('[SyncManager] Pausing playback (passive sync)');
            await netflix.pause();
          }
        });
      } catch (err) { console.error('[SyncManager] Error handling passive sync:', err); }
    }
  };
}
