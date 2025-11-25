// state-manager.js - Manages party state and action tracking

export class StateManager {
  constructor() {
    // Party state
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    this.restoringPartyState = false;
    
    // Action tracking for echo prevention
    this.lastLocalAction = { type: null, time: 0 };
    this.lastRemoteAction = { type: null, time: 0 };
  }
  
  // Party state management
  startParty(userId, roomId) {
    this.partyActive = true;
    this.userId = userId;
    this.roomId = roomId;
    console.log('Party started! Room:', roomId, 'User:', userId);
  }
  
  stopParty() {
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    this.lastLocalAction = { type: null, time: 0 };
    this.lastRemoteAction = { type: null, time: 0 };
    console.log('Party stopped');
  }
  
  isActive() {
    return this.partyActive;
  }
  
  getUserId() {
    return this.userId;
  }
  
  getRoomId() {
    return this.roomId;
  }
  
  getState() {
    return {
      partyActive: this.partyActive,
      userId: this.userId,
      roomId: this.roomId,
      restoringPartyState: this.restoringPartyState
    };
  }
  
  setRestoringFlag(value) {
    this.restoringPartyState = value;
  }
  
  // Echo prevention helpers
  isEcho(actionType) {
    const now = Date.now();
    const timeSinceLocal = now - this.lastLocalAction.time;
    
    // If we just performed this action within 500ms, it's likely an echo
    if (this.lastLocalAction.type === actionType && timeSinceLocal < 500) {
      console.log(`Ignoring echo of ${actionType} (${timeSinceLocal}ms ago)`);
      return true;
    }
    return false;
  }
  
  recordLocalAction(actionType) {
    this.lastLocalAction = { type: actionType, time: Date.now() };
    console.log(`Recorded local action: ${actionType}`);
  }
  
  recordRemoteAction(actionType) {
    this.lastRemoteAction = { type: actionType, time: Date.now() };
    console.log(`Recorded remote action: ${actionType}`);
  }
  
  getTimeSinceLocalAction() {
    return Date.now() - this.lastLocalAction.time;
  }
  
  getTimeSinceRemoteAction() {
    return Date.now() - this.lastRemoteAction.time;
  }
  
  // Extension context validation
  isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }
  
  // Safe message sending
  safeSendMessage(message, callback) {
    if (!this.isExtensionContextValid()) {
      console.warn('Extension context invalidated - please reload the page');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.warn('Failed to send message, extension may have been reloaded:', e.message);
    }
  }
}
