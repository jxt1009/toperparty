import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 4001, server: "127.0.0.1"});

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
});

