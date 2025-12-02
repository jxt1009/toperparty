export function createPeerConnectionFactory({ stateManager, sendSignal, remoteStreams, remoteVideos, addRemoteVideo, attemptReconnection, clearReconnection, removeRemoteVideo, peersThatLeft, showReconnecting, hideOverlay, showPlaceholder }) {
  return function createPeerConnection(peerId) {
    // Show placeholder immediately when peer connection is created
    showPlaceholder(peerId);
    
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
      
      // Check if video element exists
      const hasVideoInMap = remoteVideos.has(peerId);
      const hasVideoInDom = !!document.getElementById('toperparty-remote-' + peerId);
      const videoExists = hasVideoInMap || hasVideoInDom;
      
      if (videoExists) {
        console.log('[PeerConnection] Video already exists for peer:', peerId, 'inMap:', hasVideoInMap, 'inDom:', hasVideoInDom);
        // Update the existing video element's stream if it's different
        const existingVideo = remoteVideos.get(peerId) || document.getElementById('toperparty-remote-' + peerId);
        if (existingVideo && existingVideo.srcObject !== stream) {
          console.log('[PeerConnection] Updating existing video element with new stream');
          existingVideo.srcObject = stream;
          // Ensure it's tracked in the map
          if (!hasVideoInMap) {
            remoteVideos.set(peerId, existingVideo);
          }
        }
      } else {
        // Wait for both audio and video tracks before creating video element
        const tracks = stream.getTracks();
        const hasAudio = tracks.some(t => t.kind === 'audio');
        const hasVideo = tracks.some(t => t.kind === 'video');
        
        console.log('[PeerConnection] Stream status - audio:', hasAudio, 'video:', hasVideo, 'total tracks:', tracks.length);
        
        // Only create video element when we have both tracks
        if (hasAudio && hasVideo) {
          console.log('[PeerConnection] Both tracks present, adding remote video for peer:', peerId);
          addRemoteVideo(peerId, stream);
        } else {
          console.log('[PeerConnection] Waiting for more tracks before creating video element');
        }
      }
    };
    pc.onconnectionstatechange = () => {
      console.log('[PeerConnection] Connection state changed for peer:', peerId, '→', pc.connectionState);
      if (pc.connectionState === 'connected') {
        clearReconnection(peerId);
        hideOverlay(peerId);
      } else if (pc.connectionState === 'disconnected') {
        if (peersThatLeft.has(peerId)) {
          removeRemoteVideo(peerId);
          clearReconnection(peerId);
        } else {
          // Keep video visible while reconnecting - don't remove immediately
          console.log('[PeerConnection] Connection disconnected, attempting reconnection while keeping video visible');
          showReconnecting(peerId);
          attemptReconnection(peerId);
        }
      } else if (pc.connectionState === 'failed') {
        console.log('[PeerConnection] Connection failed for peer:', peerId);
        if (peersThatLeft.has(peerId)) {
          removeRemoteVideo(peerId);
          clearReconnection(peerId);
        } else {
          // Remove video on failed state and try to reconnect
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
