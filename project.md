# WebRTC 1v1 STUN-Only Video Calling Demo

## 1. Project Description
This project is a STUN-only 1v1 WebRTC video call demonstration. The system is designed to be lightweight, straightforward, and focused on peer-to-peer connectivity using only STUN servers. It consists of a Node.js + TypeScript Signaling Server using WebSockets and a Vanilla WebRTC Browser Client. 

The core philosophy of this demo is to handle P2P signaling without participating in media transport. If NAT mapping or network conditions prevent a direct peer-to-peer connection, the system must fail gracefully and quickly, instructing the user to switch networks.

---

## 2. Architecture & Component Decomposition

### 2.1 Signaling Server (Node.js + TypeScript + WebSocket)
The signaling server acts solely as a message broker for peers in the same room.
- **Responsibilities**: 
  - Forward `offer`, `answer`, `ice-candidate`, and `hangup` messages between exactly two clients in a `roomId`.
  - Maintain an in-memory state of active rooms and peers.
  - Enforce room limits (max 2 participants).
  - Clean up state automatically upon WebSocket disconnection.
- **Non-Responsibilities**: 
  - Does NOT process, parse, or modify SDP or media streams.
  - Does NOT act as an SFU/MCU or TURN server.

### 2.2 Web Client (Browser WebRTC)
The client application runs in the browser and handles local media capture and peer-to-peer connections.
- **Responsibilities**:
  - Capture local audio and video using `getUserMedia`.
  - Establish `RTCPeerConnection` configured strictly with STUN servers.
  - Exchange SDP and ICE candidates via the Signaling Server.
  - Render local and remote video streams.
  - Handle connection state changes, including strict timeouts (20s) and fallback UX for failed ICE connections.

---

## 3. Constraints

### 3.1 Scope Constraints
- **1v1 Only**: Each room supports a maximum of 2 peers. A 3rd peer attempting to join must be rejected gracefully.
- **STUN-Only**: Client ICE configurations must absolutely avoid `turn:` or `turns:` URIs. The server will not provide a TURN relay.
- **No Media Relay**: The server does no media processing. Zero SFU/MCU capabilities.
- **No Persistence**: No databases, Redis, or Message Queues are allowed. All room state must be managed in transient memory.

### 3.2 Networking Constraints
- **Expected Failures**: The application doesn't promise universal connectivity. Symmetric NATs, CGNAT, or UDP blocking will cause `ICE failed`. This is an accepted and expected constraint.
- **Strict Timeout**: A hard 20-second timeout for establishing the connection (`connected` state). Failure to connect within this window must trigger a failure UX prompting the user to switch networks or use cellular hotspots.

### 3.3 Robustness & Correctness Constraints
- **Asynchronous Execution**: ICE candidates may arrive before the `remoteDescription` is set. The client MUST buffer these candidates and apply them only after `setRemoteDescription` is successful.
- **Cleanup**: WebSocket disconnections must instantly clean up the room state and notify the peer.
- **Validation**: The server must perform strict input validation on message schemas, `roomId` payloads, and enforce size limits. Malformed messages must not crash the Node.js process.

### 3.4 Security Constraints
- **Transport Security**: Production deployments must be served over WSS (TLS can be terminated via a reverse proxy like Nginx or Caddy).
- **Rate/Size Limiting**: WebSocket message payloads must be strictly limited (e.g., 64KB) to prevent SDP/JSON abuse.
- **Data Privacy**: SDP contents must never be logged or persisted (unless implicitly required under an explicit debug mode).

---

## 4. Acceptance Criteria

### 4.1 Functional
- [ ] **Basic Call Success**: Two clients on easily penetrable networks (e.g., Home Wi-Fi ↔ Home Wi-Fi, Wi-Fi ↔ Cellular Hotspot) can see and hear each other.
- [ ] **STUN-Only Verified**: Client configuration demonstrably excludes TURN. Logs prove only STUN is negotiated.
- [ ] **Room Limits**: A 3rd client attempting to join an active room receives a `ROOM_FULL` (or equivalent) error and does not impact the ongoing call.
- [ ] **Teardown**: If one peer closes the tab, drops offline, or hangs up, the remote peer receives a disconnect notification within 3 seconds and resets to a joinable state.

### 4.2 Failure Handling
- [ ] **ICE Failure UX**: On impenetrable networks (e.g., Strict Corporate NAT), the connection predictably fails within 20 seconds. The UI clearly displays an "ICE Failed" message with actionable advice (e.g., "Switch Wi-Fi or use a hotspot").
- [ ] **No Silent Failures (Black Screens)**: Successful connections must guarantee remote video visibility (proper `ontrack` execution and `autoplay` policy compliance).

### 4.3 Observability
- [ ] **Client Telemetry**: The browser console must log all pivotal state transitions: `iceGatheringState`, `iceConnectionState`, and `connectionState`.
- [ ] **Server Telemetry**: The server must output structured JSON or formatted logs including `roomId`, `peerId`, `msgType`, and `event` (`join`, `forward`, `disconnect`, `error`).

---

## 5. Task Decomposition & Execution Plan

This execution plan prioritizes zero-dependency foundations, followed by basic plumbing, and finally robustness/edge-case handling.

### Phase 0: Repo & Tooling
- [ ] Initialize monorepo or standard folder structure (`signaling-server/`, `client/`).
- [ ] Setup Node.js + TS environment (`tsx` for dev, `tsc` for build).
- [ ] Implement basic Linting/Formatting.
> **Done when**: `npm run dev` successfully spins up a raw WS server and build artifacts are executable.

### Phase 1: Signaling Protocol & Error Codes
- [ ] Define standardized Message Schema (TS Types + Runtime schema validation like Zod).
- [ ] Define standardized Error Codes: `ROOM_FULL`, `BAD_MESSAGE`, `NOT_JOINED`, `PEER_NOT_READY`, `PEER_DISCONNECTED`.
- [ ] Draft constraints/types for `roomId` and `peerId`.
> **Done when**: Server safely drops or replies with errors to badly formatted WS payloads without crashing.

### Phase 2: Room/Peer State Machine
- [ ] Implement robust Memory State: `roomId -> { peers: Map<peerId, ws> }`.
- [ ] Implement `join`/`leave` logic (enforcing 2-peer maximum and empty-room destruction).
- [ ] Implement `forward` logic to securely route `offer`/`answer`/`ice`/`hangup` only to the remote peer.
- [ ] Attach payload size limits and pure JSON parse guards.
> **Done when**: Two local peers can join the same room and reliably bounce mock JSON messages. Third peer is rejected.

### Phase 3: Client Basic WebRTC Happy Path
- [ ] Build minimal UI: Room input, Join/Leave buttons, Local/Remote `<video>` containers, Status indicator.
- [ ] Hook up `getUserMedia` and local preview.
- [ ] Scaffold `RTCPeerConnection` (add tracks, create offer/answer, set local/remote descriptions).
- [ ] Setup `onicecandidate` to trigger signaling, and handle incoming `offer`/`answer`.
- [ ] Implement `ontrack` to map the remote media stream to the respective `<video>` element.
> **Done when**: Two browser tabs on the same machine/LAN can successfully establish a video/audio feed.

### Phase 4: Client Robustness (Candidate Buffering & Negotiation Guards)
- [ ] Buffer incoming ICE candidates if `remoteDescription` is null; flush buffer upon `setRemoteDescription` completion.
- [ ] Filter duplicate/out-of-order signaling messages (ignore rogue messages for invalid rooms or disconnected sessions).
- [ ] Gatekeeper: Only permit signaling outbox if the peer is formally in the `joined` state.
> **Done when**: Artificial delays/shuffles added to ICE payload delivery do not crash or stall the connection logic.

### Phase 5: Failure Handling (Timeout + ICE Failed UX)
- [ ] Implement a strict 20-second connection timeout (Timer starts at Offer/Answer exchange, clears on `connected`).
- [ ] Monitor `iceConnectionState` / `connectionState`. If they emit `failed`, trigger UI error state.
- [ ] Draft and render the explicit "STUN-Only Connection Failed - Please Switch Networks" UI text.
- [ ] Build comprehensive Hangup/Cleanup: Stop all media tracks, run `pc.close()`, emit WS hangup, and zero out UI.
> **Done when**: Forcing an impossible connection clearly fails within 20s and safely resets the UI for another try.

### Phase 6: Test Matrix & README
- [ ] Write detailed local and production deployment instructions.
- [ ] Draft the Test Matrix (define 6 network topology pairs, e.g., 4G-to-4G, Corp-to-Home).
- [ ] Populate the FAQ section with anticipated edge-cases (black screen, permissions, WS disconnects).
> **Done when**: An external developer can read the README, understand the expected edge cases, run the repo locally, and replicate the failure boundaries.

### Phase 7: Deployment Hardening (Optional)
- [ ] Setup a reverse proxy config (e.g., Caddy/Nginx) for WSS TLS termination.
- [ ] Write `Dockerfile` and `docker-compose.yml` for the backend.
- [ ] Apply basic connection caps/rate limits appropriate for a demo.
> **Done when**: WSS endpoint is publicly accessible and successfully negotiated by browsers on differing WANs.
