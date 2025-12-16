# GitGalaxy Chrome Extension

View GitHub star history for any repository, right from GitHub.

## Features

- 🌟 **Star History Chart** - See how a repo grew over time
- ⚡ **One-click Access** - Button injected on every GitHub repo page
- 🔐 **Token Support** - Add your GitHub token for higher rate limits
- 🎨 **Beautiful UI** - Dark theme matching GitHub's design

## Installation

### Development Mode

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder

### Production (from Chrome Web Store)

Coming soon!

## Setup

### 1. Backend API

The extension needs the GitGalaxy Motia backend running:

```bash
# Local development
cd /path/to/gitgalaxy
npm run dev
```

For production, deploy to Motia Cloud:

```bash
# Deploy to Motia Cloud
npx motia deploy
```

The extension is pre-configured to use `https://git-history.com`.

For self-hosted deployments, update `API_BASE` in `config.js`:

```javascript
const API_BASE = 'https://your-domain.com';
```

### 2. GitHub Token (Optional)

For higher API rate limits:

1. Click the extension icon
2. Click "⚙️ Settings"
3. Add your [GitHub personal access token](https://github.com/settings/tokens)
4. Click "Save Token"

## Files

```
chrome-extension/
├── manifest.json     # Extension config
├── popup.html        # Popup UI
├── popup.js          # Popup logic
├── content.js        # Injected on GitHub pages
├── content.css       # Modal styles
└── icons/            # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Icons

You need to create icon images:

- `icons/icon16.png` - 16x16 pixels
- `icons/icon48.png` - 48x48 pixels  
- `icons/icon128.png` - 128x128 pixels

You can use any image editor or generate from an SVG.

## Development

### Testing Changes

1. Make changes to the code
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload the GitHub page

### Debugging

- Popup: Right-click extension icon → "Inspect popup"
- Content script: Open DevTools on any GitHub page → Console

## Deploying to Motia Cloud

```bash
# From the gitgalaxy directory
npx motia login
npx motia deploy

# Update API_BASE in popup.js and content.js with your deployed URL
```

## License

MIT

