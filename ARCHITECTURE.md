# System Architecture & Data Flow

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chrome Browser                          │
│                                                                   │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐
│  │   Netflix Tab (User A)       │  │   Extension Popup (User A)   │
│  │                              │  │                              │
│  │  ┌──────────────────────┐   │  │  ┌─────────────────────────┐ │
│  │  │  <video> player      │   │  │  │  Status: Connected ✅   │ │
│  │  │  Netflix HTML/CSS    │   │  │  │  Room: abc-123-def      │ │
│  │  └──────────────────────┘   │  │  │  User: user_xyz123      │ │
│  │           ↑                   │  │  │                         │ │
│  │     Updates from             │  │  │  ┌─────────────────────┐ │
│  │  Content Script              │  │  │  │ [Your Camera]       │ │
│  │           ↑                   │  │  │  │ [Remote Camera]     │ │
│  │  ┌──────────────────────┐   │  │  │  └─────────────────────┘ │
│  │  │  content-script.js   │   │  │  │                         │ │
│  │  │  - Monitor play/pause│   │  │  │  [Start] [Stop]         │ │
│  │  │  - Inject controls   │   │  │  └─────────────────────────┘ │
│  │  │  - Sync time         │   │  │                              │
│  │  └──────────────────────┘   │  └─────────────────────────────┘
│  └──────────────┬───────────────┘
│                 │
│  ┌──────────────▼───────────────────────────────────────────────┐
│  │             Service Worker (background.js)                   │
│  │                                                               │
│  │  ┌────────────────────────────────────────────────────────┐  │
│  │  │ WebSocket Connection Manager                           │  │
│  │  │ - Maintains ws:// connection to signaling server       │  │
│  │  │ - Handles JOIN/LEAVE messages                          │  │
│  │  │ - Routes playback control messages                     │  │
│  │  └────────────────────────────────────────────────────────┘  │
│  │  ┌────────────────────────────────────────────────────────┐  │
│  │  │ WebRTC Peer Manager                                    │  │
│  │  │ - Creates/manages RTCPeerConnection                    │  │
│  │  │ - Handles offer/answer/ICE exchange                    │  │
│  │  │ - Manages media streams                                │  │
│  │  └────────────────────────────────────────────────────────┘  │
│  │  ┌────────────────────────────────────────────────────────┐  │
│  │  │ getUserMedia Handler                                   │  │
│  │  │ - Captures camera/microphone                           │  │
│  │  │ - Adds tracks to WebRTC connection                     │  │
│  │  └────────────────────────────────────────────────────────┘  │
│  └──────────────┬────────────────────────────────────────────┬───┘
│                 │                                              │
│        ┌────────▼─────────┐                         ┌─────────▼────────┐
│        │  Message Passing │                         │  Media Streams    │
│        │  (chrome.runtime │                         │  (WebRTC)         │
│        │   .sendMessage)  │                         │  getUserMedia()   │
│        └────────┬─────────┘                         └─────────┬────────┘
└─────────────────┼──────────────────────────────────────────────┼─────────┘
                  │                                               │
                  │ WebSocket                         P2P Media (DTLS-SRTP)
                  │                                               │
                  │      ┌──────────────────────┐                │
                  └─────►│ Signaling Server     │                │
                         │ (Node.js + ws)       │                │
                         │ - Room management    │                │
                         │ - Message broadcast  │                │
                         │ - ICE relay          │                │
                         │ ws://watch.toper.dev │                │
                         └──────────────────────┘                │
                                   │                              │
                                   │ (User B gets signaling)      │
                                   │ (Media flows P2P)            │
                                   │                              │
                         ┌─────────▼──────────┐                  │
                         │  User B's Browser  │◄─────────────────┘
                         │  (Same as User A)  │
                         └────────────────────┘
```

## 📨 Message Flow Diagram

### 1. Playback Sync Message Flow

```
User A: Press Play on Netflix
  │
  ├─► Netflix HTML fires 'play' event
  │
  ├─► content-script.js detects 'play' event
  │
  ├─► Sends message to background.js:
  │   {
  │     type: 'PLAY_PAUSE',
  │     control: 'play',
  │     timestamp: 42.5
  │   }
  │
  ├─► background.js receives message
  │
  ├─► Broadcasts via WebSocket:
  │   {
  │     type: 'PLAYBACK_CONTROL',
  │     control: 'play',
  │     userId: 'user_abc',
  │     roomId: 'room_xyz'
  │   }
  │
  ├─► Signaling Server receives
  │
  ├─► Server forwards to all in room_xyz
  │   (except sender)
  │
  ├─► User B's background.js receives
  │
  ├─► Sends message to User B's content-script:
  │   {
  │     type: 'APPLY_PLAYBACK_CONTROL',
  │     control: 'play'
  │   }
  │
  ├─► User B's content-script calls:
  │   document.querySelector('video').play()
  │
  └─► User B's Netflix plays! ✅
```

### 2. WebRTC Connection Establishment

```
User A starts party:
  │
  ├─► Calls getUserMedia({video, audio})
  │
  ├─► Gets local stream
  │
  ├─► Sends JOIN message via WebSocket:
  │   {
  │     type: 'JOIN',
  │     userId: 'userA',
  │     roomId: 'party123'
  │   }
  │
User B joins same room:
  │
  ├─► Calls getUserMedia({video, audio})
  │
  ├─► Gets local stream
  │
  ├─► Sends JOIN message:
  │   {
  │     type: 'JOIN',
  │     userId: 'userB',
  │     roomId: 'party123'
  │   }
  │
User A's background.js gets JOIN from User B:
  │
  ├─► Creates RTCPeerConnection
  │
  ├─► Adds User A's media tracks to PC
  │
  ├─► Creates WebRTC offer
  │
  ├─► Sets local description
  │
  ├─► Sends offer via WebSocket:
  │   {
  │     type: 'OFFER',
  │     from: 'userA',
  │     to: 'userB',
  │     offer: {...}
  │   }
  │
User B's background.js receives OFFER:
  │
  ├─► Creates RTCPeerConnection
  │
  ├─► Adds User B's media tracks to PC
  │
  ├─► Sets remote description (offer)
  │
  ├─► Creates answer
  │
  ├─► Sets local description
  │
  ├─► Sends answer via WebSocket:
  │   {
  │     type: 'ANSWER',
  │     from: 'userB',
  │     to: 'userA',
  │     answer: {...}
  │   }
  │
User A's background.js receives ANSWER:
  │
  ├─► Sets remote description (answer)
  │
(Meanwhile, both sides gathering ICE candidates)
  │
  ├─► Each sends ICE_CANDIDATE via WebSocket:
  │   {
  │     type: 'ICE_CANDIDATE',
  │     from: 'userA',
  │     to: 'userB',
  │     candidate: {...}
  │   }
  │
  ├─► Receiver adds candidate to PC
  │
(ICE candidates complete)
  │
├─► RTCPeerConnection state: 'connected'
│
├─► Media streams flowing!
│
└─► Both users see each other's video ✅
```

## 🔌 Component Communication Matrix

```
┌──────────────────┬──────────────────┬──────────────────┬──────────────┐
│   Component      │   Netflix Page   │   Background.js  │   Signaling  │
├──────────────────┼──────────────────┼──────────────────┼──────────────┤
│ Netflix Page     │   -              │ sendMessage()    │   -          │
│ (Content Script) │                  │ (JSON)           │              │
├──────────────────┼──────────────────┼──────────────────┼──────────────┤
│ Background.js    │ runtime.         │   -              │ WebSocket    │
│                  │ sendMessage()    │                  │ send/receive │
│                  │ (JSON)           │                  │ (JSON)       │
├──────────────────┼──────────────────┼──────────────────┼──────────────┤
│ Signaling Server │   -              │ WebSocket        │   -          │
│                  │                  │ send/receive     │              │
│                  │                  │ (JSON)           │              │
└──────────────────┴──────────────────┴──────────────────┴──────────────┘

Additional Channel: WebRTC P2P
  background.js ←─────► background.js (User B)
  Media Streams (encrypted with DTLS-SRTP)
```

## 📊 Data Structure Examples

### Room State (on Signaling Server)

```javascript
rooms = {
  'party_abc123': Set[
    WebSocket { /* User A */ },
    WebSocket { /* User B */ }
  ],
  'party_xyz789': Set[
    WebSocket { /* User C */ }
  ]
}

userRooms = {
  WebSocket { /* User A */ }: { userId: 'userA', roomId: 'party_abc123' },
  WebSocket { /* User B */ }: { userId: 'userB', roomId: 'party_abc123' },
  WebSocket { /* User C */ }: { userId: 'userC', roomId: 'party_xyz789' }
}
```

### Background.js State

```javascript
{
  ws: WebSocket,                     // Connected to signaling server
  localStream: MediaStream,          // User's camera + mic
  peerConnections: Map {
    'userB': RTCPeerConnection { ... },  // For User B
    'userC': RTCPeerConnection { ... }   // For User C
  },
  isConnected: true,
  roomId: 'party_abc123',
  userId: 'userA'
}
```

### WebRTC Connection State

```javascript
RTCPeerConnection {
  // Local state
  localDescription: RTCSessionDescription { ... },
  signalingState: 'stable',
  iceConnectionState: 'connected',
  connectionState: 'connected',
  
  // Media tracks
  senders: [
    RTCRtpSender { track: VideoTrack },
    RTCRtpSender { track: AudioTrack }
  ],
  
  // Remote state
  remoteDescription: RTCSessionDescription { ... },
  receivers: [
    RTCRtpReceiver { track: VideoTrack },
    RTCRtpReceiver { track: AudioTrack }
  ]
}
```

## 🔄 State Transitions

### Connection Lifecycle

```
[START]
  │
  ├─► User clicks "Start Party"
  │
  ├─► [REQUESTING_PERMISSIONS]
  │      getUserMedia() waits for user
  │
  ├─► [CONNECTING]
  │      WebSocket connection established
  │      JOIN message sent
  │
  ├─► [CONNECTED]
  │      Waiting for peers or...
  │      (if peer joins)
  │
  ├─► [WEBRTC_NEGOTIATING]
  │      Offer/answer/ICE exchange
  │
  ├─► [SYNCED] ✅
  │      Media streaming
  │      Playback syncing
  │
  ├─► [STOPPING]
  │      User clicks "Stop Party"
  │
  ├─► [DISCONNECTING]
  │      WebSocket close
  │      RTCPeerConnections close
  │      Media tracks stopped
  │
  └─► [END]
```

## 📡 Protocol Details

### WebSocket Messages (Signaling)

```javascript
// Room Management
{ type: 'JOIN', userId, roomId, timestamp }
{ type: 'LEAVE', userId, roomId, timestamp }

// WebRTC Signaling
{ type: 'OFFER', from, to, offer }
{ type: 'ANSWER', from, to, answer }
{ type: 'ICE_CANDIDATE', from, to, candidate }

// Playback Control
{ type: 'PLAYBACK_CONTROL', control, userId, timestamp }
{ type: 'SYNC_PLAYBACK', currentTime, isPlaying, userId }
```

### WebRTC Media

```
H.264 Video Codec (browser default)
Opus Audio Codec (browser default)
DTLS-SRTP Encryption (mandatory)
STUN for NAT Traversal
UDP Transport
```

## 🎯 Critical Paths

### Path 1: Play/Pause Sync (Fastest)
```
Netflix ──► Content Script ──► Background ──► WebSocket ──► Server
                                                  ↓
                              ┌─────────────────────┘
                              │
                  ┌───────────┴──────────┐
                  │                      │
            User B's Background ◄────────┘
                  │
                  ├─► Content Script
                  │
                  └─► Netflix (Synced!)
```
Latency: 50-200ms (network dependent)

### Path 2: Media Streaming (Parallel)
```
User A Camera/Mic
         │
   getUserMedia()
         │
   WebRTC PC ─────────► STUN/TURN ─────────► WebRTC PC (User B)
         │                                          │
         └─── Direct P2P if possible ──────────────┘

Latency: 100-500ms (network dependent)
Encryption: DTLS-SRTP (automatic)
```

## 🔐 Security Layers

```
┌─ Application Layer ─────────────────────────────────┐
│ Room-based isolation (room IDs)                     │
└─────────────────────────────────────────────────────┘
         │
┌─ API Layer ─────────────────────────────────────────┐
│ Content Script origin isolation                     │
│ Service Worker sandboxing                           │
└─────────────────────────────────────────────────────┘
         │
┌─ Transport Layer ──────────────────────────────────┐
│ WebSocket (TCP, stateful)                          │
│ WebRTC (DTLS encryption + SRTP for media)          │
└─────────────────────────────────────────────────────┘
         │
┌─ Network Layer ────────────────────────────────────┐
│ Browser sandbox                                     │
│ OS firewall/NAT                                    │
└─────────────────────────────────────────────────────┘
```

This multi-layer approach ensures isolation and encryption at each level.
