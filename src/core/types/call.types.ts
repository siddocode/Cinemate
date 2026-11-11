/**
 * Core two-person voice calling types, signaling contracts, and error codes.
 */

export type CallStatus =
  | 'idle'
  | 'joining'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type CallConnectionMode = 'unknown' | 'p2p' | 'relayed' | 'stun-only';

export type CallErrorCode =
  | 'PERMISSION_DENIED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_IN_USE'
  | 'CALL_FULL'
  | 'NOT_ROOM_MEMBER'
  | 'SIGNALING_ERROR'
  | 'ICE_CONFIG_ERROR'
  | 'CONNECTION_FAILED'
  | 'UNSUPPORTED_BROWSER';

export interface CallError {
  code: CallErrorCode;
  message: string;
}

export interface CallParticipantSlot {
  roomId: string;
  userId: string;
  callSessionId: string;
  joinedAt: string;
  lastHeartbeatAt: string;
}

export interface CallParticipantState {
  userId: string;
  username: string;
  avatarUrl?: string;
  callSessionId?: string;
  isLocal: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  connectionMode: CallConnectionMode;
}

export type CallSignalEventType = 'offer' | 'answer' | 'ice' | 'bye' | 'media-state';

export interface CallSessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface CallIceCandidateData {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export interface CallMediaStateData {
  isMuted: boolean;
}

interface CallSignalBase {
  version: 1;
  roomId: string;
  targetUserId: string;
  callSessionId: string;
  sentAt: number;
}

export interface CallOfferSignal extends CallSignalBase {
  event: 'offer';
  sdp: CallSessionDescription;
}

export interface CallAnswerSignal extends CallSignalBase {
  event: 'answer';
  sdp: CallSessionDescription;
}

export interface CallIceSignal extends CallSignalBase {
  event: 'ice';
  candidate: CallIceCandidateData;
}

export interface CallByeSignal extends CallSignalBase {
  event: 'bye';
  reason?: string;
}

export interface CallMediaStateSignal extends CallSignalBase {
  event: 'media-state';
  mediaState: CallMediaStateData;
}

export type CallSignalPayload =
  | CallOfferSignal
  | CallAnswerSignal
  | CallIceSignal
  | CallByeSignal
  | CallMediaStateSignal;

export interface CallIceConfig {
  iceServers: RTCIceServer[];
  mode: 'turn' | 'stun-only';
  ttlSeconds: number;
  isProductionReady: boolean;
  issuedAt: string;
  warning?: string;
}

/**
 * Minimal channel transport interface matching Supabase RealtimeChannel methods
 * used by CallSignaling, allowing deterministic unit tests without live sockets.
 */
export interface ICallRealtimeChannel {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (message: { payload?: unknown }) => void
  ): ICallRealtimeChannel;
  send(args: {
    type: 'broadcast';
    event: string;
    payload: unknown;
  }): Promise<unknown>;
  subscribe(callback?: (status: string, err?: Error) => void): ICallRealtimeChannel;
}

