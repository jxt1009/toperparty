export function createReconnectionManager({ stateManager, peerConnections, peersThatLeft, localStream, createPeer, sendSignal, addOrReplaceTrack }) {
  const attempts = new Map();
  const timeouts = new Map();
  
  function clear(peerId) {
    attempts.delete(peerId);
    const handle = timeouts.get(peerId);
    if (handle) {
      clearTimeout(handle);
      timeouts.delete(peerId);
    }
  }
  
  async function attempt(peerId) {
    if (!stateManager.isInParty()) return;
    if (peersThatLeft.has(peerId)) {
      clear(peerId);
      return;
    }
    const count = attempts.get(peerId) || 0;
    const maxAttempts = 5;
    const backoffDelay = Math.min(1000 * Math.pow(2, count), 30000);
    if (count >= maxAttempts) {
      clear(peerId);
      return;
    }
    attempts.set(peerId, count + 1);
    const existing = timeouts.get(peerId);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(async () => {
      const oldPc = peerConnections.get(peerId);
      if (oldPc) {
        try { oldPc.close(); } catch (e) {}
        peerConnections.delete(peerId);
      }
      try {
        const pc = createPeer(peerId);
        peerConnections.set(peerId, pc);
        const stream = typeof localStream === 'function' ? localStream() : localStream;
        if (stream) {
          stream.getTracks().forEach(t => addOrReplaceTrack(pc, t, stream));
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const state = stateManager.getState();
        sendSignal({ type: 'OFFER', from: state.userId, to: peerId, offer: pc.localDescription });
      } catch (err) {
        console.error('[WebRTCManager] Reconnection failed:', err);
        attempt(peerId);
      }
    }, backoffDelay);
    timeouts.set(peerId, handle);
  }
  
  return { attempt, clear };
}
