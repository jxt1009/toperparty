export function attachPlaybackListeners({ video, state, isInitializedRef, lock, debouncer, onBroadcast, onPassiveSyncContext }) {
  const context = { lastUserInteractionAt: 0 };
  const handleLocalEvent = (e) => {
    console.log('[EventListener] Local event:', e.type, 'video.currentTime:', video.currentTime.toFixed(2), 'paused:', video.paused);
    
    if (!state.isActive()) {
      console.log('[EventListener] Suppressed - party not active');
      return;
    }
    if (!isInitializedRef.get()) {
      console.log('[EventListener] Suppressed - not initialized');
      return;
    }
    if (lock.isActive()) {
      console.log('[EventListener] Suppressed - lock active');
      return;
    }
    
    console.log('[EventListener] Event accepted, scheduling broadcast');
    context.lastUserInteractionAt = Date.now();
    debouncer.add(e.type);
    debouncer.schedule(() => onBroadcast(video));
  };

  let lastPassiveSentAt = 0;
  const handleTimeUpdate = () => {
    if (!state.isActive()) return;
    const now = Date.now();
    if (lock.isActive()) return;
    if (now - context.lastUserInteractionAt < 5000) return;
    if (now - lastPassiveSentAt < 10000) return;
    if (video.paused) return;
    lastPassiveSentAt = now;
    onPassiveSyncContext({ now, lastPassiveSentAt });
  };

  video.addEventListener('play', handleLocalEvent);
  video.addEventListener('pause', handleLocalEvent);
  video.addEventListener('seeked', handleLocalEvent);
  video.addEventListener('timeupdate', handleTimeUpdate);

  return { video, handleLocalEvent, handleTimeUpdate, context };
}
