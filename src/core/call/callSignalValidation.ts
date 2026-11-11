import { CALL_CONSTANTS } from '@/lib/constants/sync.constants';
import {
  CallIceCandidateData,
  CallSignalEventType,
  CallSignalPayload,
} from '@/core/types/call.types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_EVENTS = new Set<CallSignalEventType>([
  'offer',
  'answer',
  'ice',
  'bye',
  'media-state',
]);

export interface SignalValidationContext {
  roomId: string;
  selfUserId: string;
  expectedPeerUserId: string;
  expectedPeerSessionId?: string;
}

export type SignalValidationResult =
  | { valid: true; payload: CallSignalPayload }
  | { valid: false; reason: string };

function getUtf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function validateAudioOnlySdp(sdp: string): string | null {
  if (sdp.length === 0) {
    return 'Empty SDP payload.';
  }

  if (getUtf8ByteLength(sdp) > CALL_CONSTANTS.MAX_SDP_BYTES) {
    return 'SDP payload exceeds maximum allowed size.';
  }

  // Must resemble valid WebRTC DTLS-SRTP SDP
  if (!/^v=0\r?\n/m.test(sdp)) {
    return 'Malformed SDP missing version header.';
  }

  if (!/(?:^|\r?\n)m=audio\s+\d+\s+/m.test(sdp)) {
    return 'Voice-only SDP must contain an m=audio media section.';
  }

  // Strictly block non-audio media lines (video, application/datachannel, etc.)
  if (/(?:^|\r?\n)m=(?!audio\b)/m.test(sdp)) {
    return 'Non-audio media sections are forbidden in voice-only calls.';
  }

  if (!/(?:^|\r?\n)a=ice-ufrag:/m.test(sdp) || !/(?:^|\r?\n)a=fingerprint:/m.test(sdp)) {
    return 'SDP missing required ICE/DTLS security attributes.';
  }

  return null;
}

function validateIceCandidate(raw: unknown): { ok: true; value: CallIceCandidateData } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'ICE candidate must be an object.' };
  }

  const obj = raw as Record<string, unknown>;
  if (typeof obj.candidate !== 'string') {
    return { ok: false, reason: 'ICE candidate field must be a string.' };
  }

  if (getUtf8ByteLength(obj.candidate) > CALL_CONSTANTS.MAX_ICE_BYTES) {
    return { ok: false, reason: 'ICE candidate exceeds maximum allowed size.' };
  }

  // Empty string is valid WebRTC end-of-candidates signal; otherwise must start with "candidate:"
  if (obj.candidate.length > 0 && !obj.candidate.startsWith('candidate:')) {
    return { ok: false, reason: 'Malformed ICE candidate prefix.' };
  }

  const sdpMid = obj.sdpMid === undefined ? null : obj.sdpMid;
  if (sdpMid !== null && (typeof sdpMid !== 'string' || sdpMid.length > 32)) {
    return { ok: false, reason: 'Invalid ICE sdpMid.' };
  }

  const sdpMLineIndex = obj.sdpMLineIndex === undefined ? null : obj.sdpMLineIndex;
  if (
    sdpMLineIndex !== null &&
    (typeof sdpMLineIndex !== 'number' ||
      !Number.isInteger(sdpMLineIndex) ||
      sdpMLineIndex < 0 ||
      sdpMLineIndex > 4)
  ) {
    return { ok: false, reason: 'Invalid ICE sdpMLineIndex for audio-only call.' };
  }

  const usernameFragment =
    typeof obj.usernameFragment === 'string' && obj.usernameFragment.length <= 64
      ? obj.usernameFragment
      : obj.usernameFragment === null
      ? null
      : undefined;

  return {
    ok: true,
    value: {
      candidate: obj.candidate,
      sdpMid,
      sdpMLineIndex,
      ...(usernameFragment !== undefined ? { usernameFragment } : {}),
    },
  };
}

/**
 * Validates and sanitizes an incoming WebRTC signaling envelope before it can touch
 * RTCPeerConnection or UI state.
 */
export function validateCallSignalEnvelope(
  raw: unknown,
  ctx: SignalValidationContext
): SignalValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'Signal payload must be an object.' };
  }

  let serializedSize = 0;
  try {
    serializedSize = getUtf8ByteLength(JSON.stringify(raw));
  } catch {
    return { valid: false, reason: 'Unserializable signal payload.' };
  }

  if (serializedSize > CALL_CONSTANTS.MAX_SIGNAL_EVENT_BYTES) {
    return { valid: false, reason: 'Signal payload exceeds maximum byte limit.' };
  }

  const msg = raw as Record<string, unknown>;

  if (msg.version !== 1) {
    return { valid: false, reason: 'Unsupported signal protocol version.' };
  }

  if (msg.roomId !== ctx.roomId) {
    return { valid: false, reason: 'Signal roomId mismatch.' };
  }

  if (msg.targetUserId !== ctx.selfUserId) {
    return { valid: false, reason: 'Signal not targeted at local user.' };
  }

  if (typeof msg.callSessionId !== 'string' || !UUID_REGEX.test(msg.callSessionId)) {
    return { valid: false, reason: 'Invalid peer callSessionId.' };
  }

  if (
    ctx.expectedPeerSessionId &&
    msg.callSessionId !== ctx.expectedPeerSessionId
  ) {
    return { valid: false, reason: 'Stale callSessionId ignored.' };
  }

  if (typeof msg.sentAt !== 'number' || !Number.isFinite(msg.sentAt) || msg.sentAt <= 0) {
    return { valid: false, reason: 'Invalid sentAt timestamp.' };
  }

  if (typeof msg.event !== 'string' || !ALLOWED_EVENTS.has(msg.event as CallSignalEventType)) {
    return { valid: false, reason: 'Disallowed signaling event type.' };
  }

  const event = msg.event as CallSignalEventType;
  const base = {
    version: 1 as const,
    roomId: ctx.roomId,
    targetUserId: ctx.selfUserId,
    callSessionId: msg.callSessionId,
    sentAt: msg.sentAt,
  };

  if (event === 'offer' || event === 'answer') {
    const rawSdp = msg.sdp;
    if (!rawSdp || typeof rawSdp !== 'object' || Array.isArray(rawSdp)) {
      return { valid: false, reason: 'Missing SDP descriptor object.' };
    }
    const sdpObj = rawSdp as Record<string, unknown>;
    if (sdpObj.type !== event || typeof sdpObj.sdp !== 'string') {
      return { valid: false, reason: 'SDP type must match signaling event.' };
    }
    const sdpErr = validateAudioOnlySdp(sdpObj.sdp);
    if (sdpErr) {
      return { valid: false, reason: sdpErr };
    }
    if (event === 'offer') {
      return {
        valid: true,
        payload: { ...base, event: 'offer', sdp: { type: 'offer', sdp: sdpObj.sdp } },
      };
    }
    return {
      valid: true,
      payload: { ...base, event: 'answer', sdp: { type: 'answer', sdp: sdpObj.sdp } },
    };
  }

  if (event === 'ice') {
    const iceRes = validateIceCandidate(msg.candidate);
    if (!iceRes.ok) {
      return { valid: false, reason: iceRes.reason };
    }
    return {
      valid: true,
      payload: { ...base, event: 'ice', candidate: iceRes.value },
    };
  }

  if (event === 'media-state') {
    const rawMedia = msg.mediaState;
    if (!rawMedia || typeof rawMedia !== 'object' || Array.isArray(rawMedia)) {
      return { valid: false, reason: 'Missing mediaState object.' };
    }
    const mediaObj = rawMedia as Record<string, unknown>;
    if (typeof mediaObj.isMuted !== 'boolean') {
      return { valid: false, reason: 'mediaState.isMuted must be boolean.' };
    }
    return {
      valid: true,
      payload: {
        ...base,
        event: 'media-state',
        mediaState: { isMuted: mediaObj.isMuted },
      },
    };
  }

  const reason =
    typeof msg.reason === 'string' ? msg.reason.slice(0, 64) : undefined;
  return {
    valid: true,
    payload: { ...base, event: 'bye', ...(reason ? { reason } : {}) },
  };
}

/**
 * Bounded per-peer sliding-window rate limiter for inbound WebRTC signaling events.
 */
export class SignalRateLimiter {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(
    maxEvents: number = CALL_CONSTANTS.MAX_SIGNALS_PER_SECOND,
    windowMs: number = 1000
  ) {
    this.maxEvents = maxEvents;
    this.windowMs = windowMs;
  }

  public allow(now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxEvents) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  public reset(): void {
    this.timestamps = [];
  }
}

