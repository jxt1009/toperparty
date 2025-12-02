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
    // Don't generate a new userId - keep the existing one so peers can still communicate
    // Only reconnect to the server with the same userId
    backgroundService.stopParty(false);
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
    console.log('[Background] Broadcasting PLAY_PAUSE:', request.control, 'at', request.currentTime);
    backgroundService.broadcastMessage({
      type: 'PLAY_PAUSE',
      control: request.control,
      currentTime: request.currentTime,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_TIME') {
    backgroundService.broadcastMessage({
      type: 'SYNC_PLAYBACK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SEEK') {
    backgroundService.broadcastMessage({
      type: 'SEEK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'URL_CHANGE') {
    console.log('[Background] Broadcasting URL_CHANGE:', request.url);
    backgroundService.broadcastMessage({
      type: 'URL_CHANGE',
      url: request.url,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'REQUEST_SYNC') {
    backgroundService.broadcastMessage({
      type: 'REQUEST_SYNC',
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_RESPONSE') {
    console.log('[Background] Forwarding SYNC_RESPONSE to', request.targetUserId, 'with URL:', request.url);
    if (backgroundService.ws && backgroundService.ws.readyState === WebSocket.OPEN) {
      backgroundService.ws.send(JSON.stringify({
        type: 'SYNC_RESPONSE',
        to: request.targetUserId,
        currentTime: request.currentTime,
        isPlaying: request.isPlaying,
        url: request.url,
        fromUserId: backgroundService.userId,
        roomId: backgroundService.roomId
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
