let status = { isConnected: false, roomId: null, userId: null, hasLocalStream: false };

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const controlsSection = document.getElementById('controls-section');
const partyInfo = document.getElementById('party-info');
const videoSection = document.getElementById('video-section');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const resetBtn = document.getElementById('reset-btn');
const roomInput = document.getElementById('room-input');
const roomDisplay = document.getElementById('room-display');
const userDisplay = document.getElementById('user-display');
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
    roomDisplay.textContent = roomId;
    userDisplay.textContent = userId;
  } else {
    statusEl.className = 'status disconnected';
    statusText.textContent = '🔴 Disconnected';
    controlsSection.classList.remove('hidden');
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    partyInfo.classList.add('hidden');
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
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'REMOTE_STREAM_RECEIVED') {
    remoteVideo.srcObject = request.stream;
  }
});
