# Webpack Setup Instructions

## Prerequisites

You need Node.js and npm installed. 

### Install Node.js (if not already installed):

**Option 1: Official installer**
- Download from: https://nodejs.org/
- Install the LTS version

**Option 2: Using Chocolatey (Windows)**
```bash
choco install nodejs
```

**Option 3: Using Scoop (Windows)**
```bash
scoop install nodejs
```

## Installation Steps

Once Node.js/npm is installed:

```bash
cd /c/Users/toper/DEV/toperparty
npm install
```

This will install:
- webpack (bundler)
- webpack-cli (command line interface)
- copy-webpack-plugin (copies static files)

## Build Commands

**Development build with watch mode:**
```bash
npm run dev
```
This watches for file changes and automatically rebuilds.

**Production build:**
```bash
npm run build
```
This creates optimized production bundle.

**Clean build directory:**
```bash
npm run clean
```

## Loading the Extension

1. Build the extension: `npm run build` or `npm run dev`
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist/` directory

## Development Workflow

1. Run `npm run dev` to start watch mode
2. Make changes to files in `chrome-extension/`
3. Webpack automatically rebuilds to `dist/`
4. Reload extension in Chrome (click reload button on extension card)

## What Webpack Does

- Bundles `content-script.js` and all module imports into single file
- Bundles `background.js` and `popup.js`
- Copies static files (manifest, HTML, CSS, images) to `dist/`
- Creates source maps for debugging
- Outputs everything to `dist/` directory
