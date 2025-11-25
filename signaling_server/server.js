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

function broadcast(sender, message) {
  wss.clients.forEach((client) => {
    if (client !== sender && client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws, req) => {
  const remote = req?.socket?.remoteAddress || 'unknown';
  console.log('Client connected', remote);

  ws.on('message', (msg) => {
    const text = msg.toString();
    console.log('Received:', text);
    // Broadcast to all clients except sender
    broadcast(ws, text);
  });

  ws.on('close', () => console.log('Client disconnected', remote));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down signaling server');
  wss.close(() => server.close(() => process.exit(0)));
});
