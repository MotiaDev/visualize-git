# Deployment Instructions

## Architecture

```
Chrome Extension
       ↓
Vercel Frontend (your-project.vercel.app)
       ↓ (proxied via /api/proxy.ts)
Motia Backend (your-backend.hub.motia.cloud) ← PRIVATE, never exposed
       ↓
GitHub API
```

## Step 1: Deploy Frontend to Vercel

### Option A: Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### Option B: Vercel Dashboard

1. Push code to GitHub
2. Go to https://vercel.com/new
3. Import your GitHub repository
4. Vercel auto-detects Vite ✅

## Step 2: Set Environment Variables
    
    ### In Vercel (Frontend & Proxy)
    Go to Vercel Dashboard → Your Project → Settings → Environment Variables
    
    | Variable | Value | Purpose |
    |----------|-------|---------|
    | `VITE_API_BASE` | `https://your-project.vercel.app` | Frontend knows where to call APIs |
    | `MOTIA_BACKEND_URL` | `https://your-backend.hub.motia.cloud` | Proxy knows where real backend is (PRIVATE) |

    ### In Motia Cloud (Backend)
    Use the CLI to set your GitHub token. This prevents rate limiting for all users.
    
    ```bash
    # Set GitHub Token to prevent rate limits (use your own personal access token)
    motia env set GITHUB_TOKEN=ghp_your_token_here
    
    # Redeploy for changes to take effect
    motia cloud deploy
    ```
    
    **Important:** 
    - `VITE_API_BASE` should be your Vercel URL
    - `MOTIA_BACKEND_URL` is kept private, only used by the serverless proxy
    - `GITHUB_TOKEN` on Motia Cloud ensures the backend doesn't hit rate limits

## Step 3: Update Chrome Extension

After Vercel deployment, update `chrome-extension/config.js`:

```javascript
const API_BASE = 'https://your-actual-project.vercel.app';
```

Then reload the extension in Chrome.

## How It Works

1. **Frontend** makes API calls to `/api/github/repo/owner/repo`
2. **Vercel rewrites** route `/api/*` to `/api/proxy.ts` serverless function
3. **Proxy function** reads `MOTIA_BACKEND_URL` from env and forwards request
4. **Motia backend** processes request and returns response
5. **Proxy** returns response to frontend/extension

The Motia backend URL is **never exposed** to the client!

## Testing

```bash
# After deployment
curl "https://your-project.vercel.app/api/github/repo/facebook/react"

# Test embed SVG
open "https://your-project.vercel.app/api/embed/stars?repos=facebook/react"
```

## Local Development

For local dev, bypass the proxy:

```bash
# .env.local
VITE_API_BASE=http://localhost:3001
```

This directly calls your local Motia backend.

## Troubleshooting

**Proxy returns 500 "Backend URL not configured"**
- Add `MOTIA_BACKEND_URL` to Vercel environment variables
- Redeploy

**API calls fail with CORS**
- The proxy function handles CORS automatically
- Check browser console for actual error

**Extension can't connect**
- Verify `chrome-extension/config.js` points to your Vercel URL
- Test the API directly in browser first

## Security Benefits

✅ Backend URL hidden from public  
✅ Can rotate backend without updating extension  
✅ Vercel handles SSL/HTTPS automatically  
✅ Rate limiting can be added to proxy  
✅ Can add authentication layer to proxy

