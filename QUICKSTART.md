# Quick Start - Netflix Party Sync

## 🏃 30-Second Setup

```bash
# 1. Start signaling server
cd /Users/jtoper/DEV/toperparty/signaling_server
npm install
npm start

# Server running on port 4001
```

Then:

1. Open `chrome://extensions/`
2. Enable "Developer mode" 
3. Click "Load unpacked"
4. Select `/Users/jtoper/DEV/toperparty/chrome-extension`
5. Go to Netflix.com
6. Click extension icon → "Start Party"
7. Share Room ID with friend
8. Friend enters Room ID and clicks "Start Party"
9. 🎉 Done! You're synced!

## 📍 File Locations

```
/Users/jtoper/DEV/toperparty/
├── signaling_server/
│   ├── server.js          ← WebSocket server (must run)
│   ├── package.json
│   └── Dockerfile
│
└── chrome-extension/      ← Load this into Chrome
    ├── manifest.json
    ├── background.js      ← Main logic
    ├── content-script.js  ← Netflix injection
    ├── popup.html         ← Extension UI
    ├── popup.js
    ├── styles.css
    ├── images/
    ├── README.md
    ├── SETUP.md          ← Full installation guide
    └── IMPLEMENTATION_GUIDE.md  ← Detailed reference
```

## 🔗 Connection

```
User A (Netflix + Extension)
         ↓
   WebSocket Server
   (ws://watch.toper.dev/ws)
         ↓
User B (Netflix + Extension)
```

## 🎮 How to Use

### Start Party (User A)
1. Netflix → Click extension icon
2. Leave room ID blank (auto-generated) or enter custom ID
3. Click "Start Party"
4. Allow camera/mic permissions
5. Copy the Room ID shown

### Join Party (User B)
1. Netflix → Click extension icon
2. Enter Room ID from User A
3. Click "Start Party"
4. Allow camera/mic permissions
5. Synced! ✅

## 📊 What Gets Synced

| Feature | Synced | How |
|---------|--------|-----|
| Play/Pause | ✅ | Automatically via WebSocket |
| Playback Time | ✅ | Every 5 seconds |
| Camera Feed | ✅ | WebRTC P2P streaming |
| Microphone | ✅ | WebRTC P2P streaming |
| Video Quality | ❌ | Each user controls their own |

## 🔧 Troubleshooting 101

| Problem | Fix |
|---------|-----|
| "Can't connect" | Run `npm start` in signaling_server/ |
| "No camera/mic" | Click "Allow" in permission prompt, check Settings |
| "Playback not syncing" | Hard refresh Netflix (Cmd+Shift+R) |
| "Extension won't load" | Check manifest.json syntax or reload extension |
| "Can't see friend's video" | Both must be Connected, check camera permissions |

## 📖 For More Details

- **Installation**: See `chrome-extension/SETUP.md`
- **Features**: See `chrome-extension/README.md`
- **Architecture**: See `IMPLEMENTATION_GUIDE.md`
- **Customization**: See `IMPLEMENTATION_GUIDE.md` section

## 🚀 Running Components

```
Terminal 1 (Signaling Server):
$ cd signaling_server && npm start
> Signaling server listening on 0.0.0.0:4001

Chrome (Extension):
1. Navigate to netflix.com
2. Click extension icon
3. Click "Start Party"
4. Invite friend with Room ID
```

## 📱 What Happens Behind the Scenes

1. **User A starts party**
   - Extension calls getUserMedia() for camera/mic
   - Connects to WebSocket server
   - Sends JOIN message with Room ID

2. **User B joins with same Room ID**
   - Extension calls getUserMedia()
   - Connects to WebSocket server
   - Sends JOIN message with same Room ID

3. **Signaling server bridges them**
   - Forwards JOIN message to all in room
   - User A sees User B joined
   - User A initiates WebRTC connection
   - Exchange offer/answer/ICE candidates

4. **WebRTC connection established**
   - Both have direct P2P connection
   - Media streams flowing
   - Playback sync via WebSocket

5. **Playback stays synced**
   - Content Script monitors Netflix video
   - Sends play/pause events
   - Sends time sync every 5 seconds
   - WebSocket delivers to other user
   - Other user's Content Script applies changes

## 🎯 Key Endpoints

```
WebSocket Server: ws://watch.toper.dev/ws
  ↳ Signaling for WebRTC (offers/answers)
  ↳ Playback control broadcast
  ↳ Room management

STUN Servers (Built-in):
  ↳ stun:stun.l.google.com:19302
  ↳ stun:stun1.l.google.com:19302
  ↳ Used for NAT traversal (P2P connection)
```

## ❓ Common Questions

**Q: Does the server see our Netflix content?**
A: No, media streams directly between peers (P2P). Server only handles signaling.

**Q: Is my microphone always on?**
A: No, only when party is active. Stop by clicking "Stop Party".

**Q: Can I control my friend's Netflix?**
A: No, sync is automatic based on play/pause. Direct control possible with custom UI mod.

**Q: How many people can join?**
A: Technically unlimited, but each person gets all media streams (bandwidth scales).

**Q: What if we're not on the same network?**
A: Works fine! Server is public. May need TURN server if behind symmetric NAT.

## 📋 Checklist Before You Start

- [ ] Signaling server running (`npm start` in signaling_server/)
- [ ] Extension loaded in Chrome (`chrome://extensions/`)
- [ ] Both users have Netflix open
- [ ] Both have camera/mic connected
- [ ] Both allow permissions when prompted
- [ ] Internet connection working

## 🎬 You're Ready!

Questions? Check `chrome-extension/SETUP.md` for detailed troubleshooting.

Enjoy your synchronized Netflix watching! 🍿
