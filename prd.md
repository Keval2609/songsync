# Product Requirements Document (PRD)
## Project: Re-create SyncPlay using Java Spring Boot

## 1. Document Control
- **Version:** 1.0
- **Status:** Draft for implementation
- **Author:** Engineering
- **Date:** 2026-09-03
- **Reference Source Project:** Node.js + WebSocket + vanilla frontend implementation in this repository

---

## 2. Executive Summary
This PRD defines requirements to re-create the existing SyncPlay system with a Java Spring Boot backend while preserving current product behavior, UX, synchronization quality, and deployment flexibility.

The rebuilt system must support:
- Multi-device synchronized audio playback in shared rooms
- Host-controlled transport (play/pause/seek)
- Late joiner state recovery
- Drift monitoring and correction support for clients
- Temporary per-room audio storage and cleanup
- Frontend compatibility with existing browser client behavior

The target outcome is functional parity with the current Node.js backend, with production-ready backend structure in Spring Boot.

---

## 3. Product Goals
1. **Behavioral Parity:** Match current end-user behavior and room workflows.
2. **Sync Accuracy:** Preserve practical sync quality target of sub-40ms under good network conditions.
3. **Reliability:** Handle reconnects, room lifecycle transitions, and host disconnect cleanup safely.
4. **Maintainability:** Provide clear Java domain/service/controller layering and testable modules.
5. **Deployability:** Support local and cloud deployment with environment-based configuration.

---

## 4. Non-Goals
- Native mobile applications
- Persistent media library or long-term file retention
- User accounts/authentication system
- Playlist management
- Multi-host permissions
- End-to-end encrypted media transfer

---

## 5. Success Metrics
- Room create/join/playback flows functionally equivalent to current implementation.
- Clients can join active sessions and sync to current playback position.
- Host disconnect triggers room destruction and media cleanup.
- Upload constraints and MIME validation enforced.
- No critical regressions in playback control messaging or room event handling.

---

## 6. Personas
### 6.1 Host
Creates room, uploads audio, controls playback, and ends session.

### 6.2 Listener
Joins via room code, receives media/state, and remains synced with host.

---

## 7. User Journeys
1. Host creates room -> receives 6-digit room code.
2. Listeners join room using code.
3. Host uploads supported audio file (<=100MB).
4. Server notifies room media is ready.
5. Host starts playback; listeners schedule playback according to server timestamps.
6. Listeners joining late receive current playback state and position.
7. Host pauses/seeks/resumes; all clients update accordingly.
8. Host disconnects; room is destroyed and room media deleted.

---

## 8. Functional Requirements

### 8.1 Room Management
- Generate unique 6-digit numeric room code.
- Allow host to create room.
- Allow listeners to join existing room.
- Track connected clients count per room.
- Emit room events for join/leave/destroy.

### 8.2 Roles & Permissions
- Exactly one host per room.
- Only host can send playback control commands (play/pause/seek/setDuration).
- Non-host control attempts must return error event.

### 8.3 Audio Upload & Access
- Endpoint for host upload bound to room code.
- Max file size: 100MB.
- Allow MIME types equivalent to current behavior:
  - `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/mp3`, `audio/wave`
- Persist upload into room-scoped temporary folder.
- Expose stream endpoint for room media with HTTP range support.
- Reject audio requests for missing or invalid room/audio state.

### 8.4 Playback State Authority
Server must hold authoritative room playback state:
- `isPlaying` (boolean)
- `playbackStartTime` (server epoch millis representing position 0 reference)
- `pausedAt` (seconds)
- `duration` (seconds)

Behavior:
- **Play:** set `isPlaying=true`, compute/retain proper `playbackStartTime`, broadcast play payload.
- **Pause:** compute current position, set `pausedAt`, `isPlaying=false`, broadcast pause payload.
- **Seek:** update position and if playing adjust `playbackStartTime`, broadcast seek payload.
- **Set Duration:** accept and store duration from host after decode.
- **Request State:** return full current playback state snapshot.

### 8.5 Real-time Messaging (WebSocket)
Support message types and parity-compatible contracts.

#### Client -> Server
- `createRoom`
- `joinRoom` (`roomCode`)
- `ping` (`clientTimestamp`)
- `play` (`startPosition` optional)
- `pause`
- `seek` (`position`)
- `setDuration` (`duration`)
- `requestState`

#### Server -> Client
- `roomCreated`
- `roomJoined`
- `audioUploaded`
- `play`
- `pause`
- `seek`
- `stateUpdate`
- `pong`
- `clientJoined`
- `clientLeft`
- `roomDestroyed`
- `error`

### 8.6 Clock Sync Support
- Server responds to periodic pings with server timestamp.
- Response includes enough timing data to allow client-side offset estimation.
- Must support repeated synchronization cycles from many clients.

### 8.7 Room Cleanup
On host disconnect:
- Notify listeners with `roomDestroyed`.
- Close all associated socket sessions.
- Delete room audio file(s).
- Remove room metadata and in-memory state.

### 8.8 Static Frontend Hosting Compatibility
- Serve `index.html` and static assets for local/dev mode.
- Keep API/WebSocket connectivity model compatible with existing frontend settings pattern.

---

## 9. Non-Functional Requirements

### 9.1 Performance
- Low-latency websocket dispatch for control messages.
- Room-level operations should remain responsive under moderate concurrent clients.
- Audio streaming must support browser seeking via range requests.

### 9.2 Scalability
- Initial version may keep in-memory room state (single instance).
- Architecture must allow future swap to distributed room/state store (e.g., Redis).

### 9.3 Reliability
- Defensive handling for malformed JSON/messages.
- Graceful handling for abrupt client disconnects.
- No orphaned room temp files after host termination.

### 9.4 Security
- Validate payload schema and numeric ranges.
- Strict file upload constraints (size and MIME type).
- Configure CORS via environment variable.
- Do not expose filesystem paths in client-visible errors.

### 9.5 Observability
- Structured logs for room lifecycle, uploads, playback actions, and errors.
- Log correlation by room code where possible.

---

## 10. Spring Boot Target Architecture

### 10.1 Technology Stack
- Java 21 (or project-approved LTS)
- Spring Boot 3.x
- Spring Web (REST + static files)
- Spring WebSocket
- Optional STOMP is **not required**; raw WebSocket handler acceptable for parity
- Bean Validation (Jakarta Validation)
- Jackson for JSON serialization

### 10.2 High-Level Components
- `RoomService` for room lifecycle/state
- `PlaybackService` for transport state transitions
- `UploadService` for media file handling and temp storage
- `AudioStreamController` for HTTP range streaming
- `WebSocketHandler` for realtime message routing
- `CleanupService` for room teardown and file deletion

### 10.3 Suggested Package Layout
- `config` (CORS, WebSocket, multipart limits)
- `controller` (upload, stream, health)
- `ws` (handler, message DTOs)
- `service` (room/playback/upload/cleanup)
- `model` (room, playback state, participant)
- `util` (room code generation, validation)

---

## 11. API Requirements

### 11.1 HTTP Endpoints
1. `GET /` -> serve frontend entry page (if bundled)
2. `POST /upload/{roomCode}` -> upload room audio
3. `GET /audio/{roomCode}` -> stream room audio with range support
4. `GET /health` -> readiness/liveness check (recommended)

### 11.2 Upload Response Requirements
- Success payload must include at least:
  - message/status
  - room code
  - audio URL
- On success, server must broadcast `audioUploaded` event to room clients.

### 11.3 Error Response Requirements
Consistent JSON errors with:
- machine-readable code
- human-readable message
- proper HTTP status codes (`400`, `403`, `404`, `413`, `415`, `500`)

---

## 12. WebSocket Protocol Requirements

### 12.1 Connection
- One websocket endpoint (e.g., `/ws`).
- Maintain mapping between socket session and room membership/role.

### 12.2 Message Handling Rules
- Reject unknown `type` with `error` event.
- Reject malformed payloads with `error` event.
- Validate room existence and role for each protected command.

### 12.3 Broadcast Semantics
- Host control messages propagate to all room participants (including host where required for UI consistency).
- Membership updates (`clientJoined`, `clientLeft`) propagate to room.
- Destroy event propagates before closure.

---

## 13. State Model

### 13.1 Room Aggregate
- `roomCode`
- `hostSessionId`
- `participantSessionIds`
- `audioFilePath`
- `createdAt`
- `playbackState`

### 13.2 Playback State
- `isPlaying`
- `playbackStartTime`
- `pausedAt`
- `duration`

### 13.3 Session Context
- `sessionId`
- `roomCode`
- `role` (`HOST`/`LISTENER`)

---

## 14. Configuration Requirements
All configurable via environment variables/application properties:
- `server.port` (default `3000` parity)
- CORS allowed origin(s)
- upload max file size (`100MB`)
- temp storage root path
- websocket message size limits
- optional debug logging toggle

---

## 15. Deployment Requirements
- Must run locally with one command (`mvn spring-boot:run` or equivalent packaged jar).
- Must support container deployment (Render/Railway/Fly or similar).
- Must support frontend-on-GitHub-Pages + backend-on-cloud split deployment model.
- Must support HTTPS deployments and secure websocket usage (`wss`) behind proxies.

---

## 16. Testing & Validation Requirements

### 16.1 Unit Tests
- Room code generation uniqueness/format.
- Playback transition calculations (play/pause/seek).
- Upload validation and limits.

### 16.2 Integration Tests
- WebSocket create/join flows.
- Host permission enforcement.
- Audio upload + stream endpoint behavior.
- Host disconnect -> room destroy + cleanup.

### 16.3 Manual E2E Validation
- Multi-tab/device sync behavior.
- Late joiner synchronization.
- Seek during active playback.
- Disconnect/reconnect edge cases.

---

## 17. Migration Mapping (Node -> Spring Boot)
- Express routes -> Spring MVC controllers
- ws server event switch -> Spring WebSocket handler dispatch
- Multer upload -> Spring Multipart handling
- In-memory JS objects -> Java concurrent in-memory repositories/services
- fs cleanup utilities -> Java NIO file lifecycle operations

---

## 18. Risks & Mitigations
1. **Timing jitter differences in JVM runtime**
   - Mitigation: use epoch millis consistently and keep client as drift-correction executor.
2. **Concurrency hazards in shared room state**
   - Mitigation: use thread-safe collections and synchronized state transitions.
3. **Proxy/WebSocket deployment quirks**
   - Mitigation: document required reverse-proxy headers and websocket config.
4. **File cleanup race conditions**
   - Mitigation: idempotent cleanup with robust exception handling.

---

## 19. Milestones
1. **M1: Foundation** - Spring Boot skeleton, config, health endpoint.
2. **M2: Realtime Core** - WebSocket protocol with room create/join and ping/pong.
3. **M3: Media Layer** - Upload + range streaming + MIME/size guards.
4. **M4: Playback Authority** - play/pause/seek/setDuration/stateUpdate parity.
5. **M5: Cleanup & Hardening** - host disconnect teardown, validation, logging.
6. **M6: Verification** - automated tests + manual sync parity checklist.

---

## 20. Acceptance Criteria (Release Gate)
A release is accepted when all are true:
1. Room create/join/upload/playback workflows operate end-to-end.
2. Only host can control playback; listeners receive clear errors otherwise.
3. Late joiner receives current state and can sync immediately.
4. Audio streaming supports browser seek/range operations.
5. Host disconnect destroys room and removes uploaded media.
6. Configurable CORS and file limits are enforced in deployed environments.
7. Core manual sync tests pass on at least two devices/browsers.

---

## 21. Future Enhancements (Out of Scope for Initial Rebuild)
- Redis-backed distributed room state
- Horizontal multi-instance coordination
- Persistent session replay/analytics
- Authentication and room privacy controls
- Adaptive sync analytics dashboard

