let status = { isConnected: false, roomId: null, userId: null, hasLocalStream: false };

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const controlsSection = document.getElementById('controls-section');
const partyInfo = document.getElementById('party-info');
const statsSection = document.getElementById('stats-section');
const videoSection = document.getElementById('video-section');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const resetBtn = document.getElementById('reset-btn');
const roomInput = document.getElementById('room-input');
const roomDisplay = document.getElementById('room-display');
const userDisplay = document.getElementById('user-display');
const localTimeEl = document.getElementById('local-time');
const syncStatusEl = document.getElementById('sync-status');
const remoteUsersList = document.getElementById('remote-users-list');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const copyRoomBtn = document.getElementById('copy-room-btn');

updateStatus();
setupEventListeners();
startStatusPolling();

function setupEventListeners() {
  startBtn.addEventListener('click', startParty);
  stopBtn.addEventListener('click', stopParty);
  resetBtn.addEventListener('click', resetParty);
  copyRoomBtn.addEventListener('click', copyRoomId);
}

function updateStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      status = response;
      updateUI();
    }
  });
}

function updateUI() {
  const { isConnected, roomId, userId } = status;
  if (isConnected) {
    statusEl.className = 'status connected';
    statusText.textContent = '🟢 Connected';
    controlsSection.classList.remove('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    resetBtn.classList.remove('hidden');
    partyInfo.classList.remove('hidden');
    statsSection.classList.remove('hidden');
    roomDisplay.textContent = roomId;
    userDisplay.textContent = userId;
    updateStats();
  } else {
    statusEl.className = 'status disconnected';
    statusText.textContent = '🔴 Disconnected';
    controlsSection.classList.remove('hidden');
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    partyInfo.classList.add('hidden');
    statsSection.classList.add('hidden');
    videoSection.classList.add('hidden');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }
}

async function startParty() {
  const roomId = roomInput.value.trim() || undefined;
  startBtn.disabled = true;
  statusText.textContent = '⏳ Connecting...';
  chrome.runtime.sendMessage({ type: 'START_PARTY', roomId }, (response) => {
    if (response.success) {
      setTimeout(updateStatus, 500);
    } else {
      alert('Error: ' + response.error);
      statusText.textContent = '🔴 Disconnected';
      startBtn.disabled = false;
    }
  });
}

function stopParty() {
  chrome.runtime.sendMessage({ type: 'STOP_PARTY' }, () => {
    roomInput.value = '';
    updateStatus();
  });
}

function resetParty() {
  const desiredRoomId = roomInput.value.trim() || status.roomId || undefined;
  resetBtn.disabled = true;
  statusText.textContent = '♻️ Resetting...';
  chrome.runtime.sendMessage({ type: 'STOP_PARTY' }, () => {
    chrome.runtime.sendMessage({ type: 'START_PARTY', roomId: desiredRoomId }, (response) => {
      resetBtn.disabled = false;
      if (response && response.success) {
        setTimeout(updateStatus, 500);
      } else {
        alert('Error resetting party: ' + (response && response.error ? response.error : 'Unknown error'));
        statusText.textContent = '🔴 Disconnected';
      }
    });
  });
}

function copyRoomId() {
  if (status.roomId) {
    navigator.clipboard.writeText(status.roomId);
    copyRoomBtn.textContent = '✓';
    setTimeout(() => { copyRoomBtn.textContent = '📋'; }, 2000);
  }
}

function startStatusPolling() {
  updateStatus();
  setInterval(updateStatus, 2000);
  // Update stats more frequently when connected
  setInterval(() => {
    if (status.isConnected) {
      updateStats();
    }
  }, 1000);
}

async function updateStats() {
  if (!status.isConnected || !status.roomId) {
    console.log('[Popup] Not connected or no room ID');
    return;
  }

  try {
    // Fetch stats from signaling server
    const response = await fetch('http://watch.toper.dev/status');
    if (!response.ok) {
      console.error('[Popup] Failed to fetch server status');
      return;
    }

    const serverStatus = await response.json();
    console.log('[Popup] Server status:', serverStatus);

    // Find our room
    const room = serverStatus.rooms?.find(r => r.roomId === status.roomId);
    if (!room) {
      console.log('[Popup] Room not found on server');
      if (syncStatusEl) {
        syncStatusEl.textContent = 'Not Found';
        syncStatusEl.style.color = '#ef4444';
      }
      return;
    }

    const formatTime = (seconds) => {
      if (!seconds && seconds !== 0) return '--:--';
      const totalSeconds = Math.floor(seconds);
      const minutes = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    // Update local time (use room's currentTime as reference)
    if (localTimeEl) {
      localTimeEl.textContent = formatTime(room.currentTime);
    }

    // Update sync status
    if (syncStatusEl) {
      const isPlaying = room.isPlaying ? 'Playing' : 'Paused';
      syncStatusEl.textContent = isPlaying;
      syncStatusEl.style.color = room.isPlaying ? '#4ade80' : '#fbbf24';
    }

    // Update user list with individual positions
    if (remoteUsersList) {
      const users = room.users || [];
      
      if (users.length === 0) {
        remoteUsersList.innerHTML = '<div style="color: rgba(255,255,255,0.5); font-size: 12px; font-style: italic;">No users in party</div>';
      } else {
        const userListHTML = users.map((user, index) => {
          const timeDiff = Math.abs(user.currentTime - room.currentTime);
          const isOutOfSync = timeDiff > 2; // More than 2 seconds off
          const statusColor = user.isPlaying ? '#4ade80' : '#fbbf24';
          const syncColor = isOutOfSync ? '#ef4444' : '#4ade80';
          
          return `
            <div style="padding: 8px; border-top: 1px solid rgba(255,255,255,0.1); ${index === 0 ? 'border-top: none;' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.9);">
                  ${user.userId.substring(0, 8)}...
                </div>
                <div style="font-size: 10px; color: ${statusColor};">
                  ${user.isPlaying ? '▶' : '⏸'}
                </div>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 13px; font-weight: 600; color: #a78bfa;">
                  ${formatTime(user.currentTime)}
                </div>
                <div style="font-size: 10px; color: ${syncColor}; font-weight: 600;">
                  ${isOutOfSync ? `±${timeDiff.toFixed(1)}s` : '✓ synced'}
                </div>
              </div>
            </div>
          `;
        }).join('');
        
        remoteUsersList.innerHTML = `
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px; color: rgba(255,255,255,0.7);">
            ${users.length} user${users.length === 1 ? '' : 's'} in party
          </div>
          ${userListHTML}
        `;
      }
    }
  } catch (error) {
    console.error('[Popup] Error fetching stats:', error);
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'REMOTE_STREAM_RECEIVED') {
    remoteVideo.srcObject = request.stream;
  }
});
