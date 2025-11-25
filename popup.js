// popup.js
// Connects to signaling server, sets up WebRTC, sends playback commands to the active tab.

const SIGNALING_SERVER = "wss://watch.toper.dev/ws"; // change to your server (wss:// for production)
let ws;
let pc;
let dataChannel;
let localStream;
let roomId;
let isCaller = false;

const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomId');
const statusEl = document.getElementById('status');
const controls = document.getElementById('controls');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const seekBtn = document.getElementById('seekBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

function logStatus(s) { statusEl.textContent = s; }

joinBtn.addEventListener('click', async () => {
  roomId = roomInput.value.trim();
  if (!roomId) return alert('Enter room name');

  await startSignaling();
  controls.style.display = 'block';
});

async function startSignaling() {
  ws = new WebSocket(SIGNALING_SERVER);
  ws.onopen = () => {
    logStatus('Connected to signaling');
    ws.send(JSON.stringify({ type: 'join', room: roomId }));
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'joined') {
      // if another peer is already in room, we will be caller
      isCaller = msg.isCaller;
      logStatus(`Joined room. isCaller=${isCaller}`);
      await startLocalMedia();
      await setupPeer();
      if (isCaller) await createOffer();
    } else if (msg.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', room: roomId, answer }));
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
    } else if (msg.type === 'ice') {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (e) {
        console.warn('ICE candidate error', e);
      }
    }
  };

  ws.onclose = () => logStatus('Signaling disconnected');
  ws.onerror = (e) => console.error('WS err', e);
}

async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;
  } catch (e) {
    console.error('getUserMedia failed', e);
    alert('Could not access microphone/camera.');
  }
}

async function setupPeer() {
  pc = new RTCPeerConnection();

  // add local tracks
  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.ontrack = (evt) => {
    // attach remote stream
    remoteVideo.srcObject = evt.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      ws.send(JSON.stringify({ type: 'ice', room: roomId, candidate: ev.candidate }));
    }
  };

  // Data channel for playback sync
  if (isCaller) {
    dataChannel = pc.createDataChannel('sync');
    setupDataChannel();
  } else {
    pc.ondatachannel = (e) => {
      dataChannel = e.channel;
      setupDataChannel();
    };
  }
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    logStatus('Data channel open');
  };
  dataChannel.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'PLAY') {
      forwardToTab({ type: 'PLAY' });
    } else if (msg.type === 'PAUSE') {
      forwardToTab({ type: 'PAUSE' });
    } else if (msg.type === 'SEEK') {
      forwardToTab({ type: 'SEEK', time: msg.time });
    } else if (msg.type === 'STATE_REQUEST') {
      // ask content script for state and then send back
      getTabState().then(state => {
        dataChannel.send(JSON.stringify({ type: 'STATE', state }));
      }).catch(()=>{});
    } else if (msg.type === 'STATE') {
      // remote's state
      console.log('REMOTE STATE', msg.state);
    }
  };
}

async function createOffer() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', room: roomId, offer }));
}

// send instruction to active tab content script
async function forwardToTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return alert('No active tab');
  try {
    chrome.tabs.sendMessage(tab.id, message, (resp) => {
      // optional callback
      // console.log('tab resp', resp);
    });
  } catch (e) {
    console.error('sendMessage failed', e);
  }
}

// ask tab for status
function getTabState() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return reject('no-tab');
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATE' }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
        resolve(resp);
      });
    });
  });
}

// Buttons
playBtn.onclick = () => {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'PLAY' }));
  }
  // also locally fire it so host doesn't wait
  forwardToTab({ type: 'PLAY' });
};

pauseBtn.onclick = () => {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'PAUSE' }));
  }
  forwardToTab({ type: 'PAUSE' });
};

seekBtn.onclick = async () => {
  // naive +30s seek using remote request to get current then set +30
  try {
    const state = await getTabState();
    const newTime = (state.currentTime || 0) + 30;
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'SEEK', time: newTime }));
    }
    forwardToTab({ type: 'SEEK', time: newTime });
  } catch (e) {
    console.warn('Could not get tab state', e);
  }
};
