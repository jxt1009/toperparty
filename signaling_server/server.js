import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 4001;
const HOST = '0.0.0.0';

// Simple HTTP server with status endpoint
const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const status = {
      activeRooms: rooms.size,
      activeUsers: userStates.size,
      rooms: Array.from(roomState.entries()).map(([roomId, state]) => ({
        roomId,
        userCount: rooms.get(roomId)?.size || 0,
        hostUserId: state.hostUserId,
        currentUrl: state.currentUrl,
        currentTime: state.currentTime,
        isPlaying: state.isPlaying,
        lastUpdate: new Date(state.lastUpdate).toISOString(),
        users: state.users ? Array.from(state.users.entries()).map(([userId, userData]) => ({
          userId,
          currentTime: userData.currentTime,
          isPlaying: userData.isPlaying,
          lastUpdate: new Date(userData.lastUpdate).toISOString()
        })) : []
      }))
    };
    res.end(JSON.stringify(status, null, 2));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Signaling server is running\nVisit /status for server info');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

server.listen(PORT, HOST, () => {
  console.log(`Signaling server listening on ${HOST}:${PORT}`);
});

// Track rooms and users with enhanced state
const rooms = new Map(); // roomId -> Set of WebSocket clients
const userRooms = new Map(); // WebSocket -> { userId, roomId }
const roomState = new Map(); // roomId -> { hostUserId, currentUrl, currentTime, isPlaying, lastUpdate, users: Map }
const userStates = new Map(); // userId -> { ws, lastHeartbeat, connectionQuality, currentTime, isPlaying }

function broadcastToRoom(sender, roomId, message) {
  if (!rooms.has(roomId)) return;
  
  const clients = rooms.get(roomId);
  clients.forEach((client) => {
    if (client !== sender && client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

function addUserToRoom(ws, userId, roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    // First user becomes the host
    roomState.set(roomId, {
      hostUserId: userId,
      currentUrl: null,
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      users: new Map() // userId -> { currentTime, isPlaying, lastUpdate }
    });
  }
  rooms.get(roomId).add(ws);
  userRooms.set(ws, { userId, roomId });
  userStates.set(userId, { 
    ws, 
    lastHeartbeat: Date.now(),
    connectionQuality: 'good',
    currentTime: 0,
    isPlaying: false
  });
  
  // Add user to room's user list and send room state to new user
  const roomData = roomState.get(roomId);
  if (roomData) {
    roomData.users.set(userId, {
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now()
    });
    
    // Send room state to new user
    if (roomData.currentUrl) {
      ws.send(JSON.stringify({
        type: 'ROOM_STATE',
        url: roomData.currentUrl,
        currentTime: roomData.currentTime,
        isPlaying: roomData.isPlaying,
        hostUserId: roomData.hostUserId
      }));
    }
  }
}

function removeUserFromRoom(ws) {
  if (userRooms.has(ws)) {
    const { userId, roomId } = userRooms.get(ws);
    userStates.delete(userId);
    
    if (rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      
      // Remove user from room's user list
      const roomData = roomState.get(roomId);
      if (roomData && roomData.users) {
        roomData.users.delete(userId);
      }
      
      // If room is empty, clean up
      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
        roomState.delete(roomId);
        console.log(`Room ${roomId} is now empty and removed`);
      } else {
        // If host left, assign new host
        if (roomData && roomData.hostUserId === userId) {
          const remainingClients = Array.from(rooms.get(roomId));
          if (remainingClients.length > 0) {
            const newHostUserRoom = userRooms.get(remainingClients[0]);
            if (newHostUserRoom) {
              state.hostUserId = newHostUserRoom.userId;
              console.log(`New host for room ${roomId}: ${state.hostUserId}`);
              
              // Notify room of new host
              broadcastToRoom(null, roomId, JSON.stringify({
                type: 'HOST_CHANGED',
                newHostUserId: state.hostUserId
              }));
            }
          }
        }
      }
    }
    userRooms.delete(ws);
  }
}

// Periodic health check and state sync
setInterval(() => {
  const now = Date.now();
  const timeout = 60000; // 60 seconds

  // Check for stale connections
  userStates.forEach((state, userId) => {
    if (now - state.lastHeartbeat > timeout) {
      console.log(`User ${userId} appears disconnected (no heartbeat for ${timeout}ms)`);
      state.connectionQuality = 'poor';
      
      // Force close stale connection
      if (state.ws && state.ws.readyState === state.ws.OPEN) {
        state.ws.close();
      }
    }
  });

  // Log room stats
  console.log(`Active rooms: ${rooms.size}, Active users: ${userStates.size}`);
}, 30000); // Check every 30 seconds

wss.on('connection', (ws, req) => {
  const remote = req?.socket?.remoteAddress || 'unknown';
  console.log('Client connected', remote);

  ws.on('message', (msg) => {
    const text = msg.toString();
    try {
      const parsed = JSON.parse(text);
      const { type, roomId, userId } = parsed;

      // Handle PING/PONG for connection health monitoring
      if (type === 'PING') {
        if (userId && userStates.has(userId)) {
          userStates.get(userId).lastHeartbeat = Date.now();
        }
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        return;
      }

      // Server-side sync state tracking
      if (type === 'URL_CHANGE' && roomId) {
        const state = roomState.get(roomId);
        if (state) {
          state.currentUrl = parsed.url;
          state.lastUpdate = Date.now();
          console.log(`Room ${roomId} URL updated: ${parsed.url}`);
        }
      }

      if (type === 'PLAY_PAUSE' && roomId) {
        const state = roomState.get(roomId);
        if (state) {
          state.isPlaying = parsed.control === 'play';
          if (parsed.currentTime !== undefined) {
            state.currentTime = parsed.currentTime;
          }
          state.lastUpdate = Date.now();
          
          // Update per-user state
          if (userId && state.users && state.users.has(userId)) {
            state.users.get(userId).isPlaying = state.isPlaying;
            if (parsed.currentTime !== undefined) {
              state.users.get(userId).currentTime = parsed.currentTime;
            }
            state.users.get(userId).lastUpdate = Date.now();
          }
          
          console.log(`Room ${roomId} playback: ${state.isPlaying ? 'playing' : 'paused'} at ${state.currentTime}s`);
        }
      }

      if (type === 'SEEK' && roomId) {
        const state = roomState.get(roomId);
        if (state && parsed.currentTime !== undefined) {
          state.currentTime = parsed.currentTime;
          state.isPlaying = parsed.isPlaying;
          state.lastUpdate = Date.now();
          
          // Update per-user state
          if (userId && state.users && state.users.has(userId)) {
            state.users.get(userId).currentTime = parsed.currentTime;
            state.users.get(userId).isPlaying = parsed.isPlaying;
            state.users.get(userId).lastUpdate = Date.now();
          }
          
          console.log(`Room ${roomId} seeked to ${state.currentTime}s`);
        }
      }

      // Handle sync requests with server-side state
      if (type === 'REQUEST_SYNC' && roomId) {
        const state = roomState.get(roomId);
        if (state && state.currentUrl) {
          // Server responds directly with known state
          ws.send(JSON.stringify({
            type: 'SYNC_RESPONSE',
            fromUserId: 'server',
            currentTime: state.currentTime,
            isPlaying: state.isPlaying,
            url: state.currentUrl,
            to: userId
          }));
          console.log(`Server provided sync state to ${userId}: ${state.currentTime}s ${state.isPlaying ? 'playing' : 'paused'}`);
          return; // Don't broadcast, server handled it
        }
      }

      if (type === 'JOIN' && roomId && userId) {
        addUserToRoom(ws, userId, roomId);
        console.log(`User ${userId} joined room ${roomId}`);
        // Broadcast to room
        broadcastToRoom(ws, roomId, text);
      } else if (type === 'LEAVE' && roomId) {
        console.log(`User left room ${roomId}`);
        broadcastToRoom(ws, roomId, text);
        removeUserFromRoom(ws);
      } else if (roomId) {
        // Check if this is a targeted message (has 'to' field)
        const targetUserId = parsed.to;
        if (targetUserId) {
          // Send only to the specific target user
          const targetState = userStates.get(targetUserId);
          if (targetState && targetState.ws && targetState.ws.readyState === targetState.ws.OPEN) {
            targetState.ws.send(text);
            // console.log(`Sent ${type} from ${userId} to ${targetUserId}`);
          } else {
            console.warn(`Cannot send ${type} to ${targetUserId} - user not found or not connected`);
          }
        } else {
          // Broadcast to room for non-targeted messages
          broadcastToRoom(ws, roomId, text);
        }
      } else {
        // Fallback: broadcast to all (legacy)
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === client.OPEN) {
            client.send(text);
          }
        });
      }
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  });

  ws.on('close', () => {
    removeUserFromRoom(ws);
    console.log('Client disconnected', remote);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down signaling server');
  wss.close(() => server.close(() => process.exit(0)));
});
