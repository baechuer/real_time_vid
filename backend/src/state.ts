import { WebSocket } from "ws";

export type Peer = {
    sessionId: string;
    connId: string;
    ws: WebSocket;
    isHost: boolean;
};

export type Room = {
    id: string;
    hostSessionId: string;
    peers: Map<string, Peer>; // Maps sessionId to the Peer object
    lastActiveAt: number;
};

/**
 * Temporary in-memory state representing the single-instance server storage.
 * Separates Logical Session from Transient Connection to prevent stale WS overwrites.
 */
export class RoomManager {
    private rooms: Map<string, Room> = new Map();
    // Idempotency structure: O(1) lookup to find if a session already hosts a room
    private hostRoomBySession: Map<string, string> = new Map();

    getRoom(roomId: string): Room | undefined {
        return this.rooms.get(roomId);
    }

    createRoom(roomId: string, hostSessionId: string): Room {
        const room: Room = {
            id: roomId,
            hostSessionId,
            peers: new Map(),
            lastActiveAt: Date.now()
        };
        this.rooms.set(roomId, room);
        this.hostRoomBySession.set(hostSessionId, roomId);
        return room;
    }

    getHostedRoomId(sessionId: string): string | undefined {
        return this.hostRoomBySession.get(sessionId);
    }

    deleteRoom(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (room) {
            this.hostRoomBySession.delete(room.hostSessionId);
            this.rooms.delete(roomId);
        }
    }

    markActive(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (room) {
            room.lastActiveAt = Date.now();
        }
    }

    /**
     * Stale Connection Protection: Only delete if the disconnecting connId matches
     * the currently active connId for that session.
     */
    removePeerIfConnectionMatches(room: Room, sessionId: string, connId: string): boolean {
        const peer = room.peers.get(sessionId);
        if (peer && peer.connId === connId) {
            room.peers.delete(sessionId);
            return true;
        }
        // It was a stale connection trying to close an already re-connected session
        return false;
    }

    /**
     * Reassigns host if the original host definitively disconnects
     */
    reassignHost(room: Room): void {
        const remainingPeers = Array.from(room.peers.values());
        if (remainingPeers.length === 0) {
            return;
        }

        const hasHost = remainingPeers.some(p => p.isHost);
        if (!hasHost) {
            const nextHost = remainingPeers[0];
            if (nextHost) {
                nextHost.isHost = true;
                // Update the idempotency map since ownership transferred
                this.hostRoomBySession.delete(room.hostSessionId);
                room.hostSessionId = nextHost.sessionId;
                this.hostRoomBySession.set(nextHost.sessionId, room.id);
                console.log(`[Room ${room.id}] New host reassigned to: ${nextHost.sessionId}`);
            }
        }
    }

    /**
     * TTL Sweeper
     * Deletes rooms that haven't been active in exactly 30 minutes.
     */
    startTTLSweeper() {
        setInterval(() => {
            const now = Date.now();
            const TTL_LIMIT = 30 * 60 * 1000; // 30 minutes
            for (const [roomId, room] of this.rooms.entries()) {
                if (now - room.lastActiveAt > TTL_LIMIT) {
                    console.log(`[Room ${roomId}] TTL Expired (Inactive >30m). Sweeping.`);

                    // Force broadcast expiration
                    room.peers.forEach(peer => {
                        if (peer.ws.readyState === WebSocket.OPEN) {
                            peer.ws.send(JSON.stringify({ type: "error", code: "ROOM_NOT_FOUND", message: "Room expired due to inactivity." }));
                            peer.ws.close();
                        }
                    });

                    this.deleteRoom(roomId);
                }
            }
        }, 60 * 1000); // Check every 60 seconds
    }
}

// Global singleton
// Global singleton
export const roomManager = new RoomManager();
roomManager.startTTLSweeper();
