import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 4001;
const HOST = '0.0.0.0';

// Simple HTTP server so we can mount the WebSocketServer on the same port/path
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Signaling server is running');
});

const wss = new WebSocketServer({ server, path: '/ws' });

server.listen(PORT, HOST, () => {
  console.log(`Signaling server listening on ${HOST}:${PORT}`);
});

// Track rooms and users
const rooms = new Map();
const userRooms = new Map();

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
  }
  rooms.get(roomId).add(ws);
  userRooms.set(ws, { userId, roomId });
}

function removeUserFromRoom(ws) {
  if (userRooms.has(ws)) {
    const { roomId } = userRooms.get(ws);
    if (rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
      }
    }
    userRooms.delete(ws);
  }
}

wss.on('connection', (ws, req) => {
  const remote = req?.socket?.remoteAddress || 'unknown';
  console.log('Client connected', remote);

  ws.on('message', (msg) => {
    const text = msg.toString();
    try {
      const parsed = JSON.parse(text);
      const { type, roomId, userId } = parsed;

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
        // For all other messages, send to room
        broadcastToRoom(ws, roomId, text);
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
