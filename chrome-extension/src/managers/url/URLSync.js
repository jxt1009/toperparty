export class URLSync {
  constructor(stateManager, onWatchPageChange, onNavigateToWatch) {
    this.stateManager = stateManager;
    this.urlMonitorInterval = null;
    this.lastUrl = null;
    this.onWatchPageChange = onWatchPageChange || (() => {});
    this.onNavigateToWatch = onNavigateToWatch || (() => {});
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
        const lastPath = this.lastUrl ? new URL(this.lastUrl).pathname : '';
        const currentPath = new URL(currentUrl).pathname;
        
        // Check if we navigated to a different /watch page or left /watch
        const wasOnWatch = lastPath.startsWith('/watch');
        const nowOnWatch = currentPath.startsWith('/watch');
        const watchPageChanged = wasOnWatch && nowOnWatch && lastPath !== currentPath;
        const navigatedToWatch = !wasOnWatch && nowOnWatch;
        const leftWatch = wasOnWatch && !nowOnWatch;
        
        this.lastUrl = currentUrl;
        
        // If we changed to a different /watch page, reinitialize sync
        if (watchPageChanged) {
          console.log('[URLSync] Watch page changed - triggering sync reinitialization');
          this.onWatchPageChange();
        }
        
        // If we navigated TO a /watch page from elsewhere, initialize sync
        if (navigatedToWatch) {
          console.log('[URLSync] Navigated to /watch page - triggering sync initialization');
          this.onNavigateToWatch();
        }
        
        const state = this.stateManager.getState();
        
        // Broadcast all Netflix URL changes to the party
        // This keeps everyone synchronized on browse, title pages, etc.
        if (state.partyActive) {
          console.log('[URLSync] Broadcasting URL change to party:', currentPath);
          this.stateManager.safeSendMessage({ 
            type: 'URL_CHANGE', 
            url: currentUrl 
          });
        }
        
        // If someone leaves /watch, pause the video for everyone
        if (state.partyActive && leftWatch) {
          console.log('[URLSync] Left /watch page - sending pause to all clients');
          this.stateManager.safeSendMessage({ 
            type: 'PLAY_PAUSE', 
            control: 'pause',
            timestamp: 0
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
