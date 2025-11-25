# File-by-File Implementation Guide

## Core Extension Files

### 1. `manifest.json` - Extension Configuration
**Purpose**: Defines extension metadata, permissions, and configuration
**Key Sections**:
- `manifest_version: 3` - Latest Chrome extension standard
- `permissions` - Required: activeTab, scripting, tabs, mediaStream
- `host_permissions` - Netflix.com only
- `background.service_worker` - background.js
- `content_scripts` - content-script.js injected into Netflix
- `action` - Popup configuration

### 2. `background.js` - Service Worker (300+ lines)
**Purpose**: Main application logic
**Handles**:
```javascript
// WebSocket Management
├─ Connect to ws://watch.toper.dev/ws
├─ Handle JOIN/LEAVE messages
├─ Route playback control messages
└─ Manage room membership

// WebRTC Peer Management
├─ Create RTCPeerConnection per peer
├─ Handle offer/answer negotiation
├─ Manage ICE candidates
├─ Track connection states
└─ Handle media track addition

// getUserMedia (Camera/Mic)
├─ Request camera/microphone access
├─ Create MediaStream
├─ Add tracks to WebRTC connection
└─ Handle permission errors

// Message Routing
├─ Receive messages from content-script.js
├─ Send messages to signaling server
└─ Distribute received messages to content-script
```

### 3. `content-script.js` - Netflix Page Injection (100+ lines)
**Purpose**: Interact with Netflix player
**Handles**:
```javascript
// Video Monitoring
├─ Find Netflix video element
├─ Monitor play events
├─ Monitor pause events
└─ Track current time

// Event Broadcasting
├─ Send play/pause to background.js
├─ Send time sync every 5 seconds
└─ Include timestamp for validation

// Remote Control Application
├─ Receive play command from background.js
├─ Execute video.play()
├─ Receive pause command
├─ Execute video.pause()
└─ Set video.currentTime for time sync
```

### 4. `popup.html` - User Interface (80 lines)
**Purpose**: Extension popup interface
**Sections**:
```html
<!-- Header -->
Logo and title

<!-- Status Display -->
Connected/Disconnected indicator (color coded)

<!-- Controls Section -->
- Room ID input field
- Start Party button
- Stop Party button

<!-- Party Info Display -->
Room ID with copy-to-clipboard
User ID display
Media streaming status

<!-- Video Section -->
Local video (your camera)
Remote video (other user's camera)

<!-- Footer -->
Server URL display
```

### 5. `popup.js` - Popup Logic (150+ lines)
**Purpose**: Handle popup UI interactions
**Handles**:
```javascript
// Status Management
├─ Get connection status from background
├─ Update UI based on status
├─ Poll every 2 seconds for updates
└─ Display connection state

// Party Control
├─ Start party (with optional room ID)
├─ Stop party
└─ Handle errors

// Video Display
├─ Get local stream from background
├─ Display in <video id="local-video">
├─ Receive remote stream from background
└─ Display in <video id="remote-video">

// Room ID Management
├─ Display room ID
├─ Copy to clipboard functionality
└─ Provide feedback on copy
```

### 6. `styles.css` - Styling (200+ lines)
**Purpose**: Netflix-themed dark UI
**Features**:
```css
/* Colors */
Netflix red: #E50914
Dark background: #0F0F0F, #1a1a1a
Text: #e0e0e0

/* Components */
Connected status: Green (#4caf50)
Disconnected status: Red (#f44336)
Buttons: Netflix red with hover effects
Video grid: 2 columns, rounded corners
Input fields: Dark with red focus border

/* Responsive Design */
Fixed width: 500px
Flex layout for responsiveness
Grid layout for videos
```

## Supporting Files

### `images/icon*.svg` - Extension Icons
- `icon16.svg` - Toolbar icon (16×16)
- `icon48.svg` - Smaller icon (48×48)
- `icon128.svg` - Larger icon (128×128)

**Content**: Play button symbol with Netflix red (#E50914) on dark background

## Documentation Files

### Top-level Documentation

**README.md**
- Project overview
- File structure
- Quick start checklist
- What was implemented
- Next steps

**QUICKSTART.md** ⭐ START HERE
- 30-second setup
- File locations
- Quick reference
- Common Q&A
- Basic troubleshooting

**IMPLEMENTATION_GUIDE.md**
- Technical architecture
- Message flow diagrams
- Configuration options
- Advanced setup
- Future enhancements
- Testing procedures

**IMPLEMENTATION_SUMMARY.md**
- Delivery summary
- Feature checklist
- Architecture overview
- Performance metrics
- Design decisions

**ARCHITECTURE.md**
- System diagrams (ASCII art)
- Message flow examples
- Data structures
- State transitions
- Security layers
- Critical paths

### Extension Documentation

**chrome-extension/README.md**
- Feature overview
- Installation instructions
- Usage guide
- Server requirements
- Configuration guide
- Troubleshooting
- Security notes

**chrome-extension/SETUP.md**
- Complete setup guide
- Advanced configuration
- Troubleshooting (detailed)
- Architecture overview
- Testing checklist
- Support information

## Server Enhancement

### `signaling_server/server.js` - WebSocket Server
**Original**: Simple broadcast server
**Enhanced With**:
```javascript
// Room Management
const rooms = new Map();           // roomId → Set of WebSockets
const userRooms = new Map();       // WebSocket → {userId, roomId}

// Functions
addUserToRoom(ws, userId, roomId)
  ├─ Add WebSocket to room Set
  ├─ Track user-to-room mapping
  └─ Create room if doesn't exist

removeUserFromRoom(ws)
  ├─ Remove WebSocket from room
  ├─ Clean up empty rooms
  └─ Update user tracking

broadcastToRoom(sender, roomId, message)
  ├─ Find all clients in room
  ├─ Send message to all except sender
  └─ Maintain room isolation

// Message Handling
if (type === 'JOIN')
  └─ Add user to room, broadcast to others
if (type === 'LEAVE')
  └─ Remove user from room, broadcast goodbye
else
  └─ Broadcast message to room
```

## Data Flow Through Files

### Playback Sync Flow
```
Netflix Player
    ↓
content-script.js
  └─ Detects play/pause event
    ↓
chrome.runtime.sendMessage({type: 'PLAY_PAUSE'})
    ↓
background.js
  ├─ Receives message
  ├─ Broadcasts via WebSocket
  ↓
signaling_server/server.js
  ├─ Routes to room
  ↓
Other User's background.js
  ├─ Receives message
  ↓
chrome.tabs.sendMessage({type: 'APPLY_PLAYBACK_CONTROL'})
    ↓
Other User's content-script.js
  ├─ Applies play/pause
    ↓
Other User's Netflix Player
```

### Media Stream Flow
```
Camera/Microphone
    ↓
background.js
  ├─ getUserMedia({video, audio})
  ├─ Create RTCPeerConnection
  ├─ Add tracks to PC
    ↓
WebRTC P2P (DTLS-SRTP encrypted)
    ↓
Other User's background.js
  ├─ Receives tracks via ontrack event
  ├─ Creates MediaStream
    ↓
popup.js
  ├─ Receives stream
    ↓
popup.html
  ├─ <video> element displays stream
```

## Key Integration Points

### Extension ↔ Netflix Page
- **What**: Content script monitors video player
- **How**: DOM queries, event listeners
- **Files**: content-script.js (injects), popup.html (controls)

### Extension ↔ Signaling Server
- **What**: WebSocket messaging
- **How**: JSON messages over WebSocket
- **Files**: background.js (connects), server.js (receives)

### Extension ↔ Remote Peer
- **What**: WebRTC media streaming
- **How**: ICE candidates, offer/answer
- **Files**: background.js (negotiates), signaling server (relays signaling)

### Popup ↔ Background
- **What**: Status queries, party control
- **How**: chrome.runtime.sendMessage()
- **Files**: popup.js (queries), background.js (handles)

## Testing the Implementation

### Single File Tests
1. **manifest.json**
   - Load extension in Chrome
   - Should appear in chrome://extensions/
   - No syntax errors

2. **content-script.js**
   - Open Netflix.com
   - Open DevTools → Console
   - Should see "Content script loaded on Netflix page"

3. **background.js**
   - Click extension icon
   - Click "Start Party"
   - Should connect to WebSocket
   - Check DevTools → Application → Service Workers

4. **popup.html/popup.js**
   - Click extension icon
   - Popup should appear
   - Status should update in real-time
   - No console errors

### Integration Tests
1. **Single User**
   - Start party
   - Should show "Connected"
   - Should see room ID
   - Should see camera feed

2. **Two Users**
   - User A starts party
   - User B joins with same room ID
   - Both should see "Connected"
   - Both should see each other's cameras
   - Play/pause should sync

## Modifying the Implementation

### To Change Server URL
```javascript
// File: background.js, line ~58
- ws = new WebSocket('ws://watch.toper.dev/ws');
+ ws = new WebSocket('ws://your-domain.com/ws');
```

### To Adjust Video Quality
```javascript
// File: background.js, line ~86
- video: { width: { ideal: 640 }, height: { ideal: 480 } }
+ video: { width: { ideal: 1280 }, height: { ideal: 720 } }
```

### To Change UI Colors
```css
/* File: styles.css */
- --primary-color: #e50914;  /* Netflix red */
+ --primary-color: #your-color;
```

### To Add Features
1. Add message type in background.js
2. Send from content-script.js
3. Receive in popup.js
4. Update UI in popup.html/styles.css

---

## Summary

- **manifest.json** ← Configuration
- **background.js** ← Core logic (WebRTC, WebSocket)
- **content-script.js** ← Netflix integration
- **popup.html/js/css** ← User interface
- **server.js** ← Message coordination
- **Documentation** ← Reference guides

All files work together to create a seamless Netflix watch party experience! 🎬
