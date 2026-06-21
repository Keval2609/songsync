# GitHub Pages Deployment Guide for SyncPlay

This guide explains how to deploy SyncPlay to GitHub Pages with optional backend hosting.

## Table of Contents

1. [Quick Start (Frontend Only)](#quick-start-frontend-only)
2. [Full-Stack Deployment](#full-stack-deployment)
3. [Backend Hosting Options](#backend-hosting-options)
4. [Configuration](#configuration)
5. [Troubleshooting](#troubleshooting)

---

## Quick Start (Frontend Only)

This approach deploys the frontend UI to GitHub Pages. The backend can run locally or on a separate server.

### Prerequisites

- GitHub account with a repository for this project
- Already cloned/forked the SyncPlay repository

### Steps

1. **Ensure `docs/` folder is committed to `main` branch**
   ```bash
   # Copy the latest index.html to docs/ if needed
   cp index.html docs/index.html
   git add docs/
   git commit -m "chore: update docs for deployment"
   git push origin main
   ```

2. **Enable GitHub Pages**
   - Go to your repository Settings
   - Navigate to **Pages** section
   - Select **Deploy from a branch**
   - Choose `main` branch and `/docs` folder
   - Click **Save**

3. **Wait for deployment**
   - GitHub will automatically deploy the `docs/` folder to GitHub Pages
   - Your app will be available at: `https://USERNAME.github.io/songsync`

4. **Run backend locally or on a server** (see [Backend Hosting Options](#backend-hosting-options))
   ```bash
   npm install
   npm start
   # Server runs on http://localhost:3000
   ```

5. **Configure backend URL in the app**
   - Click ⚙️ **Settings** on the landing page
   - Enter your backend server URL (e.g., `http://localhost:3000` or `https://api.example.com`)
   - Click **Save**

### Automatic Deployment with GitHub Actions

The `.github/workflows/deploy.yml` workflow automatically deploys the `docs/` folder to GitHub Pages when you push to `main`.

**To enable:**
1. The workflow is already configured in `.github/workflows/deploy.yml`
2. Ensure your repository has GitHub Pages enabled
3. The workflow will trigger automatically on each push to `main`

**Status:**
- View deployment status in the **Actions** tab of your repository
- Click the workflow run to see details

---

## Full-Stack Deployment

For a complete production setup, deploy both frontend and backend.

### Architecture

```
┌─────────────────────────────────────────┐
│                                         │
│  Browser (GitHub Pages)                │
│  https://username.github.io/songsync   │
│                                         │
└──────────────┬──────────────────────────┘
               │
               │ WebSocket + HTTP
               │
┌──────────────▼──────────────────────────┐
│                                         │
│  Backend Server (Render/Railway/Fly)   │
│  https://api-songsync.onrender.com     │
│                                         │
└─────────────────────────────────────────┘
```

### Setup

#### Phase 1: Frontend (GitHub Pages)
Follow the [Quick Start](#quick-start-frontend-only) section above.

#### Phase 2: Backend (Cloud Hosting)
See [Backend Hosting Options](#backend-hosting-options) below.

---

## Backend Hosting Options

Choose one of these services to host the Node.js backend:

### Option 1: Render (Recommended - Free Plan Available)

**Benefits:**
- Free plan includes 750 hours/month
- Easy deployment from GitHub
- Automatic HTTPS
- Environment variables support

**Steps:**

1. Sign up at [render.com](https://render.com)

2. Connect your GitHub repository
   - Click **New** → **Web Service**
   - Select **Build and deploy from GitHub repository**
   - Authorize GitHub and select `songsync` repository

3. Configure the service:
   - **Name**: `syncsync-backend` (or any name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

4. Set environment variables:
   - Click **Environment** tab
   - Add:
     ```
     PORT=3000
     CORS_ORIGIN=https://username.github.io
     ```
   - Replace `username` with your GitHub username

5. Deploy
   - Click **Create Web Service**
   - Wait for deployment to complete
   - Copy the service URL (e.g., `https://syncsync-backend.onrender.com`)

6. Configure in frontend
   - Go to your deployed app at GitHub Pages
   - Click ⚙️ **Settings**
   - Enter the backend URL: `https://syncsync-backend.onrender.com`
   - Click **Save**

### Option 2: Railway

**Benefits:**
- Free plan includes $5 credit/month
- Simple deployment
- Good documentation

**Steps:**

1. Sign up at [railway.app](https://railway.app)

2. Create a new project
   - Click **New Project** → **Deploy from GitHub repo**
   - Select `songsync` repository

3. Configure:
   - Railway auto-detects Node.js
   - Set environment variables:
     ```
     PORT=3000
     CORS_ORIGIN=https://username.github.io
     ```

4. Get the deployment URL and configure in frontend (same as above)

### Option 3: Fly.io

**Benefits:**
- Free tier with generous limits
- Global deployment
- PostgreSQL support

**Steps:**

1. Sign up at [fly.io](https://fly.io)

2. Install Fly CLI:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

3. Deploy:
   ```bash
   fly launch
   # Answer prompts:
   # - App name: syncsync-backend
   # - Region: choose closest to you
   # - Create database: no
   ```

4. Set environment variables:
   ```bash
   fly secrets set CORS_ORIGIN=https://username.github.io
   ```

5. Get the deployment URL from `fly.io` console and configure in frontend

### Option 4: Heroku

⚠️ **Note**: Heroku discontinued its free tier. Use only if you have a paid plan.

---

## Configuration

### Backend Environment Variables

Create or update `.env` file in the backend directory:

```bash
# Port for the backend server
PORT=3000

# CORS Configuration - set this to your frontend URL
# For GitHub Pages: https://username.github.io
# For local development: leave empty or use http://localhost:8000
CORS_ORIGIN=https://username.github.io

# Optional: Enable debug logging
DEBUG=false
```

### Frontend Settings

The frontend automatically saves backend URL to browser's localStorage:

1. Click ⚙️ **Settings** on the landing page
2. Enter backend URL (e.g., `https://api-syncsync.onrender.com`)
3. Click **Save**

**Note:** Settings are stored per browser/device. Each device must configure the backend URL independently.

### GitHub Pages Configuration

To enable GitHub Pages:

1. Go to **Settings** → **Pages**
2. Select:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/docs`
3. Click **Save**

GitHub will automatically deploy any changes to the `docs/` folder when you push to `main`.

---

## Local Development

### Running Locally

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open browser
# Navigate to http://localhost:3000
```

### Testing Multi-Device Sync

1. Start the backend: `npm start`

2. Get your local IP address:
   ```bash
   # macOS/Linux:
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Windows:
   ipconfig
   ```

3. Open multiple browser windows/tabs:
   ```
   http://YOUR_LOCAL_IP:3000  (as host)
   http://YOUR_LOCAL_IP:3000  (as listener)
   ```

4. Test sync:
   - Create room in first window
   - Join room in other windows
   - Upload audio and play
   - Observe synchronization

### Static Frontend Testing

To test just the frontend (without backend):

```bash
# Start a simple HTTP server in the docs/ folder
cd docs
python3 -m http.server 8000

# Open http://localhost:8000
```

**Note:** Most features won't work without a backend, but UI should display correctly.

---

## Troubleshooting

### "Connection Timeout" Error

**Problem:** Frontend can't connect to backend

**Solutions:**

1. **Check backend is running:**
   ```bash
   curl https://your-backend-url
   ```

2. **Verify CORS_ORIGIN setting:**
   - Backend must have correct `CORS_ORIGIN` environment variable
   - Should match your frontend URL exactly

3. **Check frontend settings:**
   - Click ⚙️ **Settings**
   - Verify backend URL is correct
   - Try clearing browser cache and reloading

### WebSocket Connection Failed

**Problem:** WebSocket connection errors

**Solutions:**

1. **Check protocol:**
   - Frontend should use `wss://` for HTTPS backend
   - Frontend should use `ws://` for HTTP backend

2. **Verify firewall:**
   - Ensure WebSocket port is not blocked
   - Check hosting provider's firewall settings

3. **Check backend logs:**
   ```bash
   # For Render/Railway/Fly.io, view logs in the dashboard
   # For local: check terminal output of `npm start`
   ```

### Files Not Deploying to GitHub Pages

**Problem:** Changes don't appear after push

**Solutions:**

1. **Ensure docs/ folder is committed:**
   ```bash
   git add docs/
   git commit -m "update docs"
   git push origin main
   ```

2. **Check GitHub Pages settings:**
   - Go to Settings → Pages
   - Verify branch is `main` and folder is `/docs`

3. **Wait for deployment:**
   - Check **Actions** tab for workflow status
   - Deployments can take 1-2 minutes

4. **Clear browser cache:**
   - Hard refresh: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)

### Audio Upload Fails

**Problem:** Upload is rejected or times out

**Solutions:**

1. **Check file size:**
   - Maximum file size is 100 MB
   - Compress audio if needed

2. **Check file format:**
   - Supported: MP3, WAV, OGG
   - Convert files if using unsupported format

3. **Check backend logs:**
   - View logs in hosting provider dashboard
   - Look for file size or format errors

### Frontend Settings Not Persisting

**Problem:** Backend URL resets after reload

**Solutions:**

1. **Check browser storage:**
   - Some browsers disable localStorage in private mode
   - Try disabling private mode

2. **Check browser storage limits:**
   - Clear cache and try again
   - Some browsers have storage limits

---

## Advanced Configuration

### Custom Domain

To use a custom domain for your GitHub Pages site:

1. Purchase or use existing domain
2. Go to repository **Settings** → **Pages**
3. Enter custom domain in **Custom domain** field
4. Update `CORS_ORIGIN` in backend to match your custom domain

### CI/CD Pipeline

The `.github/workflows/deploy.yml` workflow:

1. Triggers on push to `main` or on manual dispatch
2. Verifies `docs/index.html` exists
3. Uploads to GitHub Pages
4. Deploys automatically

To manually trigger:
- Go to **Actions** tab
- Select **Deploy to GitHub Pages** workflow
- Click **Run workflow**

### Backend Scaling

For production with many concurrent users:

1. **Render**: Upgrade to paid plan for better resources
2. **Railway**: Monitor usage and upgrade as needed
3. **Fly.io**: Scale app instances as needed

---

## Support

For issues or questions:

1. Check **Troubleshooting** section above
2. Review backend logs in hosting provider dashboard
3. Check browser console for frontend errors (F12)
4. Open an issue on GitHub repository

---

## Next Steps

- ✅ Deploy frontend to GitHub Pages
- ✅ Deploy backend to cloud service
- ✅ Configure CORS and environment variables
- ✅ Test sync across devices
- 📊 Monitor performance and usage
- 📈 Scale as needed

Enjoy synchronized audio playback! 🎵
