# SyncPlay - Ultra-Tight Synchronized Audio Playback

A production-quality browser-based system for synchronized audio playback across multiple devices. Features <40ms sync accuracy under good network conditions, late joiner auto-sync, and automatic drift correction.

## 🚀 Quick Links

- 📖 **[Deployment Guide](DEPLOYMENT.md)** - Deploy to GitHub Pages and cloud backends
- 🌐 **Live Demo** - Coming soon (deploy your own instance)
- 📱 **[Local Development](#-run-instructions)** - Run locally for testing

## 📁 Folder Structure

```
sync-audio-player/
├── package.json             # Node.js dependencies
├── server.js                # Backend server (Express + WebSocket)
├── index.html               # Frontend client (HTML + CSS + JS)
├── docs/                    # Frontend for GitHub Pages deployment
│   └── index.html           # Deployed frontend
├── .env.example             # Environment configuration template
├── .github/workflows/       # GitHub Actions CI/CD
│   └── deploy.yml           # Automatic GitHub Pages deployment
├── DEPLOYMENT.md            # Complete deployment guide
├── README.md                # This file
└── temp/                    # Auto-created for temporary audio storage
    └── [roomCode]/          # Room-specific directories
        └── audio-*.mp3      # Uploaded audio files (auto-deleted)
```

## 🚀 Run Instructions

### Prerequisites
- Node.js 16+ installed
- npm (comes with Node.js)

### Installation & Running

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
# Navigate to http://localhost:3000
```

### For Local Network Testing (Multiple Devices)

```bash
# Find your local IP address
# Windows: ipconfig
# Mac/Linux: ifconfig or ip addr

# Start server and access via:
# http://YOUR_LOCAL_IP:3000
```

## 🎯 How to Use

### As Host
1. Click "Create Room" 
2. Share the 6-digit room code with others
3. Upload an audio file (MP3, WAV, or OGG, max 100MB)
4. Use play/pause controls - all connected devices will sync

### As Listener
1. Enter the 6-digit room code
2. Click "Join"
3. Wait for audio to load and sync
4. On mobile: tap "Enable Audio" when prompted

## 🌐 Deployment

SyncPlay can be deployed in multiple ways:

### Quick Start: GitHub Pages + Cloud Backend

1. **Frontend** (GitHub Pages):
   - Automatically deployed from `docs/` folder via GitHub Actions
   - No additional setup needed - just push to `main`
   - Visit: `https://your-username.github.io/songsync`

2. **Backend** (Choose one):
   - [Render](https://render.com) (Recommended - Free tier available)
   - [Railway](https://railway.app)
   - [Fly.io](https://fly.io)
   - Your own server

3. **Configuration:**
   - Click ⚙️ **Settings** in the app
   - Enter your backend server URL
   - Click **Save**

👉 **[See Full Deployment Guide →](DEPLOYMENT.md)**

### Local Development

```bash
npm install
npm start
# Opens http://localhost:3000
```

## 🔧 Technical Architecture

### Backend (server.js)
- **Express**: HTTP server for static files and audio streaming
- **WebSocket (ws)**: Real-time bidirectional communication
- **Multer**: File upload handling with 100MB limit
- **In-memory storage**: Room state and connections
- **High-resolution timing**: `process.hrtime()` for sub-millisecond accuracy

### Frontend (index.html)
- **Vanilla JavaScript**: No frameworks, minimal dependencies
- **Web Audio API**: Sample-accurate audio scheduling
- **WebSocket**: Real-time sync messages
- **Tailwind CSS**: Styling via CDN

## ⏱️ Synchronization Strategy

### 1. Clock Synchronization (NTP-Style)

```
Client                    Server
   |                         |
   |------- PING (t0) ------>|
   |                         | (t1)
   |<------ PONG (t1) -------|
   |                         |
 (t2)

RTT = t2 - t0
Offset = t1 - (t0 + RTT/2)
       = t1 - (t0 + t2) / 2
```

- Continuous sync every 2 seconds
- Median of 5 samples for jitter resistance
- Offset tells us server time relative to local clock

### 2. Playback Scheduling

The server maintains authoritative state:
```javascript
{
  isPlaying: boolean,
  playbackStartTime: number,  // Server timestamp when position was 0
  pausedAt: number,           // Position in seconds when paused
  duration: number
}
```

Client calculates current position:
```javascript
currentPosition = (estimatedServerTime - playbackStartTime) / 1000
```

Uses `AudioContext.currentTime` for sample-accurate scheduling.

### 3. Late Joiner Sync

When a client joins mid-playback:
1. Server calculates current position from `playbackStartTime`
2. Sends complete state including position
3. Client loads audio, seeks to position, starts playback
4. Drift correction kicks in immediately

### 4. Drift Correction

Measured every 1 second during playback:

| Drift | Action |
|-------|--------|
| <10ms | No correction needed |
| 10-40ms | Micro playback rate adjustment (0.995-1.005) |
| 40-100ms | Aggressive rate adjustment (0.98-1.02) |
| >100ms | Hard realignment (stop and restart at correct position) |

```javascript
// Rate adjustment formula
rateAdjustment = -driftMs * 0.002;
newRate = clamp(1.0 + rateAdjustment, 0.98, 1.02);
```

This creates smooth corrections without audible glitches.

## 🔒 Security & Cleanup

### Room Lifecycle
1. **Creation**: 6-digit random code generated
2. **Audio Upload**: Stored in room-scoped temp directory
3. **Playback**: Audio served to authenticated room members
4. **Destruction**: When host disconnects:
   - All client connections closed
   - Audio file deleted permanently
   - Room state removed from memory
   - Temp directory cleaned

### File Handling
- 100MB server-enforced upload limit
- Only audio MIME types accepted
- Files never persist between rooms
- No caching or reuse

## 📱 Mobile Support

- Handles iOS/Android autoplay restrictions
- "Enable Audio" button for user interaction requirement
- Visibility change detection for tab switching
- Re-sync on page becoming visible

## 🎚️ Performance Considerations

### Network
- WebSocket for low-latency messaging
- HTTP range requests for audio seeking
- Chunked audio streaming

### Audio
- Web Audio API for precise timing
- BufferSource for sample-accurate playback
- Decoded audio cached in memory

### Throttling Protection
- Uses `performance.now()` for timing (not affected by throttling)
- `AudioContext.currentTime` continues in background
- Visibility change triggers resync

## 🐛 Error Handling

| Scenario | Handling |
|----------|----------|
| Upload too large | HTTP 413 with clear message |
| Invalid file type | Rejected with error |
| Network disconnect | Auto-reconnect attempt, room destruction message |
| Late join mid-play | Auto-sync to current position |
| Audio decode failure | Error displayed, graceful degradation |
| Host leaves | All clients notified, room destroyed |

## 🔢 Constants

```javascript
CLOCK_SYNC_INTERVAL = 2000     // Re-sync clock every 2 seconds
CLOCK_SAMPLE_COUNT = 5         // Number of samples to average
DRIFT_CHECK_INTERVAL = 1000    // Check drift every 1 second
DRIFT_THRESHOLD_IGNORE = 10    // <10ms: no correction
DRIFT_THRESHOLD_SOFT = 40      // 10-40ms: rate adjustment
DRIFT_THRESHOLD_HARD = 100     // >100ms: hard realignment
MAX_FILE_SIZE = 100 * 1024 * 1024  // 100 MB
```

## 📊 Sync Accuracy

Under optimal conditions (low latency, stable connection):
- **Target**: <20-40ms sync accuracy
- **Typical**: 5-20ms drift during playback
- **Correction**: Continuous micro-adjustments maintain sync

Factors affecting sync:
- Network latency and jitter
- Device performance
- Browser audio pipeline
- Background tab throttling

## 🧪 Testing

1. Open multiple browser tabs/windows
2. Create room in one tab (host)
3. Join from other tabs with room code
4. Upload audio and play
5. Observe sync indicators (green = synced)
6. Test late joining by opening new tab mid-playback
7. Test cleanup by closing host tab

## 📝 License

MIT License - Use freely for any purpose.
