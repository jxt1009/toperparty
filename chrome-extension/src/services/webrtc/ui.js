export function createRemoteVideoManager(remoteVideos) {
  function createLoadingSpinner() {
    // Create a more visually appealing spinner using CSS
    const spinner = document.createElement('div');
    spinner.className = 'toperparty-spinner';
    spinner.style.cssText = `
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid #00aaff;
      border-radius: 50%;
      animation: toperparty-spin 1s linear infinite;
      margin-bottom: 12px;
    `;
    return spinner;
  }
  
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
    console.log('[RemoteVideoManager] Current remoteVideos map size:', remoteVideos.size, 'peers:', Array.from(remoteVideos.keys()));
    
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
    
    // Check if a placeholder container already exists
    let container = document.getElementById('toperparty-container-' + peerId);
    
    if (!container) {
      // No placeholder exists, create container from scratch
      // Remove any stale references
      remove(peerId);
      
      container = document.createElement('div');
      container.id = 'toperparty-container-' + peerId;
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.right = (20 + (remoteVideos.size * 180)) + 'px';
      container.style.width = '240px';
      container.style.height = '160px';
      container.style.zIndex = 10001;
      container.style.border = '2px solid #00aaff';
      container.style.borderRadius = '4px';
      container.style.backgroundColor = '#000';
    } else {
      console.log('[RemoteVideoManager] Using existing placeholder container for peer:', peerId);
    }
    
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
    
    // Get or create overlay
    let overlay = document.getElementById('toperparty-overlay-' + peerId);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'toperparty-overlay-' + peerId;
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.color = '#fff';
      overlay.style.fontSize = '14px';
      overlay.style.fontFamily = 'Arial, sans-serif';
      overlay.style.borderRadius = '4px';
      overlay.style.pointerEvents = 'none';
      
      const spinner = createLoadingSpinner();
      const text = document.createElement('div');
      text.textContent = 'Connecting...';
      text.style.fontWeight = '500';
      
      overlay.appendChild(spinner);
      overlay.appendChild(text);
    }
    
    // Add spinner animation styles (only once)
    if (!document.getElementById('toperparty-spinner-styles')) {
      const style = document.createElement('style');
      style.id = 'toperparty-spinner-styles';
      style.textContent = `
        @keyframes toperparty-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes toperparty-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    container.appendChild(v);
    if (!overlay.parentElement) {
      container.appendChild(overlay);
    }
    if (!container.parentElement) {
      document.body.appendChild(container);
      // Make container draggable if newly created
      makeDraggable(container);
    }
    console.log('[RemoteVideoManager] Added video to container:', container.id);
    
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
      // Update existing overlay content
      overlay.innerHTML = '';
      const spinner = createLoadingSpinner();
      const text = document.createElement('div');
      text.textContent = 'Reconnecting...';
      text.style.fontWeight = '500';
      overlay.appendChild(spinner);
      overlay.appendChild(text);
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
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    
    const spinner = createLoadingSpinner();
    const text = document.createElement('div');
    text.textContent = 'Reconnecting...';
    text.style.fontWeight = '500';
    
    overlay.appendChild(spinner);
    overlay.appendChild(text);
    container.appendChild(overlay);
  }
  
  function hideOverlay(peerId) {
    const overlay = document.getElementById('toperparty-overlay-' + peerId);
    if (overlay) {
      console.log('[RemoteVideoManager] Hiding overlay for peer:', peerId);
      overlay.remove();
    }
  }
  
  function showPlaceholder(peerId) {
    console.log('[RemoteVideoManager] Showing placeholder for peer:', peerId);
    
    // Check if container already exists
    let container = document.getElementById('toperparty-container-' + peerId);
    if (container) {
      console.log('[RemoteVideoManager] Placeholder already exists for peer:', peerId, '- reusing it');
      return;
    }
    
    console.log('[RemoteVideoManager] Creating NEW placeholder container for peer:', peerId);
    
    // Create container immediately
    container = document.createElement('div');
    container.id = 'toperparty-container-' + peerId;
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = (20 + (remoteVideos.size * 180)) + 'px';
    container.style.width = '240px';
    container.style.height = '160px';
    container.style.zIndex = 10001;
    container.style.border = '2px solid #00aaff';
    container.style.borderRadius = '4px';
    container.style.backgroundColor = '#000';
    
    // Create loading overlay
    const overlay = document.createElement('div');
    overlay.id = 'toperparty-overlay-' + peerId;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    
    const spinner = createLoadingSpinner();
    const text = document.createElement('div');
    text.textContent = 'Connecting...';
    text.style.fontWeight = '500';
    
    overlay.appendChild(spinner);
    overlay.appendChild(text);
    container.appendChild(overlay);
    document.body.appendChild(container);
    
    // Make container draggable immediately
    makeDraggable(container);
    
    console.log('[RemoteVideoManager] Created placeholder container:', container.id);
  }
  
  return { add, remove, showReconnecting, hideOverlay, showPlaceholder };
}
