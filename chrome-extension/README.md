# Netflix Party Sync Chrome Extension

A Chrome extension that enables real-time Netflix watch-party synchronization with webcam/mic sharing between multiple parties.

## Features

- 🎬 **Netflix Playback Sync** - Automatically syncs play/pause and playback time across all connected peers
- 🎥 **Webcam & Mic Sharing** - Stream your video and audio to all connected party members using WebRTC
- 🔗 **WebRTC P2P** - Direct peer-to-peer connections for low-latency media streaming
- 🎛️ **Playback Controls** - Quick play/pause buttons injected into Netflix interface
- 🆔 **Room-based Connections** - Join specific rooms by room ID
- 📱 **Real-time Sync** - Periodic synchronization to prevent playback drift

## Installation

1. Build the extension (it's ready to use):
   ```bash
   # No build step needed - extension is ready to load
   ```

2. Load into Chrome:
   - Open `chrome://extensions/` in Chrome
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `chrome-extension` folder

3. Create placeholder icons (optional):
   ```bash
   # Create 16x16, 48x48, and 128x128 PNG icons and place in images/ folder
   mkdir images
   ```

## Usage

### Starting a Party

1. Navigate to Netflix.com
2. Click the extension icon in Chrome toolbar
3. Optionally enter a room ID (or leave blank for auto-generated)
4. Click "Start Party"
5. Grant microphone/camera permissions when prompted
6. Share the Room ID with your friend

### Joining a Party

Your friend should:
1. Click the extension icon
2. Enter the same Room ID
3. Click "Start Party"
4. Grant permissions
5. You'll be synced automatically!

### Playback Control

- Play/pause actions are automatically synced
- Playback time syncs every 5 seconds
- Manual sync buttons available in the popup (▶ Play / ⏸ Pause)
- Netflix controls work normally alongside party sync

## Architecture

### Components

- **background.js** - Manages WebSocket signaling, WebRTC peer connections, and media streams
- **content-script.js** - Injects into Netflix pages to monitor and control video playback
- **popup.js/popup.html** - User interface for starting/stopping parties and viewing streams
- **manifest.json** - Extension configuration and permissions

### Communication Flow

```
User A (Netflix)            User B (Netflix)
    ↓                            ↓
Content Script ←→ Background ←→ Signaling Server ←→ Background ←→ Content Script
                      ↓                                ↓
                  WebRTC P2P ←→←→←→ WebRTC P2P
```

### Media Transmission

- **Signaling**: WebSocket (signaling server) at `ws://watch.toper.dev/ws`
- **Media**: WebRTC (peer-to-peer) using STUN servers for NAT traversal
- **Format**: H264 video codec (default) with Opus audio codec

## Server Requirements

Requires a WebSocket signaling server running at `ws://watch.toper.dev/ws`

The included `signaling_server/server.js` handles:
- User join/leave events
- WebRTC offer/answer/ICE candidate exchange
- Broadcasting playback control messages

## Configuration

### Modify Server URL

To change the WebSocket server URL, edit `background.js`:

```javascript
ws = new WebSocket('ws://your-server-url/ws');
```

### Adjust Video Quality

In `background.js`, modify the `getUserMedia` constraints:

```javascript
localStream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 } }, // Higher resolution
  audio: true
});
```

### Playback Sync Interval

In `content-script.js`, change the sync interval (default: 5000ms):

```javascript
window.playbackSyncInterval = setInterval(() => {
  // ... sync code
}, 5000); // Change this value
```

## Permissions Explained

- `activeTab` - Access current Netflix tab
- `scripting` - Inject content script into Netflix
- `webRequest` - Monitor requests
- `tabs` - Get tab information
- `mediaStream` - Access webcam and microphone
- `host_permissions: https://www.netflix.com/*` - Run on Netflix domain

## Troubleshooting

### Microphone/Camera Not Working
- Check Chrome permissions for microphone/camera
- Reload the extension
- Check browser console (right-click → Inspect) for errors

### Not Connecting to Server
- Verify `ws://watch.toper.dev/ws` is accessible
- Check firewall settings
- Verify signaling server is running

### Video/Audio Not Transmitting
- Check STUN server connectivity (may need TURN server for symmetric NAT)
- Verify peer connection state in console
- Check browser console for WebRTC errors

### Playback Not Syncing
- Verify both parties have Netflix tab open
- Check content script is loaded (test by clicking extension)
- Check browser console for injection errors

## Advanced Setup: TURN Server

For connections behind symmetric NATs, configure a TURN server in `background.js`:

```javascript
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    {
      urls: ['turn:your-turn-server.com:3478'],
      username: 'user',
      credential: 'password'
    }
  ]
};
```

## Security Notes

- All WebRTC media is encrypted (DTLS-SRTP)
- Room IDs are transmitted in plaintext via WebSocket
- For production use, implement proper authentication and encryption
- Consider running signaling server over WSS (WebSocket Secure) with SSL certificates

## License

MIT
