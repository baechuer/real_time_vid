import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });


console.log("WebSocket signaling server running on ws://localhost:8080");

wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", (data) => {
        console.log("Received:", data.toString());
        ws.send("echo: " + data.toString());
    });

    ws.on("close", () => {
        console.log("Client disconnected");
    });
});