/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SYNCHRONIZED AUDIO PLAYBACK SERVER
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This server handles:
 * 1. Room creation/management with 6-digit codes
 * 2. Audio file upload with 100MB limit
 * 3. WebSocket-based real-time synchronization
 * 4. NTP-style clock synchronization
 * 5. Authoritative playback state management
 * 6. Automatic cleanup on host disconnect
 * 
 * Sync Strategy:
 * - Server maintains absolute playback state with high-resolution timestamps
 * - Clients sync their clocks to server time using NTP-style ping/pong
 * - Playback commands include server timestamps for precise scheduling
 * - Late joiners receive current position and sync immediately
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB in bytes
const TEMP_DIR = path.join(__dirname, 'temp');
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/wave'];

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY ROOM STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Room State Structure:
 * {
 *   roomCode: string,           // 6-digit room code
 *   hostId: string,             // Unique host identifier
 *   hostSocket: WebSocket,      // Host's WebSocket connection
 *   clients: Map<string, WebSocket>, // Connected clients
 *   audioFile: {                // Uploaded audio info
 *     path: string,
 *     originalName: string,
 *     mimeType: string,
 *     size: number
 *   },
 *   playbackState: {
 *     isPlaying: boolean,
 *     playbackStartTime: number,  // Server timestamp when playback started
 *     pausedAt: number,           // Position in seconds when paused
 *     duration: number            // Total audio duration
 *   },
 *   createdAt: number
 * }
 */
const rooms = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// HIGH-RESOLUTION SERVER TIME
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get current server time in milliseconds with high precision
 * Uses process.hrtime() for sub-millisecond accuracy
 */
const serverStartTime = Date.now();
const serverStartHrTime = process.hrtime();

function getServerTime() {
    const diff = process.hrtime(serverStartHrTime);
    // Convert hrtime to milliseconds: seconds * 1000 + nanoseconds / 1000000
    return serverStartTime + diff[0] * 1000 + diff[1] / 1000000;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP SETUP
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(__dirname));

// ═══════════════════════════════════════════════════════════════════════════════
// MULTER CONFIGURATION FOR FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const roomCode = req.params.roomCode;
        const roomDir = path.join(TEMP_DIR, roomCode);
        
        // Create room-specific directory
        if (!fs.existsSync(roomDir)) {
            fs.mkdirSync(roomDir, { recursive: true });
        }
        cb(null, roomDir);
    },
    filename: (req, file, cb) => {
        // Use UUID to prevent filename collisions
        const ext = path.extname(file.originalname);
        cb(null, `audio-${uuidv4()}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    // Check if file is an audio type
    if (ALLOWED_AUDIO_TYPES.includes(file.mimetype) || 
        file.originalname.match(/\.(mp3|wav|ogg)$/i)) {
        cb(null, true);
    } else {
        cb(new Error('Only audio files (MP3, WAV, OGG) are allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: MAX_FILE_SIZE // 100 MB limit
    },
    fileFilter: fileFilter
});

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Upload audio file for a room
app.post('/upload/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    
    // Use multer with error handling
    upload.single('audio')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ 
                    error: 'File too large. Maximum size is 100 MB.' 
                });
            }
            return res.status(400).json({ error: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Delete previous audio file if exists
        if (room.audioFile && room.audioFile.path) {
            try {
                fs.unlinkSync(room.audioFile.path);
            } catch (e) {
                console.log('Could not delete previous audio file:', e.message);
            }
        }
        
        // Store audio file info in room
        room.audioFile = {
            path: req.file.path,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size
        };
        
        // Reset playback state
        room.playbackState = {
            isPlaying: false,
            playbackStartTime: 0,
            pausedAt: 0,
            duration: 0
        };
        
        console.log(`[Room ${roomCode}] Audio uploaded: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
        
        // Notify all clients about new audio
        broadcastToRoom(roomCode, {
            type: 'audioUploaded',
            fileName: req.file.originalname,
            fileSize: req.file.size,
            serverTime: getServerTime()
        });
        
        res.json({ 
            success: true, 
            fileName: req.file.originalname,
            fileSize: req.file.size
        });
    });
});

// Stream audio file to clients
app.get('/audio/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room || !room.audioFile) {
        return res.status(404).json({ error: 'Audio not found' });
    }
    
    const audioPath = room.audioFile.path;
    const stat = fs.statSync(audioPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    // Support range requests for seeking
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        
        const file = fs.createReadStream(audioPath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': room.audioFile.mimeType
        };
        
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': room.audioFile.mimeType
        };
        res.writeHead(200, head);
        fs.createReadStream(audioPath).pipe(res);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    // Assign unique ID to this connection
    ws.id = uuidv4();
    ws.isAlive = true;
    ws.roomCode = null;
    ws.isHost = false;
    
    console.log(`[WS] New connection: ${ws.id}`);
    
    // Handle pong for connection keep-alive
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleWebSocketMessage(ws, message);
        } catch (err) {
            console.error('[WS] Invalid message:', err);
            sendToSocket(ws, { type: 'error', message: 'Invalid message format' });
        }
    });
    
    ws.on('close', () => {
        handleDisconnect(ws);
    });
    
    ws.on('error', (err) => {
        console.error(`[WS] Error for ${ws.id}:`, err);
        handleDisconnect(ws);
    });
});

// Keep-alive ping interval
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            console.log(`[WS] Terminating inactive connection: ${ws.id}`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

function handleWebSocketMessage(ws, message) {
    const { type } = message;
    
    switch (type) {
        case 'createRoom':
            handleCreateRoom(ws);
            break;
            
        case 'joinRoom':
            handleJoinRoom(ws, message.roomCode);
            break;
            
        case 'ping':
            // NTP-style ping/pong for clock synchronization
            handleClockSync(ws, message);
            break;
            
        case 'play':
            handlePlay(ws, message);
            break;
            
        case 'pause':
            handlePause(ws);
            break;
            
        case 'seek':
            handleSeek(ws, message);
            break;
            
        case 'setDuration':
            handleSetDuration(ws, message);
            break;
            
        case 'requestState':
            handleRequestState(ws);
            break;
            
        default:
            console.log(`[WS] Unknown message type: ${type}`);
    }
}

/**
 * Generate a random 6-digit room code
 */
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms.has(code));
    return code;
}

/**
 * Handle room creation by host
 */
function handleCreateRoom(ws) {
    const roomCode = generateRoomCode();
    
    const room = {
        roomCode: roomCode,
        hostId: ws.id,
        hostSocket: ws,
        clients: new Map(),
        audioFile: null,
        playbackState: {
            isPlaying: false,
            playbackStartTime: 0,
            pausedAt: 0,
            duration: 0
        },
        createdAt: Date.now()
    };
    
    rooms.set(roomCode, room);
    
    ws.roomCode = roomCode;
    ws.isHost = true;
    
    console.log(`[Room ${roomCode}] Created by host ${ws.id}`);
    
    sendToSocket(ws, {
        type: 'roomCreated',
        roomCode: roomCode,
        serverTime: getServerTime()
    });
}

/**
 * Handle client joining a room
 */
function handleJoinRoom(ws, roomCode) {
    const room = rooms.get(roomCode);
    
    if (!room) {
        sendToSocket(ws, {
            type: 'error',
            message: 'Room not found. Please check the room code.'
        });
        return;
    }
    
    // Add client to room
    room.clients.set(ws.id, ws);
    ws.roomCode = roomCode;
    ws.isHost = false;
    
    console.log(`[Room ${roomCode}] Client ${ws.id} joined. Total clients: ${room.clients.size}`);
    
    // Send room state to new client
    const response = {
        type: 'roomJoined',
        roomCode: roomCode,
        serverTime: getServerTime(),
        hasAudio: !!room.audioFile,
        audioFileName: room.audioFile?.originalName || null,
        playbackState: { ...room.playbackState }
    };
    
    // Calculate current playback position for late joiners
    if (room.playbackState.isPlaying) {
        const elapsed = (getServerTime() - room.playbackState.playbackStartTime) / 1000;
        response.currentPosition = elapsed;
    } else {
        response.currentPosition = room.playbackState.pausedAt;
    }
    
    sendToSocket(ws, response);
    
    // Notify host about new client
    if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
        sendToSocket(room.hostSocket, {
            type: 'clientJoined',
            clientCount: room.clients.size
        });
    }
}

/**
 * NTP-style clock synchronization
 * Client sends ping with t0, server responds with t1 (server receive time)
 * Client calculates: offset = t1 - (t0 + RTT/2)
 */
function handleClockSync(ws, message) {
    const serverTime = getServerTime();
    
    sendToSocket(ws, {
        type: 'pong',
        clientTime: message.clientTime,  // Echo back client's timestamp
        serverTime: serverTime            // Server's current time
    });
}

/**
 * Handle play command from host
 */
function handlePlay(ws, message) {
    if (!ws.isHost) {
        sendToSocket(ws, { type: 'error', message: 'Only host can control playback' });
        return;
    }
    
    const room = rooms.get(ws.roomCode);
    if (!room || !room.audioFile) {
        sendToSocket(ws, { type: 'error', message: 'No audio file uploaded' });
        return;
    }
    
    const serverTime = getServerTime();
    const startPosition = message.position || room.playbackState.pausedAt || 0;
    
    // Calculate the server timestamp when playback "started" at position 0
    // This allows us to calculate current position at any time
    // playbackStartTime = now - (startPosition * 1000)
    room.playbackState.isPlaying = true;
    room.playbackState.playbackStartTime = serverTime - (startPosition * 1000);
    room.playbackState.pausedAt = 0;
    
    console.log(`[Room ${ws.roomCode}] Play at position ${startPosition.toFixed(2)}s`);
    
    // Broadcast to all clients including host
    broadcastToRoom(ws.roomCode, {
        type: 'play',
        serverTime: serverTime,
        playbackStartTime: room.playbackState.playbackStartTime,
        startPosition: startPosition
    }, true);
}

/**
 * Handle pause command from host
 */
function handlePause(ws) {
    if (!ws.isHost) {
        sendToSocket(ws, { type: 'error', message: 'Only host can control playback' });
        return;
    }
    
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    const serverTime = getServerTime();
    
    // Calculate current position
    let pausePosition = 0;
    if (room.playbackState.isPlaying) {
        pausePosition = (serverTime - room.playbackState.playbackStartTime) / 1000;
    } else {
        pausePosition = room.playbackState.pausedAt;
    }
    
    room.playbackState.isPlaying = false;
    room.playbackState.pausedAt = pausePosition;
    
    console.log(`[Room ${ws.roomCode}] Pause at position ${pausePosition.toFixed(2)}s`);
    
    broadcastToRoom(ws.roomCode, {
        type: 'pause',
        serverTime: serverTime,
        pausePosition: pausePosition
    }, true);
}

/**
 * Handle seek command from host
 */
function handleSeek(ws, message) {
    if (!ws.isHost) {
        sendToSocket(ws, { type: 'error', message: 'Only host can control playback' });
        return;
    }
    
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    const serverTime = getServerTime();
    const seekPosition = message.position;
    
    if (room.playbackState.isPlaying) {
        // Update playbackStartTime to reflect new position
        room.playbackState.playbackStartTime = serverTime - (seekPosition * 1000);
    } else {
        room.playbackState.pausedAt = seekPosition;
    }
    
    console.log(`[Room ${ws.roomCode}] Seek to ${seekPosition.toFixed(2)}s`);
    
    broadcastToRoom(ws.roomCode, {
        type: 'seek',
        serverTime: serverTime,
        seekPosition: seekPosition,
        isPlaying: room.playbackState.isPlaying,
        playbackStartTime: room.playbackState.playbackStartTime
    }, true);
}

/**
 * Handle duration update from host after audio decode
 */
function handleSetDuration(ws, message) {
    if (!ws.isHost) return;
    
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    room.playbackState.duration = message.duration;
    console.log(`[Room ${ws.roomCode}] Duration set: ${message.duration.toFixed(2)}s`);
}

/**
 * Handle state request from client (for re-sync)
 */
function handleRequestState(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    const serverTime = getServerTime();
    let currentPosition = 0;
    
    if (room.playbackState.isPlaying) {
        currentPosition = (serverTime - room.playbackState.playbackStartTime) / 1000;
    } else {
        currentPosition = room.playbackState.pausedAt;
    }
    
    sendToSocket(ws, {
        type: 'stateUpdate',
        serverTime: serverTime,
        playbackState: { ...room.playbackState },
        currentPosition: currentPosition,
        hasAudio: !!room.audioFile
    });
}

/**
 * Handle client/host disconnect
 */
function handleDisconnect(ws) {
    const roomCode = ws.roomCode;
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) return;
    
    if (ws.isHost) {
        // Host disconnected - destroy the entire room
        console.log(`[Room ${roomCode}] Host disconnected. Destroying room.`);
        destroyRoom(roomCode);
    } else {
        // Client disconnected - just remove from room
        room.clients.delete(ws.id);
        console.log(`[Room ${roomCode}] Client ${ws.id} disconnected. Remaining clients: ${room.clients.size}`);
        
        // Notify host
        if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
            sendToSocket(room.hostSocket, {
                type: 'clientLeft',
                clientCount: room.clients.size
            });
        }
    }
}

/**
 * Destroy a room completely
 * - Close all client connections
 * - Delete uploaded audio file
 * - Remove room from memory
 */
function destroyRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Notify all clients that room is destroyed
    room.clients.forEach((clientWs) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            sendToSocket(clientWs, {
                type: 'roomDestroyed',
                message: 'The host has left. Room has been closed.'
            });
            clientWs.close();
        }
    });
    
    // Delete audio file if exists
    if (room.audioFile && room.audioFile.path) {
        try {
            fs.unlinkSync(room.audioFile.path);
            console.log(`[Room ${roomCode}] Audio file deleted: ${room.audioFile.path}`);
        } catch (e) {
            console.error(`[Room ${roomCode}] Error deleting audio file:`, e.message);
        }
    }
    
    // Delete room directory
    const roomDir = path.join(TEMP_DIR, roomCode);
    try {
        if (fs.existsSync(roomDir)) {
            fs.rmdirSync(roomDir, { recursive: true });
            console.log(`[Room ${roomCode}] Room directory deleted`);
        }
    } catch (e) {
        console.error(`[Room ${roomCode}] Error deleting room directory:`, e.message);
    }
    
    // Remove room from memory
    rooms.delete(roomCode);
    console.log(`[Room ${roomCode}] Room destroyed completely`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send message to a specific WebSocket
 */
function sendToSocket(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

/**
 * Broadcast message to all clients in a room
 * @param includeHost - Whether to also send to host
 */
function broadcastToRoom(roomCode, data, includeHost = false) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Send to all clients
    room.clients.forEach((clientWs) => {
        sendToSocket(clientWs, data);
    });
    
    // Optionally send to host
    if (includeHost && room.hostSocket) {
        sendToSocket(room.hostSocket, data);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP ON SERVER SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════════

function cleanup() {
    console.log('\n[Server] Shutting down...');
    
    // Destroy all rooms
    rooms.forEach((room, roomCode) => {
        destroyRoom(roomCode);
    });
    
    // Delete entire temp directory
    try {
        if (fs.existsSync(TEMP_DIR)) {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
            console.log('[Server] Temp directory cleaned');
        }
    } catch (e) {
        console.error('[Server] Error cleaning temp directory:', e.message);
    }
    
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

server.listen(PORT, () => {
    console.log(`
═══════════════════════════════════════════════════════════════════════════════
  SYNCHRONIZED AUDIO PLAYBACK SERVER
═══════════════════════════════════════════════════════════════════════════════
  
  Server running at: http://localhost:${PORT}
  
  Features:
  • 6-digit room codes for easy sharing
  • 100 MB max upload size
  • NTP-style clock synchronization
  • Web Audio API playback
  • Late joiner auto-sync
  • Drift correction
  • Automatic cleanup on host disconnect
  
═══════════════════════════════════════════════════════════════════════════════
`);
});
