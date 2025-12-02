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
        // Remove loading overlay if it exists
        const overlay = document.getElementById('toperparty-overlay-' + peerId);
        if (overlay) overlay.remove();
      }
      // Make sure it's tracked
      if (!remoteVideos.has(peerId)) {
        remoteVideos.set(peerId, existingInDom);
      }
      return;
    }
    
    // Remove any stale references
    remove(peerId);
    
    // Create container for video + overlay
    const container = document.createElement('div');
    container.id = 'toperparty-container-' + peerId;
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = (20 + (remoteVideos.size * 180)) + 'px';
    container.style.width = '240px';
    container.style.height = '160px';
    container.style.zIndex = 10001;
    
    const v = document.createElement('video');
    v.id = 'toperparty-remote-' + peerId;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.style.width = '100%';
    v.style.height = '100%';
    v.style.border = '2px solid #00aaff';
    v.style.borderRadius = '4px';
    v.style.backgroundColor = '#000';
    
    // Create loading overlay
    const overlay = document.createElement('div');
    overlay.id = 'toperparty-overlay-' + peerId;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    overlay.innerHTML = '<div style="text-align: center;"><div style="margin-bottom: 8px;">●</div><div>Connecting...</div></div>';
    
    // Add pulsing animation to the dot
    const style = document.createElement('style');
    style.textContent = `
      @keyframes toperparty-pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
      }
      #toperparty-overlay-${peerId} > div > div:first-child {
        animation: toperparty-pulse 1.5s ease-in-out infinite;
        font-size: 24px;
      }
    `;
    document.head.appendChild(style);
    
    container.appendChild(v);
    container.appendChild(overlay);
    document.body.appendChild(container);
    console.log('[RemoteVideoManager] Created video container with loading overlay:', container.id);
    
    // Verify stream has active tracks
    const activeTracks = stream.getTracks().filter(t => t.readyState === 'live');
    console.log('[RemoteVideoManager] Stream has', activeTracks.length, 'active tracks:', 
      activeTracks.map(t => `${t.kind}:${t.id.substring(0,8)}`).join(', '));
    
    try { 
      v.srcObject = stream;
      console.log('[RemoteVideoManager] Set srcObject successfully');
    } catch (e) { 
      console.warn('[RemoteVideoManager] srcObject failed:', e);
    }
    
    remoteVideos.set(peerId, v);
    
    // Make container draggable (not the video itself)
    makeDraggable(container);
    
    // Handle video playback with better error handling
    const playVideo = () => {
      v.play().then(() => {
        console.log('[RemoteVideoManager] Video playing, unmuting and removing overlay');
        v.muted = false;
        v.volume = 1.0;
        // Remove loading overlay
        overlay.remove();
      }).catch((e) => { 
        console.warn('[RemoteVideoManager] Play failed:', e.name, e.message);
        // Try unmuting anyway in case autoplay blocked
        v.muted = false;
        // Still remove overlay even if play failed
        overlay.remove();
      });
    };
    
    // If stream already has tracks, play immediately
    if (activeTracks.length > 0) {
      playVideo();
    } else {
      // Wait for tracks to become active
      console.log('[RemoteVideoManager] Waiting for stream tracks to become active');
      overlay.innerHTML = '<div style="text-align: center;"><div style="margin-bottom: 8px;">●</div><div>Waiting for stream...</div></div>';
      const checkTracks = setInterval(() => {
        const nowActive = stream.getTracks().filter(t => t.readyState === 'live');
        if (nowActive.length > 0) {
          clearInterval(checkTracks);
          console.log('[RemoteVideoManager] Tracks now active, playing video');
          playVideo();
        }
      }, 100);
      // Give up after 5 seconds and remove overlay anyway
      setTimeout(() => {
        clearInterval(checkTracks);
        if (overlay.parentNode) {
          console.log('[RemoteVideoManager] Timeout waiting for tracks, removing overlay');
          overlay.remove();
        }
      }, 5000);
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
      // Remove the container (which includes the video)
      const container = v.parentElement;
      if (container && container.id === 'toperparty-container-' + peerId) {
        container.remove();
      } else {
        v.remove();
      }
      remoteVideos.delete(peerId);
    }
    
    // Also check DOM for any orphaned elements (extra safety)
    const domContainer = document.getElementById('toperparty-container-' + peerId);
    if (domContainer) {
      console.log('[RemoteVideoManager] Found orphaned container, removing');
      domContainer.remove();
    }
    
    const domElement = document.getElementById('toperparty-remote-' + peerId);
    if (domElement && domElement !== v) {
      console.log('[RemoteVideoManager] Found orphaned video element, removing');
      try {
        if (domElement.srcObject) {
          domElement.srcObject = null;
        }
      } catch (e) {}
      domElement.remove();
    }
    
    // Clean up overlay if it exists
    const overlay = document.getElementById('toperparty-overlay-' + peerId);
    if (overlay) {
      overlay.remove();
    }
  }
  
  function showReconnecting(peerId) {
    console.log('[RemoteVideoManager] Showing reconnecting overlay for peer:', peerId);
    
    // Check if overlay already exists
    let overlay = document.getElementById('toperparty-overlay-' + peerId);
    if (overlay) {
      overlay.innerHTML = '<div style="text-align: center;"><div style="margin-bottom: 8px;">●</div><div>Reconnecting...</div></div>';
      overlay.style.display = 'flex';
      return;
    }
    
    // Create new overlay if it doesn't exist
    const container = document.getElementById('toperparty-container-' + peerId);
    if (!container) {
      console.warn('[RemoteVideoManager] Cannot show reconnecting - container not found');
      return;
    }
    
    overlay = document.createElement('div');
    overlay.id = 'toperparty-overlay-' + peerId;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    overlay.innerHTML = '<div style="text-align: center;"><div style="margin-bottom: 8px;">●</div><div>Reconnecting...</div></div>';
    
    container.appendChild(overlay);
  }
  
  function hideOverlay(peerId) {
    const overlay = document.getElementById('toperparty-overlay-' + peerId);
    if (overlay) {
      console.log('[RemoteVideoManager] Hiding overlay for peer:', peerId);
      overlay.remove();
    }
  }
  
  return { add, remove, showReconnecting, hideOverlay };
}
