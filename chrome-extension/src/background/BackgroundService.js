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
      this.ws = new WebSocket('ws://watch.toper.dev/ws');
      this.ws.onopen = () => {
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
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'SIGNAL', message }).catch(() => {});
        });
      });
      
      if (message.type === 'PLAYBACK_CONTROL' && message.userId !== this.userId) {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_PLAYBACK_CONTROL', control: message.control, timestamp: message.timestamp, fromUserId: message.userId }).catch(() => {});
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
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SEEK', currentTime: message.currentTime, isPlaying: message.isPlaying, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      
      if (message.type === 'URL_CHANGE' && message.userId !== this.userId) {
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
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SYNC_RESPONSE', currentTime: message.currentTime, isPlaying: message.isPlaying, fromUserId: message.fromUserId }).catch(() => {});
          });
        });
      }
    } catch (err) {
      console.error('Error handling signaling message:', err);
    }
  }

  broadcastMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  getStatus() {
    return { isConnected: this.isConnected, roomId: this.roomId, userId: this.userId, hasLocalStream: !!this.localStream };
  }
}
