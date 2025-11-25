// netflix-controller.js - Netflix player API wrapper

export class NetflixController {
  constructor() {
    this.injectAPIBridge();
  }
  
  // Inject Netflix API access script into page context
  injectAPIBridge() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('netflix-api-bridge.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = function() {
      console.log('Netflix API bridge loaded');
      script.remove();
    };
  }
  
  // Send command to Netflix API via custom events
  _sendCommand(command, args = []) {
    return new Promise(function(resolve) {
      const handler = function(e) {
        if (e.detail.command === command) {
          document.removeEventListener('__toperparty_response', handler);
          resolve(e.detail.result);
        }
      };
      document.addEventListener('__toperparty_response', handler);
      setTimeout(function() { resolve(null); }, 1000); // timeout fallback
      document.dispatchEvent(new CustomEvent('__toperparty_command', { detail: { command, args } }));
    });
  }
  
  play() {
    return this._sendCommand('play');
  }
  
  pause() {
    return this._sendCommand('pause');
  }
  
  seek(timeMs) {
    return this._sendCommand('seek', [timeMs]);
  }
  
  getCurrentTime() {
    return this._sendCommand('getCurrentTime');
  }
  
  isPaused() {
    return this._sendCommand('isPaused');
  }
  
  // Find Netflix video element (fallback)
  getVideoElement() {
    return document.querySelector('video');
  }
}
