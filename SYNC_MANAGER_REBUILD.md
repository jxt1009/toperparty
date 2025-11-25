# Sync Manager Rebuild - Clean Solution

## The Core Problem

The old approach relied on timestamp-based echo detection, which created race conditions:
- Recording actions after executing them
- Complex timing windows (2s, 3s, 4s, 6s...)
- Stale message handling
- Passive sync being too aggressive

## The New Solution

### Key Innovation: Broadcast Suppression Flag

Instead of trying to detect echoes after the fact, we **prevent them from happening**:

```javascript
suppressBroadcast = false; // Simple flag

// When we programmatically control video:
this.suppressBroadcast = true;
await this.netflix.play(); // This triggers 'play' event
// Event handler sees suppressBroadcast=true, doesn't broadcast
this.suppressBroadcast = false;
```

### Simple Event Logic

**All event handlers now have one simple check:**
```javascript
const onPlay = () => {
  if (!this.state.isActive()) return;
  if (this.suppressBroadcast) return; // ← ONLY CHECK NEEDED
  
  console.log('[Play event] User action - broadcasting');
  this.state.safeSendMessage({ type: 'PLAY_PAUSE', control: 'play' });
};
```

### Three Message Types

1. **PLAY_PAUSE** - Explicit play/pause commands
   - Always executed immediately
   - Broadcast suppression prevents echoes
   
2. **SEEK** - Explicit seek commands  
   - Always executed immediately
   - Broadcast suppression prevents echoes
   
3. **SYNC_TIME** - Passive drift correction
   - Only corrects drift >10 seconds
   - Stale messages (>5s old) are ignored
   - Much less aggressive than before

## How Each Scenario Works

### Scenario 1: User Hits Pause

**Client A (user action):**
1. User clicks pause
2. Video element fires `pause` event
3. Event handler: `suppressBroadcast = false`, so BROADCAST
4. All peers receive `PLAY_PAUSE: pause`

**Client B (receives command):**
1. Receives `PLAY_PAUSE: pause`
2. Calls `handlePlaybackControl('pause')`
3. Sets `suppressBroadcast = true`
4. Executes `netflix.pause()`
5. Video fires `pause` event
6. Event handler: `suppressBroadcast = true`, so DON'T BROADCAST ✅
7. Sets `suppressBroadcast = false`

**Result:** All clients pause, no feedback loop! ✅

### Scenario 2: User Hits Play

Same logic - broadcast suppression prevents the receiving clients from re-broadcasting.

**Result:** All clients play, no feedback loop! ✅

### Scenario 3: User Seeks

**Client A (user action):**
1. User seeks to 60s
2. Video element fires `seeked` event
3. Event handler: `suppressBroadcast = false`, so BROADCAST `SEEK: 60s`
4. Also broadcasts `SYNC_TIME` every 2s with current position

**Client B (receives command):**
1. Receives `SEEK: 60s`
2. Calls `handleSeek(60)`
3. Sets `suppressBroadcast = true`
4. Executes `netflix.seek(60000)`
5. Video fires `seeked` event
6. Event handler: `suppressBroadcast = true`, so DON'T BROADCAST ✅
7. Sets `suppressBroadcast = false`

**Result:** All clients seek to 60s, no feedback loop! ✅

### Scenario 4: Passive Sync (Drift Correction)

**Only corrects if:**
- Message is recent (<5 seconds old)
- Drift is significant (>10 seconds)

This means normal playback differences (network latency, buffering) won't trigger constant corrections.

## Key Differences from Old Code

| Old Approach | New Approach |
|-------------|--------------|
| Complex timestamp tracking | Simple boolean flag |
| Multiple protection windows (2s, 3s, 6s) | Single suppression flag |
| Record action after execution | Suppress during execution |
| Passive sync threshold: 3-5s | Passive sync threshold: 10s |
| Stale message threshold: 3s | Stale message threshold: 5s |
| Echo detection on every event | Suppression flag blocks broadcast |

## Benefits

✅ **No more feedback loops** - Suppression flag prevents echoes at the source
✅ **Simple logic** - Easy to understand and debug
✅ **Reliable** - No race conditions with timestamps
✅ **Less aggressive** - Passive sync only fixes real problems
✅ **Clean code** - No complex timing calculations

## Testing Checklist

- [ ] Pause on one client → all pause (no feedback)
- [ ] Play on one client → all play (no feedback)
- [ ] Seek on one client → all seek to same position (no bouncing)
- [ ] After seek, video stays at new position (no reset to old position)
- [ ] Passive sync corrects large drift (>10s)
- [ ] Passive sync ignores small differences (<10s)
