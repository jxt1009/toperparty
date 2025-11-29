export class StateManager {
  constructor() {
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    this.restoringPartyState = false;
  }
  startParty(userId, roomId) {
    this.partyActive = true;
    this.userId = userId;
    this.roomId = roomId;
  }
  stopParty() {
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
  }
  isActive() { return this.partyActive; }
  getUserId() { return this.userId; }
  getRoomId() { return this.roomId; }
  getState() {
    return { partyActive: this.partyActive, userId: this.userId, roomId: this.roomId, restoringPartyState: this.restoringPartyState };
  }
  isInParty() { return !!(this.partyActive && this.userId && this.roomId); }
  setRestoringFlag(value) { this.restoringPartyState = value; }
  isExtensionContextValid() {
    try { return chrome.runtime && chrome.runtime.id; } catch { return false; }
  }
  safeSendMessage(message, callback) {
    if (!this.isExtensionContextValid()) {
      console.warn('[StateManager] Extension context invalid, cannot send message');
      return;
    }
    console.log('[StateManager] Sending message:', message.type, message);
    try { 
      chrome.runtime.sendMessage(message, callback); 
    } catch (e) { 
      console.warn('[StateManager] Failed to send message:', e.message); 
    }
  }
}
