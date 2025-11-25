// webrtc-manager.js - Manages WebRTC peer connections
// Note: This is a large module that handles peer connections, signaling, and reconnection logic
// For now, keeping the core WebRTC functionality in the main file to avoid breaking changes
// TODO: Extract this properly in a future refactor

export class WebRTCManager {
  constructor(stateManager) {
    this.state = stateManager;
    this.peerConnections = new Map();
    this.reconnectionAttempts = new Map();
    this.reconnectionTimeouts = new Map();
    this.localStream = null;
  }
  
  setLocalStream(stream) {
    this.localStream = stream;
  }
  
  getLocalStream() {
    return this.localStream;
  }
  
  getPeerConnections() {
    return this.peerConnections;
  }
  
  getReconnectionAttempts() {
    return this.reconnectionAttempts;
  }
  
  getReconnectionTimeouts() {
    return this.reconnectionTimeouts;
  }
  
  clearAll() {
    // Close all peer connections
    this.peerConnections.forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    this.peerConnections.clear();
    
    // Clear reconnection state
    this.reconnectionTimeouts.forEach((timeoutHandle) => {
      clearTimeout(timeoutHandle);
    });
    this.reconnectionTimeouts.clear();
    this.reconnectionAttempts.clear();
    
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
