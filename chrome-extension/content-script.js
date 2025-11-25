// content-script.js - Injected into Netflix pages

let partyActive = false;
let userId = null;
let roomId = null;

// Find Netflix video player
function getVideoElement() {
  return document.querySelector('video');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PARTY_STARTED') {
    partyActive = true;
    userId = request.userId;
    roomId = request.roomId;
    console.log('Party started! Room:', roomId, 'User:', userId);
    setupPlaybackSync();
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    partyActive = false;
    userId = null;
    roomId = null;
    teardownPlaybackSync();
    console.log('Party stopped');
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    const video = getVideoElement();
    if (video) {
      if (request.control === 'play') {
        video.play().catch(err => console.error('Failed to play:', err));
      } else if (request.control === 'pause') {
        video.pause();
      }
    }
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_SYNC_PLAYBACK') {
    const video = getVideoElement();
    if (video) {
      // Only sync if times differ significantly (avoid constant micro-adjustments)
      const timeDiff = Math.abs(video.currentTime - request.currentTime);
      if (timeDiff > 0.5) { // 500ms threshold
        video.currentTime = request.currentTime;
      }

      if (request.isPlaying && video.paused) {
        video.play().catch(err => console.error('Failed to play:', err));
      } else if (!request.isPlaying && !video.paused) {
        video.pause();
      }
    }
    sendResponse({ success: true });
  }
});

// Setup playback synchronization
function setupPlaybackSync() {
  const video = getVideoElement();
  if (!video) {
    console.warn('Netflix video element not found');
    return;
  }

  // Track play/pause events
  video.addEventListener('play', () => {
    if (partyActive) {
      chrome.runtime.sendMessage({
        type: 'PLAY_PAUSE',
        control: 'play',
        timestamp: video.currentTime
      }).catch(() => {});
    }
  });

  video.addEventListener('pause', () => {
    if (partyActive) {
      chrome.runtime.sendMessage({
        type: 'PLAY_PAUSE',
        control: 'pause',
        timestamp: video.currentTime
      }).catch(() => {});
    }
  });

  // Periodic sync (every 5 seconds)
  window.playbackSyncInterval = setInterval(() => {
    if (partyActive && video) {
      chrome.runtime.sendMessage({
        type: 'SYNC_TIME',
        currentTime: video.currentTime,
        isPlaying: !video.paused
      }).catch(() => {});
    }
  }, 5000);

  console.log('Playback sync setup complete');
}

// Teardown playback synchronization
function teardownPlaybackSync() {
  if (window.playbackSyncInterval) {
    clearInterval(window.playbackSyncInterval);
    window.playbackSyncInterval = null;
  }
}

// Inject play/pause controls into page
function injectControls() {
  if (document.getElementById('netflix-party-controls')) {
    return; // Already injected
  }

  const controlsDiv = document.createElement('div');
  controlsDiv.id = 'netflix-party-controls';
  controlsDiv.innerHTML = `
    <style>
      #netflix-party-controls {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        border: 2px solid #e50914;
        border-radius: 8px;
        padding: 15px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        color: white;
      }
      .control-button {
        background: #e50914;
        color: white;
        border: none;
        padding: 8px 15px;
        margin: 5px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
      }
      .control-button:hover {
        background: #bb070f;
      }
      .status-text {
        font-size: 12px;
        margin: 5px 0;
      }
    </style>
    <div class="status-text">Party Mode Active</div>
    <button class="control-button" id="play-btn">▶ Play</button>
    <button class="control-button" id="pause-btn">⏸ Pause</button>
  `;

  document.body.appendChild(controlsDiv);

  // Add event listeners
  document.getElementById('play-btn')?.addEventListener('click', () => {
    const video = getVideoElement();
    if (video) {
      video.play().catch(err => console.error('Failed to play:', err));
    }
  });

  document.getElementById('pause-btn')?.addEventListener('click', () => {
    const video = getVideoElement();
    if (video) {
      video.pause();
    }
  });
}

// Wait for page to load and inject controls when party starts
setTimeout(() => {
  console.log('Content script loaded on Netflix page');
}, 1000);
