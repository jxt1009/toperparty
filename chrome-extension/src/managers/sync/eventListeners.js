export function attachPlaybackListeners({ video, state, isInitializedRef, lock, onPlay, onPause, onSeek }) {
  const handlePlay = () => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    console.log('[EventListeners] Play event detected');
    onPlay(video);
  };

  const handlePause = () => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    console.log('[EventListeners] Pause event detected');
    onPause(video);
  };

  const handleSeeked = () => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    console.log('[EventListeners] Seek event detected');
    onSeek(video);
  };

  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('seeked', handleSeeked);

  return { video, handlePlay, handlePause, handleSeeked };
}
