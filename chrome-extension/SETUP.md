# Netflix Party Sync - Installation & Setup Guide

## Quick Start

### 1. Ensure Signaling Server is Running

Your WebSocket server needs to be running at `ws://watch.toper.dev/ws`. 

From the `signaling_server` directory:

```bash
npm install
npm start
```

The server will listen on port 4001.

### 2. Load Extension into Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Navigate to `/Users/jtoper/DEV/toperparty/chrome-extension`
5. Click "Select" to load the extension

You should see the extension icon appear in your Chrome toolbar.

### 3. Test the Extension

1. Go to `netflix.com` and login
2. Start playing a show
3. Click the Netflix Party Sync extension icon
4. Click "Start Party"
5. Allow microphone and camera permissions
6. You should see:
   - ✓ Green "Connected" status
   - Your Room ID (share this with friends)
   - Your webcam feed in the popup

### 4. Connect With a Friend

Have your friend:

1. Install the extension on their Chrome browser (same steps as above)
2. Go to `netflix.com`
3. Click the extension icon
4. Enter your Room ID in the input field
5. Click "Start Party"
6. Grant permissions
7. Both of you should now be synced!

## Features Overview

### Playback Synchronization
- ✅ Play/pause events are automatically broadcast
- ✅ Playback time syncs every 5 seconds
- ✅ Uses 500ms threshold to avoid constant micro-adjustments
- ✅ Works with Netflix's native play/pause controls

### Media Streaming
- ✅ Webcam and microphone captured via `getUserMedia`
- ✅ WebRTC peer-to-peer transmission for low latency
- ✅ STUN servers for NAT traversal
- ✅ Video displayed in real-time in popup

### Signaling
- ✅ WebSocket connection to central signaling server
- ✅ Automatic WebRTC offer/answer exchange
- ✅ ICE candidate gathering and sharing
- ✅ Room-based connection isolation

## Troubleshooting

### Extension Won't Load
**Problem**: "This extension is not listed on the Chrome Web Store"
**Solution**: This is normal for unpacked extensions. Click "Details" to see more info. This warning can be ignored.

### Can't Connect to Server
**Problem**: "Failed to connect to signaling server"
**Solution**:
- Verify signaling server is running: `npm start` in `signaling_server/`
- Verify you can access `ws://watch.toper.dev/` (or your server address)
- Check firewall settings
- Check browser console (F12) for detailed error

### Microphone/Camera Not Working
**Problem**: "Could not access webcam/mic. Please check permissions."
**Solution**:
- Chrome should prompt you for camera/mic permissions - click "Allow"
- If you blocked it by mistake:
  - Click the lock icon next to the URL
  - Find Camera and Microphone permissions
  - Change them to "Allow"
  - Reload the extension by clicking the extension icon again
  - Restart the party

### Playback Not Syncing
**Problem**: One person presses play but other person's video doesn't change
**Solution**:
- Verify content script loaded: Check browser console (F12) for "Content script loaded on Netflix page"
- Make sure both people have Netflix open in a tab
- Try a hard refresh of Netflix (Cmd+Shift+R on Mac)
- Check that the other person sees "Connected" status in the popup

### Video Feed Not Showing
**Problem**: Video section shows but streams are black
**Solution**:
- Verify permissions are granted
- Check camera/mic work in other apps (Photo Booth, Voice Memos)
- Try unplugging/replugging webcam if external
- Restart Chrome
- Try reloading the extension

### Experiencing High Latency
**Problem**: Audio/video is choppy or delayed
**Solution**:
- Check internet connection speed
- Reduce video quality in background.js (lower width/height in getUserMedia)
- Close other bandwidth-heavy applications
- Try using a TURN server if direct P2P isn't working

## Architecture Overview

### Message Flow

```
Netflix Video Player
        ↓
   Content Script
        ↓
   Background Script ←→ WebSocket → Signaling Server → WebSocket ← Background Script
        ↓                    ↓                              ↓
      WebRTC ←————————────────────────────────────────→ WebRTC
    (Media Stream)                                    (Media Stream)
```

### Key Technologies

- **WebSocket**: Signaling and play/pause control broadcast
- **WebRTC**: Peer-to-peer audio/video transmission
- **Content Script**: Netflix DOM manipulation and video monitoring
- **Service Worker**: Background task management and media handling

## Customization

### Change Server URL

Edit `background.js` line ~58:

```javascript
ws = new WebSocket('ws://watch.toper.dev/ws');
```

Change to your server address.

### Adjust Video Quality

Edit `background.js` line ~86:

```javascript
localStream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 640 }, height: { ideal: 480 } },  // ← Adjust these
  audio: true
});
```

Higher values = better quality but more bandwidth.

### Change Sync Interval

Edit `content-script.js` line ~54:

```javascript
}, 5000); // Change from 5000ms to desired interval
```

### Modify UI

- `popup.html` - HTML structure
- `popup.js` - Popup logic
- `styles.css` - Styling

## Security Considerations

### Current Limitations
- Room IDs are sent in plaintext over WebSocket
- No authentication required to join a room
- Signaling server can see who's communicating
- Media is encrypted (DTLS-SRTP) but room membership is public

### For Production Use
1. Add authentication token to WebSocket
2. Use WSS (WebSocket Secure) with SSL certificates
3. Implement server-side room access control
4. Add proper TURN server configuration
5. Consider end-to-end encryption for sensitive content

## Advanced Configuration

### Add TURN Server

If you're behind a symmetric NAT, add a TURN server in `background.js`:

```javascript
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    {
      urls: ['turn:turnserver.com:3478'],
      username: 'user',
      credential: 'pass'
    }
  ]
};
```

### Enable Detailed Logging

Add this to `background.js` after line 1:

```javascript
const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log('[Netflix Party]', ...args);
}
```

Then replace `console.log` with `log`.

## File Structure

```
chrome-extension/
├── manifest.json           # Extension configuration
├── background.js           # Service worker / main logic
├── content-script.js       # Netflix page injection
├── popup.html              # Extension popup UI
├── popup.js                # Popup logic
├── styles.css              # Styling
├── images/
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
├── README.md              # Feature documentation
└── SETUP.md              # This file
```

## Testing

### Manual Testing Checklist

- [ ] Extension loads without errors
- [ ] Popup appears when clicking extension icon
- [ ] Can start party and get room ID
- [ ] Camera/mic permissions prompt appears
- [ ] Camera feed shows in popup
- [ ] Second browser window can join with same room ID
- [ ] Play/pause on one side affects the other
- [ ] Video feed appears from remote user

### Debugging

1. Open extension popup → Right-click → "Inspect"
2. Check "Console" tab for errors
3. Check "Network" tab for WebSocket messages
4. On Netflix page → Press F12 → Check Console

## Common Issues & Solutions

| Issue | Cause | Fix |
|-------|-------|-----|
| Extension won't load | Manifest error | Check manifest.json syntax |
| No WebSocket connection | Server down | Verify signaling server is running |
| Video is black | Permissions denied | Check camera/mic permissions |
| Playback not syncing | Content script not loaded | Hard refresh Netflix (Cmd+Shift+R) |
| High latency | Network issue | Check bandwidth, try TURN server |
| Can't join room | Room ID wrong | Copy/paste room ID carefully |

## Support

For issues or questions:

1. Check browser console (F12) for error messages
2. Review troubleshooting section above
3. Check signaling server logs
4. Verify all components are running

Happy watching! 🎬
