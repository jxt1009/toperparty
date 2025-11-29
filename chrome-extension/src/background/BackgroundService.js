export class BackgroundService {
  constructor() {
    this.ws = null;
    this.localStream = null;
    this.isConnected = false;
    this.roomId = null;
    this.userId = this.generateUserId();
  }

  generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
  }

  async startParty(inputRoomId) {
    this.roomId = inputRoomId || 'default_room_' + Date.now();
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          if (tabs.length === 0) {
            this.getMediaStreamInBackground()
              .then(() => this.connectToSignalingServer(resolve, reject))
              .catch(reject);
          } else {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'REQUEST_MEDIA_STREAM' }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn('Content script not ready, trying background:', chrome.runtime.lastError);
                this.getMediaStreamInBackground()
                  .then(() => this.connectToSignalingServer(resolve, reject))
                  .catch(reject);
                return;
              }
              if (response && response.success) {
                this.connectToSignalingServer(resolve, reject);
              } else {
                this.getMediaStreamInBackground()
                  .then(() => this.connectToSignalingServer(resolve, reject))
                  .catch(reject);
              }
            });
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async getMediaStreamInBackground() {
    console.log('Note: Media stream will be obtained from Netflix page');
    return;
  }

  connectToSignalingServer(resolve, reject) {
    try {
      console.log('[BackgroundService] Connecting to signaling server...');
      this.ws = new WebSocket('ws://watch.toper.dev/ws');
      this.ws.onopen = () => {
        console.log('[BackgroundService] Connected to signaling server');
        this.isConnected = true;
        this.ws.send(JSON.stringify({ type: 'JOIN', userId: this.userId, roomId: this.roomId, timestamp: Date.now() }));
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'PARTY_STARTED', userId: this.userId, roomId: this.roomId }).catch(() => {});
          });
        });
        resolve();
      };
      this.ws.onmessage = (event) => this.handleSignalingMessage(event.data);
      this.ws.onerror = (error) => reject(new Error('Failed to connect to signaling server'));
      this.ws.onclose = () => {
        this.isConnected = false;
        this.cleanup();
      };
    } catch (err) {
      reject(err);
    }
  }

  stopParty(sendLeaveSignal = true) {
    if (this.ws) {
      if (sendLeaveSignal) {
        try {
          this.ws.send(JSON.stringify({ type: 'LEAVE', userId: this.userId, roomId: this.roomId, timestamp: Date.now() }));
        } catch (e) {}
      }
      this.ws.close();
      this.ws = null;
    }
    this.cleanup();
    this.isConnected = false;
    chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'PARTY_STOPPED' }).catch(() => {});
      });
    });
  }

  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }

  async handleSignalingMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('[BackgroundService] Received signaling message:', message.type);
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'SIGNAL', message }).catch(() => {});
        });
      });
      
      if (message.type === 'PLAY_PAUSE' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding PLAY_PAUSE to content:', message.control, 'at', message.currentTime, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_PLAYBACK_CONTROL', control: message.control, currentTime: message.currentTime, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      
      if (message.type === 'SYNC_PLAYBACK' && message.userId !== this.userId) {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SYNC_PLAYBACK', currentTime: message.currentTime, isPlaying: message.isPlaying, timestamp: message.timestamp, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      
      if (message.type === 'SEEK' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding SEEK to content:', message.currentTime, 'playing:', message.isPlaying, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SEEK', currentTime: message.currentTime, isPlaying: message.isPlaying, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      
      if (message.type === 'URL_CHANGE' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding URL_CHANGE to content:', message.url, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_URL_CHANGE', url: message.url, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      
      if (message.type === 'REQUEST_SYNC' && message.userId !== this.userId) {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'HANDLE_REQUEST_SYNC', fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      
      if (message.type === 'SYNC_RESPONSE' && message.to === this.userId) {
        console.log('[BackgroundService] Received SYNC_RESPONSE for me, forwarding to content with URL:', message.url);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SYNC_RESPONSE', currentTime: message.currentTime, isPlaying: message.isPlaying, fromUserId: message.fromUserId, url: message.url }).catch(() => {});
          });
        });
      }
    } catch (err) {
      console.error('Error handling signaling message:', err);
    }
  }

  broadcastMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[BackgroundService] Broadcasting message:', message.type, message);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[BackgroundService] Cannot broadcast - WebSocket not open:', this.ws ? this.ws.readyState : 'no ws');
    }
  }

  getStatus() {
    return { isConnected: this.isConnected, roomId: this.roomId, userId: this.userId, hasLocalStream: !!this.localStream };
  }
}
