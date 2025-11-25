# Testing the Modular Refactoring

## What Changed

✅ **Refactored content-script.js** from 1114 lines to ~650 lines
✅ **Created 6 ES6 modules** with clear separation of concerns:
  - `state-manager.js` - Party state and echo prevention
  - `netflix-controller.js` - Netflix API wrapper
  - `sync-manager.js` - Playback synchronization
  - `webrtc-manager.js` - WebRTC connection management (simplified wrapper)
  - `ui-manager.js` - UI component management (simplified wrapper)
  - `url-sync.js` - URL monitoring and state persistence

## Backup Files

- `content-script.js.backup` - Original 1114-line file (pristine)
- `content-script-old.js` - Also the original (from move operation)

## Next Steps to Test

### 1. Install Node.js (if not already installed)

Choose one method:

**Option A: Official Installer**
- Download from https://nodejs.org/ (LTS version)
- Run installer

**Option B: Chocolatey (Windows Package Manager)**
```bash
choco install nodejs
```

**Option C: Scoop (Windows Package Manager)**
```bash
scoop install nodejs
```

### 2. Install Dependencies

```bash
cd /c/Users/toper/DEV/toperparty
npm install
```

This installs webpack, webpack-cli, and copy-webpack-plugin.

### 3. Build the Extension

**Development build with watch mode** (auto-rebuilds on changes):
```bash
npm run dev
```

**Production build** (one-time):
```bash
npm run build
```

Both commands create a `dist/` directory with the bundled extension.

### 4. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. The extension should now be loaded!

### 5. Test Functionality

Test these key features:

✅ **Basic functionality**
  - Extension loads without errors
  - Popup opens correctly
  - Can start a party

✅ **Video synchronization**
  - Play/pause syncs between users
  - Seeking syncs correctly
  - No unexpected video restarts
  - No blocking of legitimate seeks

✅ **WebRTC**
  - Webcam/microphone access works
  - Video feeds display for all participants
  - Audio works

✅ **URL synchronization**
  - Changing to a new show syncs across users
  - Party state persists after page reload
  - No duplicate URL change broadcasts

## Troubleshooting

### Build Errors

If webpack fails to build:
1. Check console output for specific errors
2. Make sure all module files exist in `chrome-extension/modules/`
3. Verify import paths are correct (relative paths with `.js` extension)

### Extension Errors

If Chrome shows errors:
1. Check browser console (F12) on Netflix page
2. Check extension console (Extensions page → Details → Inspect views)
3. Look for module loading errors or missing imports

### Rollback

If something breaks, you can rollback:

```bash
cd /c/Users/toper/DEV/toperparty/chrome-extension
cp content-script.js.backup content-script.js
```

Then rebuild with webpack.

## Development Workflow

Once testing is successful, the workflow becomes:

1. **Make changes** to any `.js` file in `chrome-extension/`
2. **Webpack auto-rebuilds** (if using `npm run dev`)
3. **Reload extension** in Chrome (click reload button on extension card)
4. **Test** the changes on Netflix

The modular structure makes it much easier to:
- Find specific functionality
- Make targeted changes
- Test individual components
- Avoid merge conflicts
- Understand the codebase

## What's Left (Future Improvements)

- Full WebRTC extraction (currently using simplified wrapper)
- Full UI management extraction (preview/remote video creation)
- Full URL monitoring extraction (currently simplified)
- Add unit tests for individual modules
- Consider TypeScript for better type safety
