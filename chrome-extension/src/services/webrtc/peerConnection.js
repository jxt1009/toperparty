export function createPeerConnectionFactory({ stateManager, sendSignal, remoteStreams, remoteVideos, addRemoteVideo, attemptReconnection, clearReconnection, removeRemoteVideo, peersThatLeft }) {
  return function createPeerConnection(peerId) {
    const state = stateManager.getState();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] }
      ]
    });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[PeerConnection] ICE candidate for peer:', peerId, event.candidate);
        sendSignal({ type: 'ICE_CANDIDATE', from: state.userId, to: peerId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => {
      console.log('[PeerConnection] ontrack fired for peer:', peerId, 'track:', event.track, 'streams:', event.streams);
      let stream = (event.streams && event.streams[0]) || remoteStreams.get(peerId);
      if (!stream) {
        console.log('[PeerConnection] Creating new MediaStream for peer:', peerId);
        stream = new MediaStream();
        remoteStreams.set(peerId, stream);
      }
      if (event.track) {
        console.log('[PeerConnection] Adding track to stream:', event.track.kind, event.track.id);
        try { 
          // Check if track already exists in stream to prevent duplicates
          const existingTrack = stream.getTracks().find(t => t.id === event.track.id);
          if (!existingTrack) {
            stream.addTrack(event.track);
          } else {
            console.log('[PeerConnection] Track already in stream, skipping');
          }
        } catch (e) {
          console.warn('[PeerConnection] Error adding track:', e);
        }
      }
      
      // Only add video element if we don't have one yet (check both Map and DOM)
      const hasVideoInMap = remoteVideos.has(peerId);
      const hasVideoInDom = !!document.getElementById('toperparty-remote-' + peerId);
      
      if (!hasVideoInMap && !hasVideoInDom) {
        console.log('[PeerConnection] Adding remote video for peer:', peerId, 'stream tracks:', stream.getTracks().length);
        addRemoteVideo(peerId, stream);
      } else {
        console.log('[PeerConnection] Remote video already exists for peer:', peerId, 'inMap:', hasVideoInMap, 'inDom:', hasVideoInDom);
      }
    };
    pc.onconnectionstatechange = () => {
      console.log('[PeerConnection] Connection state changed for peer:', peerId, '→', pc.connectionState);
      if (pc.connectionState === 'connected') {
        clearReconnection(peerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (peersThatLeft.has(peerId)) {
          removeRemoteVideo(peerId);
          clearReconnection(peerId);
        } else {
          removeRemoteVideo(peerId);
          attemptReconnection(peerId);
        }
      } else if (pc.connectionState === 'closed') {
        removeRemoteVideo(peerId);
        clearReconnection(peerId);
      }
    };
    return pc;
  };
}

export function addOrReplaceTrack(pc, track, stream) {
  const senders = pc.getSenders();
  const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
  if (existingSender) {
    existingSender.replaceTrack(track).catch(e => console.warn('[WebRTCManager] Error replacing track', e));
  } else {
    try { pc.addTrack(track, stream); } catch (e) {}
  }
}
