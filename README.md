# Git History ✦

> Visualize any GitHub repository with beautiful interactive graphs and star history charts at **[git-history.com](https://git-history.com)**

![Git History - Repository Visualization](./public/galaxy.png)

## ✨ Features

- 🌌 **Interactive Force Graph** - Explore repository structure with draggable, zoomable nodes
- 📦 **Pack View** - Circle-packing visualization showing files nested inside folders
- ⭐ **Star History** - Beautiful charts showing repository growth over time
- 📊 **Embeddable Charts** - Add live star history SVG to your README (dark & light themes)
- 🎬 **Commit Timeline** - Watch commits animate through the codebase
- 🔄 **Multi-Repo Comparison** - Compare star histories of multiple repositories
- 🔌 **Chrome Extension** - View star history directly on GitHub pages

![Star History Chart](./public/git-star-history.png)

## 🗺️ Roadmap

### Visualization

| Feature | Status | Description |
|---------|--------|-------------|
| Force Graph Layout | ✅ Done | Interactive force-directed graph with D3.js |
| Circle Packing (Pack View) | ✅ Done | Files nested inside folder circles |
| File Type Coloring | ✅ Done | Color nodes by extension (.ts, .js, .css, etc.) |
| File Size Scaling | ✅ Done | Node size represents file size |
| Layout Toggle | ✅ Done | Switch between Force and Pack views |
| Zoom to Folder | 🔜 Planned | Double-click folder to zoom into contents |

### Git History

| Feature | Status | Description |
|---------|--------|-------------|
| Commit Timeline | ✅ Done | Animated playback through commit history |
| Contributor Avatars | ✅ Done | Show developer avatars during playback |
| File Change Animation | ✅ Done | Projectiles animate from author to changed files |
| Branch Visualization | 🔜 Planned | Show different branches as separate trees |
| Time-lapse Mode | 🔜 Planned | Watch codebase evolution from first commit |

### Star History

| Feature | Status | Description |
|---------|--------|-------------|
| Star History Chart | ✅ Done | Beautiful growth charts with real data |
| Multi-Repo Comparison | ✅ Done | Compare multiple repos on one chart |
| Embeddable SVG | ✅ Done | Add charts to any README |
| Dark & Light Themes | ✅ Done | Theme support for embeds |
| Export as Image/CSV | 🔜 Planned | Download chart data |

### Chrome Extension

| Feature | Status | Description |
|---------|--------|-------------|
| GitHub Page Injection | ✅ Done | Star history on repo pages |
| Popup UI | ✅ Done | Quick access to any repo |

**Want to contribute?** PRs welcome!

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- GitHub Personal Access Token (optional but recommended)

### Installation

```bash
git clone https://github.com/MotiaDev/visualize-git.git
cd visualize-git
npm install
```

### Configure GitHub Token (Recommended)

To avoid rate limits, create a [Personal Access Token](https://github.com/settings/tokens) with `public_repo` scope:

```bash
# Create .env file
echo "GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx" > .env
```

**Rate Limits:**
- Without token: 60 requests/hour ⚠️
- With token: 5,000 requests/hour ✅

### Start Development

```bash
# Terminal 1: Start Motia backend
npm run dev

# Terminal 2: Start Vite frontend
npm run olddev
```

Open [http://localhost:3000](http://localhost:3000) and enter any repo like `facebook/react`!

## 📊 Embeddable Charts

Add live star history to any README:

```markdown
[![Star History](https://git-history.com/api/embed/stars?repos=motiadev/motia)](https://github.com/motiadev/motia)
```

### Options

| Parameter | Description | Example |
|-----------|-------------|---------|
| `repos` | Comma-separated repos (required) | `motiadev/motia,vercel/next.js` |
| `theme` | `dark` or `light` (default: dark) | `theme=light` |

### Examples

```markdown
<!-- Single repo -->
[![Star History](https://git-history.com/api/embed/stars?repos=motiadev/motia)](https://github.com/motiadev/motia)

<!-- Multi-repo comparison -->
[![Star History](https://git-history.com/api/embed/stars?repos=facebook/react,vuejs/vue&theme=dark)](https://github.com)

<!-- Light theme -->
[![Star History](https://git-history.com/api/embed/stars?repos=motiadev/motia&theme=light)](https://github.com/motiadev/motia)
```

### Motia Workbench

Visualize and test your API flows in the Motia Workbench:

![Motia Workbench](./public/workbench.png)

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/github/repo/:owner/:repo` | Fetch repository details |
| `GET /api/github/tree/:owner/:repo` | Fetch file tree for visualization |
| `GET /api/github/stars/:owner/:repo` | Fetch star history data |
| `GET /api/github/commits/:owner/:repo` | Fetch commit history |
| `GET /api/embed/stars?repos=...` | Embeddable SVG star chart |
| `GET /api/embed/badge/:owner/:repo` | Star count badge |

All endpoints support optional `?token=ghp_xxx` for higher rate limits.

## 🚢 Deployment

### Backend → Motia Cloud

```bash
npx motia cloud deploy \
  --api-key <your-api-key> \
  --version-name v1.0.0 \
  --env-file .env.production
```

![Deploy to Motia Cloud](./public/deploy-workbench.png)

> 📖 [Motia Cloud Deployment Guide](https://www.motia.dev/docs/deployment-guide/motia-cloud/deployment)

### Frontend → Vercel

```bash
vercel --prod
```

Set these environment variables in Vercel:
- `VITE_API_BASE` - Your Vercel URL (e.g., `https://git-history.com`)
- `MOTIA_BACKEND_URL` - Your Motia Cloud URL (private)

## 🔌 Chrome Extension

The `chrome-extension/` folder adds star history directly to GitHub repository pages.

### Installation

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `chrome-extension/` folder

### Publishing

1. Update `API_BASE` in `popup.js` and `content.js` to your production URL
2. Zip the `chrome-extension` folder
3. Upload to [Chrome Web Store](https://chrome.google.com/webstore/devconsole)

## 📁 Project Structure

```
git-history/
├── src/github/              # Motia Backend Steps
│   ├── get-repo-details.step.ts
│   ├── get-repo-tree.step.ts
│   ├── get-star-history.step.ts
│   ├── get-commits.step.ts
│   ├── embed-stars.step.ts
│   └── embed-badge.step.ts
├── components/              # React Frontend
│   ├── Visualizer.tsx       # D3.js force graph
│   ├── StarHistory.tsx      # Star history chart
│   ├── TimelinePlayer.tsx   # Commit timeline
│   └── ...
├── services/
│   └── githubService.ts     # API client
├── chrome-extension/        # Chrome Extension
└── motia.config.ts          # Motia configuration
```

## 🛠️ Tech Stack

- **Backend**: [Motia](https://motia.dev) - Event-driven API framework
- **Frontend**: React 18 + Vite + TypeScript
- **Visualization**: D3.js v7 (force graphs, circle packing)
- **Styling**: Tailwind CSS
- **Validation**: Zod schemas

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| `Property 'X' does not exist on type 'Handlers'` | Run `npx motia generate-types` |
| GitHub API rate limit (403) | Add `GITHUB_TOKEN` to `.env` |
| CORS errors | Ensure `API_BASE` is correct in `githubService.ts` |

## 📚 Learn More

- [Motia Documentation](https://www.motia.dev/docs)
- [Motia GitHub](https://github.com/MotiaDev/motia)
- [Discord Community](https://discord.gg/motia)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

MIT

---

<div align="center">

Built with ⚡ [Motia](https://motia.dev)

**If you find this useful, please ⭐ star the repo!**

</div>
