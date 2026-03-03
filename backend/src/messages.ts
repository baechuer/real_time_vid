import { z } from "zod";

// Error definitions
export const ErrorCodes = {
    ROOM_FULL: "ROOM_FULL",
    ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
    ROOM_EXPIRED: "ROOM_EXPIRED",
    BAD_MESSAGE: "BAD_MESSAGE",
    NOT_JOINED: "NOT_JOINED",
    PEER_NOT_READY: "PEER_NOT_READY",
    PEER_DISCONNECTED: "PEER_DISCONNECTED"
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

// Base definition for every message EXCEPT "create"
export const BaseMessageSchema = z.object({
    type: z.enum(["join", "offer", "answer", "ice-candidate", "hangup"]),
    roomId: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(64),
});

export const CreateMessageSchema = z.object({
    type: z.literal("create"),
    sessionId: z.string().min(1).max(64),
});

export const JoinMessageSchema = BaseMessageSchema.extend({
    type: z.literal("join"),
});

export const OfferMessageSchema = BaseMessageSchema.extend({
    type: z.literal("offer"),
    sdp: z.string(), // The SDP string
});

export const AnswerMessageSchema = BaseMessageSchema.extend({
    type: z.literal("answer"),
    sdp: z.string(), // The SDP string
});

export const IceCandidateMessageSchema = BaseMessageSchema.extend({
    type: z.literal("ice-candidate"),
    candidate: z.object({
        candidate: z.string(),
        sdpMid: z.string().nullable(),
        sdpMLineIndex: z.number().nullable(),
        usernameFragment: z.string().optional()
    }).nullable() // It can be null for end-of-candidates
});

// Client intentionally hanging up
export const HangupMessageSchema = BaseMessageSchema.extend({
    type: z.literal("hangup"),
});

// A parsed, valid message type
export const AnyMessageSchema = z.discriminatedUnion("type", [
    CreateMessageSchema,
    JoinMessageSchema,
    OfferMessageSchema,
    AnswerMessageSchema,
    IceCandidateMessageSchema,
    HangupMessageSchema,
]);

export type AnyMessage = z.infer<typeof AnyMessageSchema>;

// Helper for sending error responses from server to client
export function createErrorMessage(code: ErrorCode, message: string) {
    return JSON.stringify({
        type: "error",
        code,
        message
    });
}

