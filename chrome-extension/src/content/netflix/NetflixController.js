export class NetflixController {
  constructor() { this.injectAPIBridge(); }
  injectAPIBridge() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('netflix-api-bridge.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = function() { script.remove(); };
  }
  _sendCommand(command, args = []) {
    return new Promise(function(resolve) {
      const handler = function(e) {
        if (e.detail.command === command) {
          document.removeEventListener('__toperparty_response', handler);
          resolve(e.detail.result);
        }
      };
      document.addEventListener('__toperparty_response', handler);
      setTimeout(function() { resolve(null); }, 1000);
      document.dispatchEvent(new CustomEvent('__toperparty_command', { detail: { command, args } }));
    });
  }
  play() { return this._sendCommand('play'); }
  pause() { return this._sendCommand('pause'); }
  seek(timeMs) { return this._sendCommand('seek', [timeMs]); }
  getCurrentTime() { return this._sendCommand('getCurrentTime'); }
  isPaused() { return this._sendCommand('isPaused'); }
  setVolume(level) { return this._sendCommand('setVolume', [level]); }
  getVolume() { return this._sendCommand('getVolume'); }
  getVideoElement() { 
    // Find Netflix main player video element, excluding ToperParty videos and preview videos
    const videos = document.querySelectorAll('video');
    let mainVideo = null;
    let maxArea = 0;
    
    for (const video of videos) {
      // Skip ToperParty videos
      if (video.id && video.id.startsWith('toperparty-')) {
        continue;
      }
      
      // Skip hidden or very small videos (likely previews)
      const rect = video.getBoundingClientRect();
      if (rect.width < 400 || rect.height < 300) {
        continue;
      }
      
      // Find the largest video (main player is typically fullscreen or large)
      const area = rect.width * rect.height;
      if (area > maxArea) {
        maxArea = area;
        mainVideo = video;
      }
    }
    
    return mainVideo;
  }
}
