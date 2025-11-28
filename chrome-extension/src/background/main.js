import { BackgroundService } from './BackgroundService.js';

const backgroundService = new BackgroundService();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_PARTY') {
    backgroundService.startParty(request.roomId).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.type === 'STOP_PARTY') {
    backgroundService.stopParty();
    sendResponse({ success: true });
  }

  if (request.type === 'RESTORE_PARTY') {
    backgroundService.stopParty(false);
    backgroundService.userId = backgroundService.generateUserId();
    backgroundService.startParty(request.roomId).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.type === 'GET_STATUS') {
    sendResponse(backgroundService.getStatus());
    return true;
  }

  if (request.type === 'PLAY_PAUSE') {
    backgroundService.broadcastMessage({
      type: 'PLAYBACK_CONTROL',
      control: request.control,
      timestamp: request.timestamp,
      userId: backgroundService.userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_TIME') {
    backgroundService.broadcastMessage({
      type: 'SYNC_PLAYBACK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId: backgroundService.userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SEEK') {
    backgroundService.broadcastMessage({
      type: 'SEEK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId: backgroundService.userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'URL_CHANGE') {
    backgroundService.broadcastMessage({
      type: 'URL_CHANGE',
      url: request.url,
      userId: backgroundService.userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'REQUEST_SYNC') {
    backgroundService.broadcastMessage({
      type: 'REQUEST_SYNC',
      userId: backgroundService.userId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_RESPONSE') {
    if (backgroundService.ws && backgroundService.ws.readyState === WebSocket.OPEN) {
      backgroundService.ws.send(JSON.stringify({
        type: 'SYNC_RESPONSE',
        to: request.targetUserId,
        currentTime: request.currentTime,
        isPlaying: request.isPlaying,
        fromUserId: backgroundService.userId
      }));
    }
    sendResponse({ success: true });
  }

  if (request.type === 'SIGNAL_SEND') {
    const msg = Object.assign({}, request.message || {});
    msg.userId = msg.userId || backgroundService.userId;
    msg.roomId = msg.roomId || backgroundService.roomId;
    if (backgroundService.ws && backgroundService.ws.readyState === WebSocket.OPEN) {
      try {
        backgroundService.ws.send(JSON.stringify(msg));
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: 'Not connected to signaling server' });
    }
    return true;
  }
});
