import { WebSocket, WebSocketServer, RawData } from "ws";
import { v4 as uuidv4 } from "uuid";
import { AnyMessageSchema, createErrorMessage } from "./messages.js";
import { roomManager } from "./state.js";

const wss = new WebSocketServer({ port: 8080 });

console.log("WebSocket signaling server running on ws://localhost:8080");

wss.on("connection", (ws: WebSocket) => {
    // Ephemeral Connection ID bound to this exact TCP stream
    const connId = uuidv4();
    let currentRoomId: string | null = null;
    let currentSessionId: string | null = null;

    console.log(`[Conn ${connId}] Client connected`);

    ws.on("message", (data: RawData) => {
        if (data.toString().length > 64 * 1024) {
            ws.send(createErrorMessage("BAD_MESSAGE", "Payload too large"));
            return;
        }

        try {
            const parsedJson = JSON.parse(data.toString());
            const parsed = AnyMessageSchema.safeParse(parsedJson);

            if (!parsed.success) {
                console.warn(`[BAD_MESSAGE] Validation failed: ${JSON.stringify(parsed.error.issues)}`);
                ws.send(createErrorMessage("BAD_MESSAGE", "Invalid message format"));
                return;
            }

            const message = parsed.data;

            // --- Phase 1.5: Explicit Room Creation (Idempotent) ---
            if (message.type === "create") {
                const existingRoomId = roomManager.getHostedRoomId(message.sessionId);
                if (existingRoomId) {
                    // Idempotent return
                    console.log(`[Conn ${connId}] Idempotent create: ${message.sessionId} already hosts ${existingRoomId}`);
                    ws.send(JSON.stringify({ type: "created", roomId: existingRoomId }));
                    return;
                }

                const newRoomId = uuidv4().slice(0, 8); // Short room ID for demo
                roomManager.createRoom(newRoomId, message.sessionId);
                console.log(`[Room ${newRoomId}] Created by session ${message.sessionId}`);

                ws.send(JSON.stringify({ type: "created", roomId: newRoomId }));
                return;
            }

            // For all other messages, they MUST target an existing room
            if (!("roomId" in message)) return;
            const targetRoomId = message.roomId;

            if (message.type === "join") {
                const room = roomManager.getRoom(targetRoomId);

                if (!room) {
                    ws.send(createErrorMessage("ROOM_NOT_FOUND", "This meeting link is invalid or expired."));
                    return;
                }

                // Check limits (allow reconnects for the same sessionId)
                if (room.peers.size >= 2 && !room.peers.has(message.sessionId)) {
                    console.log(`[Room ${targetRoomId}] Rejecting 3rd peer ${message.sessionId}. Room is FULL.`);
                    ws.send(createErrorMessage("ROOM_FULL", "Room is already full"));
                    return;
                }

                const existingPeer = room.peers.get(message.sessionId);
                if (existingPeer && existingPeer.ws.readyState === WebSocket.OPEN && existingPeer.ws !== ws) {
                    console.log(`[Room ${targetRoomId}] Session ${message.sessionId} hijacked by a new tab. Kicking old connection.`);
                    existingPeer.ws.send(createErrorMessage("BAD_MESSAGE", "Session resumed in another tab."));
                    existingPeer.ws.close();
                }

                currentRoomId = targetRoomId;
                currentSessionId = message.sessionId;

                const isHost = room.hostSessionId === message.sessionId;
                room.peers.set(message.sessionId, {
                    sessionId: message.sessionId,
                    connId, // Bind current transient connection 
                    ws,
                    isHost
                });

                roomManager.markActive(targetRoomId);

                console.log(`[Room ${targetRoomId}] Session ${message.sessionId} joined. Total: ${room.peers.size}`);
                // Tell user they successfully connected to the room topology
                ws.send(JSON.stringify({ type: "joined", isHost }));
            } else {
                // Ensure they joined a room first
                if (!currentRoomId || !currentSessionId || currentRoomId !== targetRoomId) {
                    ws.send(createErrorMessage("NOT_JOINED", "You must join the room before sending signaling messages"));
                    return;
                }

                const room = roomManager.getRoom(currentRoomId);
                if (!room) return;

                roomManager.markActive(currentRoomId);

                // Relay strictly to the *other* person.
                let forwarded = false;
                room.peers.forEach((peer) => {
                    if (peer.sessionId !== currentSessionId) {
                        peer.ws.send(JSON.stringify(message));
                        forwarded = true;
                    }
                });

                if (!forwarded) {
                    console.log(`[Room ${currentRoomId}] Peer ${currentSessionId} sent ${message.type} but no recipient is present.`);
                }
            }
        } catch (e) {
            console.warn(`[BAD_MESSAGE] Failed to parse JSON, ignoring payload. (Payload length: ${data.toString().length})`);
            ws.send(createErrorMessage("BAD_MESSAGE", "Invalid JSON payload"));
        }
    });

    ws.on("close", () => {
        if (currentRoomId && currentSessionId) {
            const room = roomManager.getRoom(currentRoomId);
            if (room) {
                // Phase 2 Robustness: Only delete from room if connId strictly matches!
                const didRemove = roomManager.removePeerIfConnectionMatches(room, currentSessionId, connId);

                if (didRemove) {
                    console.log(`[Room ${currentRoomId}] Session ${currentSessionId} formally disconnected.`);

                    roomManager.reassignHost(room);

                    // Notify partner
                    room.peers.forEach((peer) => {
                        if (peer.ws.readyState === WebSocket.OPEN) {
                            peer.ws.send(JSON.stringify({
                                type: "peer_left",
                                roomId: currentRoomId,
                                sessionId: currentSessionId
                            }));
                        }
                    });

                    // If room is now totally empty, GC immediately
                    if (room.peers.size === 0) {
                        console.log(`[Room ${currentRoomId}] Empty after disconnect, sweeping immediately.`);
                        roomManager.deleteRoom(currentRoomId);
                    }
                } else {
                    console.log(`[Room ${currentRoomId}] Stale connection ${connId} for session ${currentSessionId} closed. Ignored.`);
                }
            }
        }
        console.log(`[Conn ${connId}] Client socket completely closed`);
    });
});
