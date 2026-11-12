import {
  ChatMessage,
  ChatMessageStatus,
  ParticipantPresence,
  RoomMember,
} from '@/core/types/room.types';

export interface ChatBroadcastPayload {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  type: 'chat' | 'system';
  createdAt: string;
}

/**
 * Error thrown when persisting a chat message to PostgreSQL fails.
 */
export class ChatPersistenceError extends Error {
  readonly retryable: boolean;
  readonly code?: string;

  constructor(message: string, retryable = true, code?: string) {
    super(message);
    this.name = 'ChatPersistenceError';
    this.retryable = retryable;
    this.code = code;
  }
}

/**
 * Generates an RFC 4122 v4 UUID suitable for both Broadcast deduplication and
 * PostgreSQL `chat_messages.id` primary-key insertion.
 */
export function generateChatMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last-resort valid UUIDv4 fallback for restricted test runtimes
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Determines whether a Supabase/PostgREST chat persistence error is transient
 * and safe to automatically retry.
 */
export function isRetryableChatError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return true;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();

  // RLS denial, check constraint, foreign key violation, invalid UUID, or rate limit
  if (
    code === '42501' ||
    code === '23514' ||
    code === '23503' ||
    code === '22P02' ||
    msg.includes('row-level security') ||
    msg.includes('rate limit') ||
    msg.includes('violates check constraint')
  ) {
    return false;
  }

  return true;
}

/**
 * Updates a participant username cache in-place from current room members and presence.
 */
export function syncParticipantNameCache(
  cache: Map<string, string>,
  params: {
    self?: { id: string; username: string };
    members?: RoomMember[];
    presenceList?: ParticipantPresence[];
  }
): void {
  if (params.members) {
    for (const member of params.members) {
      if (member.userId && member.username) {
        cache.set(member.userId, member.username);
      }
    }
  }

  if (params.presenceList) {
    for (const participant of params.presenceList) {
      if (participant.userId && participant.username) {
        cache.set(participant.userId, participant.username);
      }
    }
  }

  if (params.self?.id && params.self.username) {
    cache.set(params.self.id, params.self.username);
  }
}

/**
 * Resolves a sender display name from the in-memory participant cache without hitting the database.
 */
export function resolveCachedSenderName(
  cache: Map<string, string>,
  userId: string,
  fallbackUsername?: string
): string {
  const cached = cache.get(userId);
  if (cached) return cached;

  if (fallbackUsername && fallbackUsername !== 'Viewer' && fallbackUsername !== 'Guest') {
    cache.set(userId, fallbackUsername);
    return fallbackUsername;
  }

  return fallbackUsername || 'Viewer';
}

/**
 * Validates an incoming `CHAT_MESSAGE` Realtime Broadcast payload.
 */
export function isValidChatBroadcastPayload(
  payload: unknown,
  expectedRoomId: string
): payload is ChatBroadcastPayload {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 128) {
    return false;
  }
  if (candidate.roomId !== expectedRoomId) {
    return false;
  }
  if (typeof candidate.userId !== 'string' || candidate.userId.length === 0) {
    return false;
  }
  if (typeof candidate.content !== 'string' || candidate.content.length === 0 || candidate.content.length > 1000) {
    return false;
  }
  if (candidate.type !== 'chat' && candidate.type !== 'system') {
    return false;
  }
  if (typeof candidate.createdAt !== 'string' || candidate.createdAt.length === 0) {
    return false;
  }

  return true;
}

/**
 * Deduplicates and merges an incoming or confirmed message into the chat timeline.
 * Returns the original array reference when no state change is needed.
 */
export function upsertChatMessage(
  prev: ChatMessage[],
  incoming: ChatMessage
): ChatMessage[] {
  const existingIndex = prev.findIndex((m) => m.id === incoming.id);
  if (existingIndex === -1) {
    return [...prev, incoming];
  }

  const existing = prev[existingIndex];
  const nextStatus: ChatMessageStatus | undefined =
    incoming.status ?? existing.status;
  const nextUsername =
    existing.username && existing.username !== 'Viewer' && existing.username !== 'Guest'
      ? existing.username
      : incoming.username;

  if (
    existing.status === nextStatus &&
    existing.username === nextUsername &&
    existing.errorMessage === incoming.errorMessage
  ) {
    return prev;
  }

  const next = prev.slice();
  next[existingIndex] = {
    ...existing,
    ...incoming,
    username: nextUsername,
    createdAt: existing.createdAt || incoming.createdAt,
    status: nextStatus,
  };
  return next;
}

/**
 * Merges fetched PostgreSQL chat history with any messages already received or
 * optimistically queued in memory during initial load.
 */
export function mergeChatHistory(
  history: ChatMessage[],
  currentMessages: ChatMessage[]
): ChatMessage[] {
  if (currentMessages.length === 0) {
    return history;
  }

  const merged = history.slice();
  const seenIds = new Set(history.map((m) => m.id));

  for (const msg of currentMessages) {
    if (msg.id === 'welcome-msg') continue;
    if (!seenIds.has(msg.id)) {
      seenIds.add(msg.id);
      merged.push(msg);
    }
  }

  return merged;
}
