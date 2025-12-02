export function createSignalingHandlers({ getState, peerConnections, peersThatLeft, getLocalStream, createPeer, sendSignal, addOrReplaceTrack, clearReconnection, removeRemoteVideo }) {
  return {
    async handleJoin(from) {
      console.log('[Signaling] Handling JOIN from', from);
      const state = getState();
      if (from === state.userId) {
        console.log('[Signaling] Ignoring JOIN from self');
        return;
      }
      
      // First, clear any reconnection attempts - peer has explicitly rejoined
      clearReconnection(from);
      peersThatLeft.delete(from);
      
      let pc = peerConnections.get(from);
      if (pc) {
        const connectionState = pc.connectionState;
        console.log('[Signaling] Already have peer connection for', from, 'state:', connectionState);
        
        // If connection is still good (connected/connecting), reuse it
        if (connectionState === 'connected' || connectionState === 'connecting') {
          console.log('[Signaling] Reusing existing connection - ensuring tracks are present');
          const stream = getLocalStream();
          if (stream) {
            let needsRenegotiation = false;
            stream.getTracks().forEach(t => {
              const senders = pc.getSenders();
              const existingSender = senders.find(s => s.track && s.track.kind === t.kind);
              if (!existingSender || existingSender.track.id !== t.id) {
                console.log('[Signaling] Track changed, replacing:', t.kind, t.id);
                addOrReplaceTrack(pc, t, stream);
                needsRenegotiation = true;
              }
            });
            
            // Only renegotiate if tracks changed
            if (needsRenegotiation && pc.signalingState === 'stable') {
              console.log('[Signaling] Renegotiating due to track changes');
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
            }
          }
          return;
        }
        
        // For any other state (disconnected/failed/closed), clean it up and create new connection
        // This handles the case where a peer refreshes - their old connection is stuck in 
        // disconnected/failed state, so we need to clean it up when they rejoin
        console.log('[Signaling] Cleaning up existing connection in state:', connectionState);
        clearReconnection(from);
        removeRemoteVideo(from);
        try { pc.close(); } catch (e) {}
        peerConnections.delete(from);
        pc = null;
      }
      
      if (!pc) {
        try {
          console.log('[Signaling] Creating new peer connection for', from);
          pc = createPeer(from);
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
      if (pc) {
        console.log('[Signaling] Existing peer connection state:', pc.signalingState);
        if (pc.signalingState !== 'closed' && pc.signalingState !== 'stable') {
          console.log('[Signaling] Closing existing peer connection in state:', pc.signalingState);
          try { pc.close(); } catch (e) {}
          peerConnections.delete(from);
          pc = null;
        } else if (pc.signalingState === 'stable') {
          // If stable, this might be a renegotiation - close and recreate
          console.log('[Signaling] Closing stable peer connection for renegotiation');
          try { pc.close(); } catch (e) {}
          peerConnections.delete(from);
          pc = null;
        }
      }
      if (!pc) {
        console.log('[Signaling] Creating new peer connection for', from);
        pc = createPeer(from);
        peerConnections.set(from, pc);
      }
      try {
        console.log('[Signaling] Setting remote description, current state:', pc.signalingState);
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
        console.error('[Signaling] Error handling offer:', err.name, err.message);
        console.error('[Signaling] Full error:', err);
        peerConnections.delete(from);
        try { pc.close(); } catch (e) {}
      }
    },
    async handleAnswer(from, answer) {
      console.log('[Signaling] Handling ANSWER from', from);
      const pc = peerConnections.get(from);
      if (!pc) {
        console.warn('[Signaling] Cannot handle ANSWER - no peer connection found for', from);
        return;
      }
      
      console.log('[Signaling] Peer connection state:', {
        signalingState: pc.signalingState,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState
      });
      
      if (pc.signalingState === 'have-local-offer') {
        console.log('[Signaling] Setting remote description from ANSWER');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('[Signaling] Remote description set successfully');
        } catch (err) {
          console.error('[Signaling] Error handling answer:', err.name, err.message);
          console.error('[Signaling] Full error:', err);
          // If the peer connection is in a bad state, close it and remove it
          if (err.name === 'InvalidStateError' || err.name === 'OperationError') {
            console.log('[Signaling] Closing peer connection due to state error');
            try { pc.close(); } catch (e) {}
            peerConnections.delete(from);
          }
        }
      } else if (pc.signalingState === 'stable') {
        console.log('[Signaling] Received ANSWER but already in stable state (connection:', pc.connectionState + ') - likely duplicate, ignoring');
      } else if (pc.signalingState === 'have-remote-offer') {
        console.warn('[Signaling] Received ANSWER but expecting to send one (have-remote-offer) - might be glare, ignoring');
      } else if (pc.signalingState === 'closed') {
        console.warn('[Signaling] Received ANSWER but peer connection is closed - ignoring');
      } else {
        console.warn('[Signaling] Cannot handle ANSWER - unexpected state:', pc.signalingState);
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
