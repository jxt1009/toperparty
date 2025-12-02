export class BackgroundService {
  constructor() {
    this.ws = null;
    this.localStream = null;
    this.isConnected = false;
    this.roomId = null;
    this.userId = this.generateUserId();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.missedHeartbeats = 0;
  }

  generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
  }

  async startParty(inputRoomId) {
    this.roomId = inputRoomId || 'default_room_' + Date.now();
    this.intentionalDisconnect = false; // Reset flag so reconnection works
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
        this.reconnectAttempts = 0;
        this.missedHeartbeats = 0;
        this.ws.send(JSON.stringify({ type: 'JOIN', userId: this.userId, roomId: this.roomId, timestamp: Date.now() }));
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'PARTY_STARTED', userId: this.userId, roomId: this.roomId }).catch(() => {});
            chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_INITIAL_SYNC_AND_PLAY' }).catch(() => {});
          });
        });
        this.startHeartbeat();
        resolve();
      };
      this.ws.onmessage = (event) => this.handleSignalingMessage(event.data);
      this.ws.onerror = (error) => {
        console.warn('[BackgroundService] WebSocket error:', error);
        if (this.reconnectAttempts === 0) {
          reject(new Error('Failed to connect to signaling server'));
        }
      };
      this.ws.onclose = () => {
        console.log('[BackgroundService] WebSocket closed');
        this.isConnected = false;
        if (!this.intentionalDisconnect && this.roomId) {
          this.attemptReconnection();
        } else {
          this.cleanup();
        }
      };
    } catch (err) {
      reject(err);
    }
  }

  stopParty(sendLeaveSignal = true) {
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.reconnectAttempts = 0;
    
    // Only fully tear down if this is a real stop (not a reconnection)
    if (sendLeaveSignal) {
      this.roomId = null;
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'PARTY_STOPPED' }).catch(() => {});
        });
      });
    }
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
      
      // Handle PONG response to reset heartbeat
      if (message.type === 'PONG') {
        if (this.heartbeatTimeout) {
          clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = null;
        }
        this.missedHeartbeats = 0;
        console.log('[BackgroundService] Heartbeat acknowledged');
        return;
      }
      
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

  attemptReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[BackgroundService] Max reconnection attempts reached. Party disconnected.');
      this.stopParty(false);
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[BackgroundService] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  reconnect() {
    console.log('[BackgroundService] Reconnecting to signaling server...');
    this.intentionalDisconnect = false;
    try {
      this.ws = new WebSocket('ws://watch.toper.dev/ws');
      this.ws.onopen = () => {
        console.log('[BackgroundService] Reconnected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.missedHeartbeats = 0;
        this.ws.send(JSON.stringify({ 
          type: 'JOIN', 
          userId: this.userId, 
          roomId: this.roomId, 
          timestamp: Date.now() 
        }));
        this.startHeartbeat();
        console.log('[BackgroundService] Rejoined room after reconnection');
      };
      this.ws.onmessage = (event) => this.handleSignalingMessage(event.data);
      this.ws.onerror = (error) => {
        console.warn('[BackgroundService] Reconnection WebSocket error:', error);
      };
      this.ws.onclose = () => {
        console.log('[BackgroundService] Reconnected WebSocket closed');
        this.isConnected = false;
        if (!this.intentionalDisconnect && this.roomId) {
          this.attemptReconnection();
        }
      };
    } catch (err) {
      console.error('[BackgroundService] Reconnection failed:', err);
      this.attemptReconnection();
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

  startHeartbeat() {
    this.stopHeartbeat();
    console.log('[BackgroundService] Starting heartbeat monitoring');
    
    // Send ping every 15 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'PING', userId: this.userId, timestamp: Date.now() }));
          
          // Set timeout to detect if we don't get a response
          this.heartbeatTimeout = setTimeout(() => {
            this.missedHeartbeats++;
            console.warn('[BackgroundService] Missed heartbeat response. Count:', this.missedHeartbeats);
            
            // If we miss 3 heartbeats (45 seconds), assume connection is dead
            if (this.missedHeartbeats >= 3) {
              console.error('[BackgroundService] Connection appears dead, forcing reconnection');
              this.stopHeartbeat();
              if (this.ws) {
                this.ws.close();
              }
            }
          }, 10000); // 10 second timeout for response
        } catch (e) {
          console.error('[BackgroundService] Error sending ping:', e);
        }
      } else {
        console.warn('[BackgroundService] WebSocket not open, stopping heartbeat');
        this.stopHeartbeat();
      }
    }, 15000); // Every 15 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    this.missedHeartbeats = 0;
  }

  getStatus() {
    return { isConnected: this.isConnected, roomId: this.roomId, userId: this.userId, hasLocalStream: !!this.localStream };
  }
}
