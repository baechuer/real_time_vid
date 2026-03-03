# Real-Time 1v1 Video Calling Web App

A robust, ultra-fast, strictly 1v1 real-time video calling application built with Vanilla TypeScript, WebRTC, and WebSockets.

> **Status:** 🚧 **Localhost Prepared Phase.** 
> This version is finalized for local network testing. It has not been deployed to production environments yet.

## 🌟 Objective

To demonstrate a flawless WebRTC peer-to-peer connection flow using a minimal, zero-dependency frontend and a highly reliable WebSocket signaling layer. The core focus is on **state consistency, connection isolation, and edge-case handling** (e.g., stale connections, tab hijacking, glare avoidance).

## 🏗️ Architecture & Constraints

This project was built under specific engineering constraints to guarantee stability and prevent bloated architectures:

### 1. Strict 1v1 Capacity Limit (Hard Enforced)
The room topology is hard-capped at 2 participants using strict UUID validation. 
* If a 3rd person attempts to join, they are immediately rejected with a `ROOM_FULL` signal and their TCP socket is forcefully closed by the backend.
* If a participant drops, their slot is dynamically freed, allowing exactly one legal participant to substitute in via `join`.

### 2. Pure STUN, No TURN
* **Constraint:** This project relies *exclusively* on Google's public STUN servers. It intentionally **does not use a TURN server**.
* **Assumption (NAT Limitations):** Because we rely strictly on P2P UDP hole punching via STUN, the video tunnel will only succeed if both peers are behind moderate NATs. If one or both peers are behind a strict Symmetric NAT (such as rigid corporate firewalls), the WebRTC connection will fail to penetrate.

### 3. Session Isolation vs. Connection Hijacking
A major pitfall in standard WebSocket demos is "Tab Hijacking" (e.g., opening multiple tabs creates ghost connections that freeze the state).
* **Strategy:** The frontend uses `sessionStorage` instead of `localStorage`. Every browser tab acts as a completely isolated entity with a unique `sessionId`.
* **Guard:** The backend actively detects and severs stale connections (`connId`) if a session attempts rapid re-entry, preventing ghost tunnels.

### 4. "Late Joiner Offers" Topology (Glare Avoidance)
To prevent WebRTC glare (where both sides shout `offer` at the same time and crash the handshake):
* The **Host** (creator) silently idles and waits for incoming connections.
* The **Guest** (the 2nd joiner) is structurally mandated to initiate the `offer` and generate ICE candidates. 
* ICE candidates arriving before the Remote Description (`sdp`) is fully parsed are gracefully queued into an `iceCandidateQueue` array and processed retroactively.

## 🚀 Getting Started (Local Development)

### 1. Start the Signaling Backend
The backend runs on Port `8080`.
```bash
cd backend
npm install
npm run dev
```

### 2. Start the Frontend Vite Server
The frontend runs on an ephemeral port (usually `5173`).
```bash
cd frontend
npm install
npm run dev
```

### 3. Test Locally
1. Open up `http://localhost:5173`.
2. Click **Start Meeting**.
3. Allow Camera/Mic permissions to see your Local Video.
4. Click **Copy Link**.
5. Open a **new Tab** or a **new Incognito Window**.
6. Paste the link. The P2P stream will establish within milliseconds.

---
*Built from scratch to understand the deep quirks of WebRTC and WebSocket Signal Syncing.*
