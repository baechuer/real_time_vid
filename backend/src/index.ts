import { WebSocket, WebSocketServer, RawData } from "ws";
import { AnyMessageSchema, createErrorMessage } from "./messages.js";
import { roomManager } from "./state.js";

const wss = new WebSocketServer({ port: 8080 });

console.log("WebSocket signaling server running on ws://localhost:8080");

wss.on("connection", (ws: WebSocket) => {
    let currentRoomId: string | null = null;
    let currentPeerId: string | null = null;

    console.log("Client connected");

    ws.on("message", (data: RawData) => {
        // Enforce arbitrary 64KB max message size
        if (data.toString().length > 64 * 1024) {
            ws.send(createErrorMessage("BAD_MESSAGE", "Payload too large"));
            return;
        }

        try {
            const parsedJson = JSON.parse(data.toString());
            const parsed = AnyMessageSchema.safeParse(parsedJson);

            if (!parsed.success) {
                console.warn(`Validation failed: ${JSON.stringify(parsed.error.issues)}`);
                ws.send(createErrorMessage("BAD_MESSAGE", "Invalid message format"));
                return;
            }

            const message = parsed.data;

            if (message.type === "join") {
                const room = roomManager.getOrCreateRoom(message.roomId);

                // Re-joining same session shouldn't double count, but for 1v1 we just strictly enforce size
                if (room.peers.size >= 2 && !room.peers.has(message.peerId)) {
                    ws.send(createErrorMessage("ROOM_FULL", "Room is already full"));
                    return;
                }

                currentRoomId = message.roomId;
                currentPeerId = message.peerId;

                const isFirstPeer = room.peers.size === 0;
                room.peers.set(message.peerId, { id: message.peerId, ws, isHost: isFirstPeer });

                console.log(`[Room ${message.roomId}] Peer ${message.peerId} joined. Total: ${room.peers.size}`);
                // Optional: Tell user they connected
                ws.send(JSON.stringify({ type: "joined", isHost: isFirstPeer }));
            } else {
                // Ensure they joined a room first
                if (!currentRoomId || !currentPeerId || currentRoomId !== message.roomId) {
                    ws.send(createErrorMessage("NOT_JOINED", "You must join the room before sending signaling messages"));
                    return;
                }

                const room = roomManager.getRoom(currentRoomId);
                if (!room) return;

                // Typical relay: loop through peers and send to the *other* person.
                let forwarded = false;
                room.peers.forEach((peer) => {
                    if (peer.id !== currentPeerId) {
                        peer.ws.send(JSON.stringify(message));
                        forwarded = true;
                    }
                });

                if (!forwarded) {
                    // It's helpful to log but we don't necessarily abort. 
                    console.log(`[Room ${currentRoomId}] Peer ${currentPeerId} sent ${message.type} but no recipient is present.`);
                }
            }
        } catch (e) {
            console.error("Failed to parse JSON", e);
            ws.send(createErrorMessage("BAD_MESSAGE", "Invalid JSON payload"));
        }
    });

    ws.on("close", () => {
        if (currentRoomId && currentPeerId) {
            const room = roomManager.getRoom(currentRoomId);
            if (room) {
                room.peers.delete(currentPeerId);
                console.log(`[Room ${currentRoomId}] Peer ${currentPeerId} disconnected.`);

                // If the disconnected peer was the host, re-assign
                roomManager.reassignHost(room);

                // Automatically notify the remaining peer that their partner left
                room.peers.forEach((peer) => {
                    peer.ws.send(JSON.stringify({
                        type: "hangup",
                        roomId: currentRoomId,
                        peerId: currentPeerId
                    }));
                });
            }
        }
        console.log("Client socket completely closed");
    });
});
