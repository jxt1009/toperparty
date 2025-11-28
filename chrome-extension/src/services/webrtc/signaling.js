export function createSignalingHandlers({ getState, peerConnections, peersThatLeft, getLocalStream, createPeer, sendSignal, addOrReplaceTrack, clearReconnection, removeRemoteVideo }) {
  return {
    async handleJoin(from) {
      console.log('[Signaling] Handling JOIN from', from);
      const state = getState();
      if (from === state.userId) {
        console.log('[Signaling] Ignoring JOIN from self');
        return;
      }
      peersThatLeft.delete(from);
      if (peerConnections.has(from)) {
        console.log('[Signaling] Already have peer connection for', from);
        return;
      }
      try {
        console.log('[Signaling] Creating peer connection for', from);
        const pc = createPeer(from);
        peerConnections.set(from, pc);
        const stream = getLocalStream();
        console.log('[Signaling] Local stream:', stream, 'tracks:', stream ? stream.getTracks().length : 0);
        if (stream) {
          stream.getTracks().forEach(t => {
            console.log('[Signaling] Adding local track to peer:', t.kind, t.id);
            addOrReplaceTrack(pc, t, stream);
          });
        } else {
          console.warn('[Signaling] No local stream available when handling JOIN');
        }
        console.log('[Signaling] Creating and sending OFFER to', from);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
      } catch (err) {
        console.error('[Signaling] Error handling JOIN:', err);
        peerConnections.delete(from);
      }
    },
    async handleOffer(from, offer) {
      console.log('[Signaling] Handling OFFER from', from);
      const state = getState();
      if (from === state.userId) {
        console.log('[Signaling] Ignoring OFFER from self');
        return;
      }
      let pc = peerConnections.get(from);
      if (pc && pc.signalingState !== 'closed') {
        console.log('[Signaling] Closing existing peer connection');
        try { pc.close(); } catch (e) {}
        peerConnections.delete(from);
        pc = null;
      }
      if (!pc) {
        console.log('[Signaling] Creating new peer connection for', from);
        pc = createPeer(from);
        peerConnections.set(from, pc);
      }
      try {
        console.log('[Signaling] Setting remote description');
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const stream = getLocalStream();
        console.log('[Signaling] Local stream:', stream, 'tracks:', stream ? stream.getTracks().length : 0);
        if (stream) {
          stream.getTracks().forEach(t => {
            console.log('[Signaling] Adding local track to peer:', t.kind, t.id);
            addOrReplaceTrack(pc, t, stream);
          });
        } else {
          console.warn('[Signaling] No local stream available when handling OFFER');
        }
        console.log('[Signaling] Creating and sending ANSWER to', from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'ANSWER', from: state.userId, to: from, answer: pc.localDescription });
      } catch (err) {
        console.error('[Signaling] Error handling offer:', err);
        peerConnections.delete(from);
        try { pc.close(); } catch (e) {}
      }
    },
    async handleAnswer(from, answer) {
      console.log('[Signaling] Handling ANSWER from', from);
      const pc = peerConnections.get(from);
      if (pc && pc.signalingState === 'have-local-offer') {
        console.log('[Signaling] Setting remote description from ANSWER');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('[Signaling] Remote description set successfully');
        } catch (err) {
          console.error('[Signaling] Error handling answer:', err);
        }
      } else {
        console.warn('[Signaling] Cannot handle ANSWER - pc:', !!pc, 'signalingState:', pc?.signalingState);
      }
    },
    async handleIceCandidate(from, candidate) {
      console.log('[Signaling] Handling ICE_CANDIDATE from', from);
      const pc = peerConnections.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('[Signaling] ICE candidate added successfully');
        } catch (err) {
          console.warn('[Signaling] Error adding ICE candidate', err);
        }
      } else {
        console.warn('[Signaling] No peer connection found for ICE candidate from', from);
      }
    },
    handleLeave(from) {
      console.log('[Signaling] Handling LEAVE from', from);
      peersThatLeft.add(from);
      const pc = peerConnections.get(from);
      if (pc) {
        try { pc.close(); } catch (e) {}
        peerConnections.delete(from);
      }
      clearReconnection(from);
      removeRemoteVideo(from);
    }
  };
}
