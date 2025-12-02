export function createRemoteVideoManager(remoteVideos) {
  function makeDraggable(element) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    element.addEventListener('mousedown', dragStart);
    element.addEventListener('mouseup', dragEnd);
    element.addEventListener('mousemove', drag);
    element.style.cursor = 'move';

    function dragStart(e) {
      const computedStyle = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      
      element.style.left = rect.left + 'px';
      element.style.top = rect.top + 'px';
      element.style.bottom = 'auto';
      element.style.right = 'auto';
      
      initialX = e.clientX - rect.left;
      initialY = e.clientY - rect.top;
      isDragging = true;
      element.style.opacity = '0.8';
    }

    function dragEnd(e) {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      element.style.opacity = '1';
    }

    function drag(e) {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        
        const maxX = window.innerWidth - element.offsetWidth;
        const maxY = window.innerHeight - element.offsetHeight;
        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));
        
        element.style.left = currentX + 'px';
        element.style.top = currentY + 'px';
      }
    }
  }

  function add(peerId, stream) {
    console.log('[RemoteVideoManager] Adding remote video for peer:', peerId, 'stream:', stream, 'tracks:', stream.getTracks());
    
    // Check if video already exists in DOM (double-check for race conditions)
    const existingInDom = document.getElementById('toperparty-remote-' + peerId);
    if (existingInDom) {
      console.log('[RemoteVideoManager] Video already exists in DOM for peer:', peerId, 'skipping duplicate creation');
      // Update stream on existing element if different
      if (existingInDom.srcObject !== stream) {
        console.log('[RemoteVideoManager] Updating stream on existing video element');
        existingInDom.srcObject = stream;
      }
      // Make sure it's tracked
      if (!remoteVideos.has(peerId)) {
        remoteVideos.set(peerId, existingInDom);
      }
      return;
    }
    
    // Remove any stale references
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
    
    // Make it draggable
    makeDraggable(v);
    
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
    
    // Remove from map
    const v = remoteVideos.get(peerId);
    if (v) {
      try { 
        if (v.srcObject) {
          v.srcObject.getTracks().forEach(track => track.stop());
          v.srcObject = null;
        }
      } catch (e) {
        console.warn('[RemoteVideoManager] Error cleaning up stream:', e);
      }
      v.remove();
      remoteVideos.delete(peerId);
    }
    
    // Also check DOM for any orphaned elements (extra safety)
    const domElement = document.getElementById('toperparty-remote-' + peerId);
    if (domElement && domElement !== v) {
      console.log('[RemoteVideoManager] Found orphaned DOM element, removing');
      try {
        if (domElement.srcObject) {
          domElement.srcObject = null;
        }
      } catch (e) {}
      domElement.remove();
    }
  }
  
  return { add, remove };
}
