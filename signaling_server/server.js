import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 4001, host: '0.0.0.0' });

  console.log('Client started');
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (msg) => {
    console.log('Received:', msg.toString());
    // Broadcast to all clients except sender
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(msg.toString());
      }
    });
  });

  ws.on('close', () => console.log('Client disconnected'));
});
