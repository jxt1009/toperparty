import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 4001 });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
});

