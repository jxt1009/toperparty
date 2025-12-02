export function attachPlaybackListeners({ video, state, isInitializedRef, lock, onPlay, onPause, onSeek }) {
  const handlePlay = () => {
    console.log('[EventListeners] Play event fired - checking conditions:', {
      isActive: state.isActive(),
      isInitialized: isInitializedRef.get(),
      lockActive: lock.isActive()
    });
    if (!state.isActive()) { console.log('[EventListeners] Ignoring play - party not active'); return; }
    if (!isInitializedRef.get()) { console.log('[EventListeners] Ignoring play - not initialized'); return; }
    if (lock.isActive()) { console.log('[EventListeners] Ignoring play - lock active'); return; }
    console.log('[EventListeners] Play event detected - broadcasting');
    onPlay(video);
  };

  const handlePause = () => {
    console.log('[EventListeners] Pause event fired - checking conditions:', {
      isActive: state.isActive(),
      isInitialized: isInitializedRef.get(),
      lockActive: lock.isActive()
    });
    if (!state.isActive()) { console.log('[EventListeners] Ignoring pause - party not active'); return; }
    if (!isInitializedRef.get()) { console.log('[EventListeners] Ignoring pause - not initialized'); return; }
    if (lock.isActive()) { console.log('[EventListeners] Ignoring pause - lock active'); return; }
    console.log('[EventListeners] Pause event detected - broadcasting');
    onPause(video);
  };

  const handleSeeked = () => {
    console.log('[EventListeners] Seek event fired - checking conditions:', {
      isActive: state.isActive(),
      isInitialized: isInitializedRef.get(),
      lockActive: lock.isActive()
    });
    if (!state.isActive()) { console.log('[EventListeners] Ignoring seek - party not active'); return; }
    if (!isInitializedRef.get()) { console.log('[EventListeners] Ignoring seek - not initialized'); return; }
    if (lock.isActive()) { console.log('[EventListeners] Ignoring seek - lock active'); return; }
    console.log('[EventListeners] Seek event detected - broadcasting');
    onSeek(video);
  };

  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('seeked', handleSeeked);
  console.log('[EventListeners] Event listeners attached to video element');

  return { video, handlePlay, handlePause, handleSeeked };
}
