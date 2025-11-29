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
      console.warn('[StateManager] Extension context invalid - page needs reload after extension update');
      // Show user notification that they need to reload
      if (!document.getElementById('toperparty-reload-notice')) {
        const notice = document.createElement('div');
        notice.id = 'toperparty-reload-notice';
        notice.style.cssText = 'position:fixed;top:20px;right:20px;background:#e50914;color:white;padding:15px;border-radius:8px;z-index:99999;font-family:Arial;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
        notice.innerHTML = '<strong>ToperParty:</strong> Extension updated. Please reload this page.';
        document.body.appendChild(notice);
      }
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
