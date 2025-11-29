export class URLSync {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.urlMonitorInterval = null;
    this.lastUrl = null;
  }
  
  start() { 
    this.lastUrl = window.location.href;
    console.log('[URLSync] Starting URL monitoring, current URL:', this.lastUrl);
    
    // Clear any existing interval
    if (this.urlMonitorInterval) {
      clearInterval(this.urlMonitorInterval);
    }
    
    // Monitor for URL changes every 500ms
    this.urlMonitorInterval = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        console.log('[URLSync] URL changed from', this.lastUrl, 'to', currentUrl);
        this.lastUrl = currentUrl;
        
        // Broadcast URL change to other clients
        const state = this.stateManager.getState();
        if (state.partyActive) {
          console.log('[URLSync] Broadcasting URL change to party');
          this.stateManager.safeSendMessage({ 
            type: 'URL_CHANGE', 
            url: currentUrl 
          });
        }
      }
    }, 500);
  }
  
  stop() {
    console.log('[URLSync] Stopping URL monitoring');
    if (this.urlMonitorInterval) { 
      clearInterval(this.urlMonitorInterval); 
      this.urlMonitorInterval = null; 
    }
    this.lastUrl = null;
  }
  saveState() {
    const state = this.stateManager.getState();
    if (!state.partyActive) return;
    const existing = this.getRestorationState() || {};
    const payload = {
      roomId: state.roomId,
      currentTime: existing.currentTime || null,
      isPlaying: typeof existing.isPlaying === 'boolean' ? existing.isPlaying : null,
      timestamp: Date.now()
    };
    sessionStorage.setItem('toperparty_restore', JSON.stringify(payload));
  }
  clearState() { sessionStorage.removeItem('toperparty_restore'); }
  getRestorationState() {
    const stored = sessionStorage.getItem('toperparty_restore');
    if (!stored) return null;
    try {
      const state = JSON.parse(stored);
      if (Date.now() - state.timestamp < 30000) { return state; }
    } catch (e) { console.error('[toperparty] Failed to parse restoration state:', e); }
    return null;
  }
}
