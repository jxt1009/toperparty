// popup.js - Extension popup UI

let status = {
  isConnected: false,
  roomId: null,
  userId: null,
  hasLocalStream: false
};

// Get background script
const bg = chrome.runtime.getBackgroundPage
  ? await chrome.runtime.getBackgroundPage()
  : null;

// DOM elements
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const controlsSection = document.getElementById('controls-section');
const partyInfo = document.getElementById('party-info');
const videoSection = document.getElementById('video-section');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const roomInput = document.getElementById('room-input');
const roomDisplay = document.getElementById('room-display');
const userDisplay = document.getElementById('user-display');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const copyRoomBtn = document.getElementById('copy-room-btn');

// Initialize
updateStatus();
setupEventListeners();
startStatusPolling();

function setupEventListeners() {
  startBtn.addEventListener('click', startParty);
  stopBtn.addEventListener('click', stopParty);
  copyRoomBtn.addEventListener('click', copyRoomId);
}

async function updateStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) {
      status = response;
      updateUI();
    }
  });
}

function updateUI() {
  const { isConnected, roomId, userId, hasLocalStream } = status;

  if (isConnected) {
    statusEl.className = 'status connected';
    statusText.textContent = '🟢 Connected';
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    partyInfo.classList.remove('hidden');
    videoSection.classList.remove('hidden');
    roomDisplay.textContent = roomId;
    userDisplay.textContent = userId;

    // Display local video
    if (hasLocalStream) {
      chrome.runtime.getBackgroundPage().then((bg) => {
        if (bg.localStream) {
          localVideo.srcObject = bg.localStream;
        }
      });
    }
  } else {
    statusEl.className = 'status disconnected';
    statusText.textContent = '🔴 Disconnected';
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    partyInfo.classList.add('hidden');
    videoSection.classList.add('hidden');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }
}

async function startParty() {
  const roomId = roomInput.value.trim() || undefined;

  try {
    startBtn.disabled = true;
    statusText.textContent = '⏳ Connecting...';

    chrome.runtime.sendMessage(
      { type: 'START_PARTY', roomId },
      (response) => {
        if (response.success) {
          console.log('Party started successfully');
          setTimeout(updateStatus, 500);
        } else {
          alert('Error: ' + response.error);
          statusText.textContent = '🔴 Disconnected';
          startBtn.disabled = false;
        }
      }
    );
  } catch (err) {
    alert('Error starting party: ' + err.message);
    startBtn.disabled = false;
  }
}

function stopParty() {
  chrome.runtime.sendMessage({ type: 'STOP_PARTY' }, () => {
    roomInput.value = '';
    updateStatus();
  });
}

function copyRoomId() {
  if (status.roomId) {
    navigator.clipboard.writeText(status.roomId);
    copyRoomBtn.textContent = '✓';
    setTimeout(() => {
      copyRoomBtn.textContent = '📋';
    }, 2000);
  }
}

function startStatusPolling() {
  setInterval(updateStatus, 2000);
}

// Listen for remote stream
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REMOTE_STREAM_RECEIVED') {
    console.log('Received remote stream');
    remoteVideo.srcObject = request.stream;
  }
});
