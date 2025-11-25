// url-sync.js - Manages URL monitoring and party state persistence
// Note: Keeping this simple for now, full extraction in future refactor

export class URLSync {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.urlMonitorInterval = null;
    this.lastUrl = null;
  }
  
  start() {
    this.lastUrl = window.location.href;
    // URL monitoring logic will be moved here in full extraction
  }
  
  stop() {
    if (this.urlMonitorInterval) {
      clearInterval(this.urlMonitorInterval);
      this.urlMonitorInterval = null;
    }
  }
  
  saveState() {
    // Party state persistence logic will be moved here
    const state = this.stateManager.getState();
    if (state.partyActive) {
      sessionStorage.setItem('toperparty_restore', JSON.stringify({
        userId: state.userId,
        roomId: state.roomId,
        timestamp: Date.now()
      }));
    }
  }
  
  clearState() {
    sessionStorage.removeItem('toperparty_restore');
  }
  
  getRestorationState() {
    const stored = sessionStorage.getItem('toperparty_restore');
    if (!stored) return null;
    
    try {
      const state = JSON.parse(stored);
      // Check if restoration state is recent (within 30 seconds)
      if (Date.now() - state.timestamp < 30000) {
        return state;
      }
    } catch (e) {
      console.error('[toperparty] Failed to parse restoration state:', e);
    }
    
    return null;
  }
}
