import { createSignalingHandlers } from './signaling.js';
import { createPeerConnectionFactory, addOrReplaceTrack } from './peerConnection.js';
import { createReconnectionManager } from './reconnect.js';
import { createRemoteVideoManager } from './ui.js';

export class WebRTCManager {
  constructor(stateManager, uiManager) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;
    this.peerConnections = new Map();
    this.remoteStreams = this.uiManager.getRemoteStreams();
    this.remoteVideos = this.uiManager.getRemoteVideos();
    this.peersThatLeft = new Set();
    this.localStream = null;

    const videoManager = createRemoteVideoManager(this.remoteVideos);
    
    const reconnectionManager = createReconnectionManager({
      stateManager: this.stateManager,
      peerConnections: this.peerConnections,
      peersThatLeft: this.peersThatLeft,
      localStream: () => this.localStream,
      createPeer: null,
      sendSignal: (msg) => this._sendSignal(msg),
      addOrReplaceTrack
    });

    const createPeer = createPeerConnectionFactory({
      stateManager: this.stateManager,
      sendSignal: (msg) => this._sendSignal(msg),
      remoteStreams: this.remoteStreams,
      remoteVideos: this.remoteVideos,
      addRemoteVideo: videoManager.add,
      attemptReconnection: reconnectionManager.attempt,
      clearReconnection: reconnectionManager.clear,
      removeRemoteVideo: (peerId) => {
        videoManager.remove(peerId);
        this.remoteStreams.delete(peerId);
      },
      peersThatLeft: this.peersThatLeft
    });

    reconnectionManager.createPeer = createPeer;
    this.reconnectionManager = reconnectionManager;
    this.createPeer = createPeer;
    this.videoManager = videoManager;

    this.signalingHandlers = createSignalingHandlers({
      getState: () => this.stateManager.getState(),
      peerConnections: this.peerConnections,
      peersThatLeft: this.peersThatLeft,
      getLocalStream: () => this.localStream,
      createPeer,
      sendSignal: (msg) => this._sendSignal(msg),
      addOrReplaceTrack,
      clearReconnection: reconnectionManager.clear,
      removeRemoteVideo: (peerId) => {
        videoManager.remove(peerId);
        this.remoteStreams.delete(peerId);
      }
    });
  }

  setLocalStream(stream) { this.localStream = stream; }
  getLocalStream() { return this.localStream; }
  
  onLocalStreamAvailable(stream) {
    this.localStream = stream;
    this.peerConnections.forEach((pc) => {
      try {
        stream.getTracks().forEach(t => addOrReplaceTrack(pc, t, stream));
      } catch (e) {}
    });
  }

  async handleSignal(message) {
    console.log('[WebRTCManager] handleSignal called with:', message);
    if (!message || !message.type) {
      console.warn('[WebRTCManager] Invalid message:', message);
      return;
    }
    const type = message.type;
    const from = message.userId || message.from;
    const to = message.to;
    const state = this.stateManager.getState();
    console.log('[WebRTCManager] Processing signal type:', type, 'from:', from, 'to:', to, 'myId:', state.userId);
    
    if (to && to !== state.userId) {
      console.log('[WebRTCManager] Ignoring message not meant for me');
      return;
    }

    if (type === 'JOIN' && from && from !== state.userId) {
      console.log('[WebRTCManager] Dispatching to handleJoin');
      await this.signalingHandlers.handleJoin(from);
    } else if (type === 'OFFER' && message.offer && from && from !== state.userId) {
      console.log('[WebRTCManager] Dispatching to handleOffer');
      await this.signalingHandlers.handleOffer(from, message.offer);
    } else if (type === 'ANSWER' && message.answer && from && from !== state.userId) {
      console.log('[WebRTCManager] Dispatching to handleAnswer');
      await this.signalingHandlers.handleAnswer(from, message.answer);
    } else if (type === 'ICE_CANDIDATE' && message.candidate && from && from !== state.userId) {
      console.log('[WebRTCManager] Dispatching to handleIceCandidate');
      await this.signalingHandlers.handleIceCandidate(from, message.candidate);
    } else if (type === 'LEAVE' && from) {
      console.log('[WebRTCManager] Dispatching to handleLeave');
      this.signalingHandlers.handleLeave(from);
    } else {
      console.log('[WebRTCManager] Signal not handled - type:', type, 'from:', from, 'conditions not met');
    }
  }

  attemptReconnection(peerId) {
    return this.reconnectionManager.attempt(peerId);
  }

  _sendSignal(message) {
    this.stateManager.safeSendMessage({ type: 'SIGNAL_SEND', message }, function() {});
  }

  clearAll() {
    this.peerConnections.forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    this.peerConnections.clear();
    this.peersThatLeft.clear();
    this.remoteVideos.forEach((v) => {
      try { if (v.srcObject) v.srcObject = null; } catch (e) {}
      v.remove();
    });
    this.remoteVideos.clear();
    this.remoteStreams.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
