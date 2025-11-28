export function createRemoteVideoManager(remoteVideos) {
  function add(peerId, stream) {
    console.log('[RemoteVideoManager] Adding remote video for peer:', peerId, 'stream:', stream, 'tracks:', stream.getTracks());
    remove(peerId);
    const v = document.createElement('video');
    v.id = 'toperparty-remote-' + peerId;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.style.position = 'fixed';
    v.style.bottom = '20px';
    v.style.right = (20 + (remoteVideos.size * 180)) + 'px';
    v.style.width = '240px';
    v.style.height = '160px';
    v.style.zIndex = 10001;
    v.style.border = '2px solid #00aaff';
    v.style.borderRadius = '4px';
    console.log('[RemoteVideoManager] Created video element:', v.id, 'at position:', v.style.right);
    try { 
      v.srcObject = stream;
      console.log('[RemoteVideoManager] Set srcObject successfully');
    } catch (e) { 
      console.warn('[RemoteVideoManager] srcObject failed, trying createObjectURL:', e);
      v.src = URL.createObjectURL(stream); 
    }
    document.body.appendChild(v);
    console.log('[RemoteVideoManager] Appended video to body');
    remoteVideos.set(peerId, v);
    try {
      v.play().then(() => {
        console.log('[RemoteVideoManager] Video playing, unmuting');
        v.muted = false;
        v.volume = 1.0;
      }).catch((e) => { 
        console.warn('[RemoteVideoManager] Play failed:', e);
        v.muted = false; 
      });
    } catch (e) {
      console.warn('[RemoteVideoManager] Error calling play:', e);
    }
  }
  
  function remove(peerId) {
    console.log('[RemoteVideoManager] Removing remote video for peer:', peerId);
    const v = remoteVideos.get(peerId);
    if (v) {
      try { if (v.srcObject) v.srcObject = null; } catch (e) {}
      v.remove();
      remoteVideos.delete(peerId);
    }
  }
  
  return { add, remove };
}
