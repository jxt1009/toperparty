// netflix-api-bridge.js - Injected into page context to access Netflix API
// This runs in the page context, not the extension context

(function() {
  // Netflix Player API Helper - runs in page context
  window.__toperparty_netflix = {
    getPlayer: function() {
      try {
        const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const sessionId = videoPlayer.getAllPlayerSessionIds()[0];
        return videoPlayer.getVideoPlayerBySessionId(sessionId);
      } catch (e) {
        console.warn('Failed to get Netflix player:', e);
        return null;
      }
    },
    
    play: function() {
      const player = this.getPlayer();
      if (player) player.play();
    },
    
    pause: function() {
      const player = this.getPlayer();
      if (player) player.pause();
    },
    
    seek: function(timeMs) {
      const player = this.getPlayer();
      if (player) player.seek(timeMs);
    },
    
    getCurrentTime: function() {
      const player = this.getPlayer();
      return player ? player.getCurrentTime() : 0;
    },
    
    isPaused: function() {
      const player = this.getPlayer();
      return player ? player.isPaused() : true;
    }
  };
  
  // Listen for commands from content script
  document.addEventListener('__toperparty_command', function(e) {
    const { command, args } = e.detail;
    if (window.__toperparty_netflix[command]) {
      const result = window.__toperparty_netflix[command].apply(window.__toperparty_netflix, args || []);
      document.dispatchEvent(new CustomEvent('__toperparty_response', { detail: { command, result } }));
    }
  });
})();
