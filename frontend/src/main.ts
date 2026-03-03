// Constants
const SIGNALING_URL = "ws://localhost:8080";
const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// DOM Elements
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnHangup = document.getElementById("btn-hangup") as HTMLButtonElement;
const roomLinkContainer = document.getElementById("room-link-container") as HTMLDivElement;
const roomLinkText = document.getElementById("room-link-text") as HTMLSpanElement;
const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;

const localVideo = document.getElementById("local-video") as HTMLVideoElement;
const remoteVideo = document.getElementById("remote-video") as HTMLVideoElement;
const remoteWrapper = document.getElementById("remote-wrapper") as HTMLDivElement;

const statusText = document.getElementById("status-text") as HTMLSpanElement;
const errorBanner = document.getElementById("error-banner") as HTMLDivElement;

// App State
let sessionId = getSessionId();
let currentRoomId: string | null = null;
let isHost: boolean = false;
let ws: WebSocket | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

// The Buffered Ice Candidate Queue to prevent "ICE arrives before Remote Description" bug
let iceCandidateQueue: RTCIceCandidateInit[] = [];

// ==============================
// 1. Initialize
// ==============================
function getSessionId(): string {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("sessionId", id);
  }
  return id;
}

function updateStatus(text: string) {
  statusText.innerText = text;
  console.log(`[Status] ${text}`);
}

function showError(msg: string) {
  errorBanner.innerText = msg;
  errorBanner.classList.remove("hidden");
  setTimeout(() => {
    errorBanner.classList.add("hidden");
  }, 5000);
}

// Ensure the page drops WebRTC silently on reload
window.addEventListener("beforeunload", () => teardown(false));

initPage();

function initPage() {
  updateStatus("Connecting to signaling server...");

  ws = new WebSocket(SIGNALING_URL);

  ws.onopen = async () => {
    updateStatus("Connected to signaling server");

    // Grab local media so user sees themselves immediately
    await setupLocalMedia();

    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get("room");

    if (roomIdFromUrl) {
      // Join Flow
      currentRoomId = roomIdFromUrl;
      ws!.send(JSON.stringify({
        type: "join",
        roomId: currentRoomId,
        sessionId
      }));
      updateStatus(`Joining room ${currentRoomId}...`);
      btnStart.classList.add("hidden");
      btnHangup.classList.remove("hidden");
    } else {
      // Create Flow (wait for user action)
      btnStart.addEventListener("click", () => {
        ws!.send(JSON.stringify({ type: "create", sessionId }));
      });
    }
  };

  ws.onclose = () => {
    updateStatus("Disconnected from signaling server");
    teardown(true);
  };

  ws.onerror = () => {
    showError("WebSocket connection failed!");
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      await handleSignalingMessage(msg);
    } catch (e) {
      console.error("Failed to parse signaling message:", e);
    }
  };

  btnHangup.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
      ws.send(JSON.stringify({ type: "hangup", roomId: currentRoomId, sessionId }));
    }
    teardown(true);
    // Clear URL
    window.history.pushState({}, "", window.location.pathname);
    location.reload();
  });

  btnCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(window.location.href);
    btnCopy.innerText = "Copied!";
    setTimeout(() => btnCopy.innerText = "Copy Link", 2000);
  });
}

// ==============================
// 2. WebRTC Core
// ==============================

async function setupLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (e) {
    showError("Camera or Microphone access denied. Cannot proceed.");
    throw e;
  }
}

async function initPeerConnection() {
  if (pc) {
    console.warn("RTCPeerConnection already exists. Destroying old one.");
    pc.close();
  }

  pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  iceCandidateQueue = [];

  // Add local tracks to PC
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc!.addTrack(track, localStream!);
    });
  }

  // Handle remote tracks arriving
  pc.ontrack = (event) => {
    console.log("[WebRTC] Received remote track");
    remoteWrapper.classList.remove("hidden"); // Reveal the parallel box when partner stream connects
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };

  // Forward ICE Candidates to Signaling Server
  pc.onicecandidate = (event) => {
    if (event.candidate && currentRoomId && ws && ws.readyState === WebSocket.OPEN) {
      console.log("[WebRTC] Sending ICE Candidate");
      ws.send(JSON.stringify({
        type: "ice-candidate",
        roomId: currentRoomId,
        sessionId,
        candidate: event.candidate.toJSON()
      }));
    }
  };

  // Monitor Connection State for Timeout/Failure handling
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Connection State: ${pc!.connectionState}`);
    if (pc!.connectionState === "connected") {
      updateStatus("Peer Connected! 🎥");
    } else if (pc!.connectionState === "failed") {
      showError("Network blocked P2P connection (ICE Failed). Please switch networks.");
      teardown(false);
    }
  };
}

async function flushIceQueue() {
  if (!pc || pc.remoteDescription === null) return;
  for (const candidate of iceCandidateQueue) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      console.error("Failed to add buffered ICE candidate:", e);
    }
  }
  iceCandidateQueue = [];
}

// ==============================
// 3. Signaling Message Matrix
// ==============================

async function handleSignalingMessage(msg: any) {
  if (msg.type === "error") {
    if (msg.code === "ROOM_EXPIRED") {
      alert("The meeting has expired due to inactivity.");
      teardown(true);
      window.history.pushState({}, "", window.location.pathname);
      location.reload();
    } else if (msg.code === "ROOM_NOT_FOUND" || msg.code === "ROOM_FULL") {
      showError(`Cannot enter room: ${msg.message}`);
      teardown(true);
    } else {
      console.error("[Signaling Error]", msg.message);
    }
    return;
  }

  if (msg.type === "created") {
    currentRoomId = msg.roomId;
    isHost = true;

    btnStart.classList.add("hidden");
    btnHangup.classList.remove("hidden");

    // Show the link
    window.history.pushState({}, "", `?room=${currentRoomId}`);
    roomLinkText.innerText = window.location.href;
    roomLinkContainer.classList.remove("hidden");

    updateStatus(`Room Created. Joining...`);

    // Host must formally join the room topology
    ws!.send(JSON.stringify({
      type: "join",
      roomId: currentRoomId,
      sessionId
    }));
    return;
  }

  if (msg.type === "joined") {
    isHost = msg.isHost;
    updateStatus(`Joined room successfully as ${isHost ? "Host" : "Guest"}.`);

    // Initialize PC early so it can catch and queue any incoming ICE candidates!
    await initPeerConnection();

    // The one who joins late (Guest) ALWAYS sends the offer to avoid Glare.
    if (!isHost) {
      updateStatus("Initiating WebRTC Offer...");
      const offer = await pc!.createOffer();
      await pc!.setLocalDescription(offer);

      ws!.send(JSON.stringify({
        type: "offer",
        roomId: currentRoomId,
        sessionId,
        sdp: offer.sdp
      }));
    } else {
      updateStatus("Room active. Waiting for guest to connect...");
    }
    return;
  }

  // --- Active WebRTC Lifecycle Messages ---

  if (msg.type === "offer") {
    console.log("[Signaling] Received Offer. Creating Answer.");

    // PC should already be initialized in "joined", but just in case:
    if (!pc) {
      await initPeerConnection();
    }

    const offerDesc = new RTCSessionDescription({ type: "offer", sdp: msg.sdp });
    await pc!.setRemoteDescription(offerDesc);

    // Flush any ICE candidates that arrived before the RemoteDescription was ready
    await flushIceQueue();

    const answer = await pc!.createAnswer();
    await pc!.setLocalDescription(answer);

    ws!.send(JSON.stringify({
      type: "answer",
      roomId: currentRoomId,
      sessionId,
      sdp: answer.sdp
    }));

    updateStatus("Answering call...");
    return;
  }

  if (msg.type === "answer") {
    if (!pc) return;
    console.log("[Signaling] Received Answer. Completing handshake.");
    const answerDesc = new RTCSessionDescription({ type: "answer", sdp: msg.sdp });
    await pc.setRemoteDescription(answerDesc);
    await flushIceQueue();
    return;
  }

  if (msg.type === "ice-candidate") {
    if (!pc) return;
    console.log("[Signaling] Received ICE Candidate");
    const candidate = msg.candidate; // May be null for end of candidates
    if (candidate) {
      const rtcCandidate = new RTCIceCandidate(candidate);
      // ICE Buffering strategy to prevent typical racing bugs
      if (pc.remoteDescription === null) {
        iceCandidateQueue.push(rtcCandidate);
      } else {
        try {
          await pc.addIceCandidate(rtcCandidate);
        } catch (e) {
          console.error("Failed to add remote ICE candidate", e);
        }
      }
    }
    return;
  }

  if (msg.type === "peer_left" || msg.type === "hangup") {
    updateStatus("Peer left the room.");
    console.log("[Signaling] Peer disconnected remotely");

    // Retain the room, but destroy the PC so we are ready for a new connection
    if (pc) {
      pc.close();
      pc = null;
    }
    remoteVideo.srcObject = null;
    iceCandidateQueue = [];

    if (isHost) {
      // Keep the link UI up so they can invite someone else
      updateStatus("Peer left. Room still open, invite someone else!");
    } else {
      // The guest probably shouldn't stay in an empty room, but host re-assignment exists
      updateStatus("Peer left. Waiting for new signals...");
    }
    return;
  }
}

// ==============================
// 4. Teardown & Utility
// ==============================
function teardown(killSocket: boolean) {
  if (pc) {
    pc.close();
    pc = null;
  }

  // Explicitly do not destroy local stream so user doesn't lose camera 
  // unless closing the whole page
  remoteVideo.srcObject = null;
  currentRoomId = null;

  if (killSocket && ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    ws = null;
  }

  remoteWrapper.classList.add("hidden");
  roomLinkContainer.classList.add("hidden");
  btnHangup.classList.add("hidden");
  btnStart.classList.remove("hidden");
}
