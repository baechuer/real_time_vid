import WebSocket from "ws";

const HOST = "ws://localhost:8080";

async function runTests() {
    console.log("=== Running Backend Verification Tests ===");

    const hostSessionId = "host-session-123";
    let createdRoomId = "";

    // Test 1: Idempotent Create
    const hostWs1 = new WebSocket(HOST);
    await new Promise((resolve) => hostWs1.on("open", resolve));

    hostWs1.send(JSON.stringify({ type: "create", sessionId: hostSessionId }));

    await new Promise<void>((resolve) => {
        hostWs1.on("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "created") {
                createdRoomId = msg.roomId;
                console.log("✅ Test 1a: Room Created ->", createdRoomId);
                resolve();
            }
        });
    });

    // Test 2: Idempotency (same session id should return same room id)
    const hostWs2 = new WebSocket(HOST);
    await new Promise((resolve) => hostWs2.on("open", resolve));
    hostWs2.send(JSON.stringify({ type: "create", sessionId: hostSessionId }));

    await new Promise<void>((resolve) => {
        hostWs2.on("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "created" && msg.roomId === createdRoomId) {
                console.log("✅ Test 2: Idempotent Create Returned Same Room ->", msg.roomId);
                resolve();
            } else {
                console.error("❌ Test 2 Failed: Did not return same room ID.");
            }
        });
    });

    // Test 3: Join Invalid Room
    const friendWs1 = new WebSocket(HOST);
    await new Promise((resolve) => friendWs1.on("open", resolve));
    friendWs1.send(JSON.stringify({ type: "join", roomId: "fake-room", sessionId: "friend-123" }));

    await new Promise<void>((resolve) => {
        friendWs1.on("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "error" && msg.code === "ROOM_NOT_FOUND") {
                console.log("✅ Test 3: Invalid Room rejected correctly.");
                resolve();
            }
        });
    });

    // Test 4: Stale Connection Isolation
    // Host joins created room natively with hostWs1
    hostWs1.send(JSON.stringify({ type: "join", roomId: createdRoomId, sessionId: hostSessionId }));

    await new Promise<void>((resolve) => {
        hostWs1.once("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "joined" && msg.isHost === true) {
                console.log("✅ Test 4a: Host formally joined the room topolgy.");
                resolve();
            }
        });
    });

    const friendWs2 = new WebSocket(HOST);
    await new Promise((resolve) => friendWs2.on("open", resolve));
    friendWs2.send(JSON.stringify({ type: "join", roomId: createdRoomId, sessionId: "friend-123" }));

    await new Promise<void>((resolve) => {
        friendWs2.once("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "joined" && msg.isHost === false) {
                console.log("✅ Test 4b: Friend formally joined the room topolgy.");
                resolve();
            }
        });
    });

    // Simulate Stale Network Disconnect for Friend (friendWs2 drops, friendWs3 rapidly reconnects)
    const friendWs3 = new WebSocket(HOST); // Fast reconnect
    await new Promise((resolve) => friendWs3.on("open", resolve));
    friendWs3.send(JSON.stringify({ type: "join", roomId: createdRoomId, sessionId: "friend-123" }));

    await new Promise<void>((resolve) => {
        friendWs3.once("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "joined" && msg.isHost === false) {
                console.log("✅ Test 4c: Friend cleanly re-joined the room topolgy via fresh WS.");
                resolve();
            }
        });
    });

    console.log("⏳ Simulating stale connection close (Old socket dying out)...");
    friendWs2.close(); // Simulate the delayed TCP close of the stale socket

    // Wait 1 second to ensure the server processed the close hook
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("⏳ Verifying Friend's new connection is still alive by sending a message...");
    friendWs3.send(JSON.stringify({ type: "offer", roomId: createdRoomId, sessionId: "friend-123", sdp: "dummy" }));

    await new Promise<void>((resolve) => {
        hostWs1.once("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "offer" && msg.sdp === "dummy") {
                console.log("✅ Test 4d: Stale socket close DID NOT disrupt the new connection. Forwarding intact!");
                resolve();
            }
        });
    });

    console.log("=== All Tests Passed ===");
    process.exit(0);
}

runTests().catch(console.error);
