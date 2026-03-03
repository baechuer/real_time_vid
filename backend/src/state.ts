import { WebSocket } from "ws";

export type Peer = {
    id: string;
    ws: WebSocket;
    isHost: boolean;
};

export type Room = {
    id: string;
    peers: Map<string, Peer>; // Maps peerId to the Peer object
};

/**
 * Temporary in-memory state representing the single-instance server storage.
 * Wrapped in a class to simplify migrating to Redis/DB later if needed.
 */
export class RoomManager {
    private rooms: Map<string, Room> = new Map();

    getRoom(roomId: string): Room | undefined {
        return this.rooms.get(roomId);
    }

    getOrCreateRoom(roomId: string): Room {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = { id: roomId, peers: new Map() };
            this.rooms.set(roomId, room);
        }
        return room;
    }

    deleteRoom(roomId: string): void {
        this.rooms.delete(roomId);
    }

    /**
     * Reassigns host if the original host disconnects
     */
    reassignHost(room: Room): void {
        const remainingPeers = Array.from(room.peers.values());
        if (remainingPeers.length === 0) {
            // Room is completely empty, clean it up
            this.deleteRoom(room.id);
            return;
        }

        // Check if there is still a host. If not, assign the first peer as host.
        const hasHost = remainingPeers.some(p => p.isHost);
        if (!hasHost) {
            const nextHost = remainingPeers[0];
            if (nextHost) {
                nextHost.isHost = true;
                console.log(`[Room ${room.id}] New host assigned: ${nextHost.id}`);
            }
        }
    }
}

// Global singleton
export const roomManager = new RoomManager();
