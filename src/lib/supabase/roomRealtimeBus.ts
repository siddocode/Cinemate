import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatBroadcastPayload } from '@/lib/utils/chat';

export interface RealtimeChatMessageRow {
  id: string;
  room_id: string;
  user_id: string;
  content: string;
  type: 'chat' | 'system';
  created_at: string;
}

export interface RealtimeTypingPayload {
  userId: string;
  username: string;
  isTyping: boolean;
}

export interface RealtimeChatSeenPayload {
  roomId: string;
  userId: string;
  username: string;
  lastSeenMessageId: string;
  seenAt: string;
}

export interface RealtimeCallSlotRow {
  room_id: string;
  user_id: string;
  call_session_id: string;
  joined_at: string;
  last_heartbeat_at: string;
}

export interface RealtimeCallSlotChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow?: RealtimeCallSlotRow;
  oldRow?: Partial<RealtimeCallSlotRow>;
}

export interface RealtimeQueueItemRow {
  id: string;
  room_id: string;
  video_id: string;
  video_url: string;
  video_type: 'youtube' | 'url' | 'upload';
  title: string;
  channel_title: string | null;
  thumbnail_url: string | null;
  duration_seconds: number;
  position: number;
  added_by: string;
  created_at: string;
}

export interface RealtimeQueueChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow?: RealtimeQueueItemRow;
  oldRow?: Partial<RealtimeQueueItemRow>;
}

type ChatMessageListener = (row: RealtimeChatMessageRow) => void;
type ChatBroadcastListener = (payload: ChatBroadcastPayload) => void;
type ChatSeenListener = (payload: RealtimeChatSeenPayload) => void;
type TypingListener = (payload: RealtimeTypingPayload) => void;
type CallSlotListener = (change: RealtimeCallSlotChange) => void;
type QueueListener = (change: RealtimeQueueChange) => void;

const chatMessageListeners = new Map<string, Set<ChatMessageListener>>();
const chatBroadcastListeners = new Map<string, Set<ChatBroadcastListener>>();
const chatSeenListeners = new Map<string, Set<ChatSeenListener>>();
const typingListeners = new Map<string, Set<TypingListener>>();
const callSlotListeners = new Map<string, Set<CallSlotListener>>();
const queueListeners = new Map<string, Set<QueueListener>>();
const attachedTypingChannels = new WeakSet<RealtimeChannel>();

/**
 * Registers a listener for instant `CHAT_MESSAGE` broadcasts received via the unified room channel.
 */
export function subscribeToRoomChatBroadcasts(
  roomId: string,
  listener: ChatBroadcastListener
): () => void {
  let set = chatBroadcastListeners.get(roomId);
  if (!set) {
    set = new Set();
    chatBroadcastListeners.set(roomId, set);
  }
  set.add(listener);

  return () => {
    const current = chatBroadcastListeners.get(roomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        chatBroadcastListeners.delete(roomId);
      }
    }
  };
}

/**
 * Dispatches a `CHAT_MESSAGE` broadcast payload from the unified room channel to listeners.
 */
export function emitRoomChatBroadcast(
  roomId: string,
  payload: ChatBroadcastPayload
): void {
  const listeners = chatBroadcastListeners.get(roomId);
  if (!listeners) return;
  listeners.forEach((listener) => listener(payload));
}

/**
 * Registers a listener for `CHAT_SEEN` read-receipt events received via the unified room channel.
 */
export function subscribeToRoomChatSeen(
  roomId: string,
  listener: ChatSeenListener
): () => void {
  let set = chatSeenListeners.get(roomId);
  if (!set) {
    set = new Set();
    chatSeenListeners.set(roomId, set);
  }
  set.add(listener);

  return () => {
    const current = chatSeenListeners.get(roomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        chatSeenListeners.delete(roomId);
      }
    }
  };
}

/**
 * Dispatches a `CHAT_SEEN` broadcast payload from the unified room channel to listeners.
 */
export function emitRoomChatSeen(
  roomId: string,
  payload: RealtimeChatSeenPayload
): void {
  const listeners = chatSeenListeners.get(roomId);
  if (!listeners) return;
  listeners.forEach((listener) => listener(payload));
}

/**
 * Registers a listener for `chat_messages` INSERT events received via the unified room channel.
 */
export function subscribeToRoomChatInserts(
  roomId: string,
  listener: ChatMessageListener
): () => void {
  let set = chatMessageListeners.get(roomId);
  if (!set) {
    set = new Set();
    chatMessageListeners.set(roomId, set);
  }
  set.add(listener);

  return () => {
    const current = chatMessageListeners.get(roomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        chatMessageListeners.delete(roomId);
      }
    }
  };
}

/**
 * Dispatches a `chat_messages` INSERT payload from the unified room channel to listeners.
 */
export function emitRoomChatInsert(roomId: string, row: RealtimeChatMessageRow): void {
  const listeners = chatMessageListeners.get(roomId);
  if (!listeners) return;
  listeners.forEach((listener) => listener(row));
}

/**
 * Registers a typing broadcast listener for a room, attaching the broadcast handler once per channel.
 */
export function subscribeToRoomTyping(
  roomId: string,
  channel: RealtimeChannel | null,
  listener: TypingListener
): () => void {
  let set = typingListeners.get(roomId);
  if (!set) {
    set = new Set();
    typingListeners.set(roomId, set);
  }
  set.add(listener);

  if (channel && !attachedTypingChannels.has(channel)) {
    attachedTypingChannels.add(channel);
    channel.on(
      'broadcast',
      { event: 'CHAT_TYPING' },
      (msg: { payload: RealtimeTypingPayload }) => {
        if (msg?.payload) {
          const current = typingListeners.get(roomId);
          current?.forEach((l) => l(msg.payload));
        }
      }
    );
  }

  return () => {
    const current = typingListeners.get(roomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        typingListeners.delete(roomId);
      }
    }
  };
}

/**
 * Registers a listener for `room_call_participants` postgres_changes received via the unified room channel.
 */
export function subscribeToRoomCallSlots(
  roomId: string,
  listener: CallSlotListener
): () => void {
  let set = callSlotListeners.get(roomId);
  if (!set) {
    set = new Set();
    callSlotListeners.set(roomId, set);
  }
  set.add(listener);

  return () => {
    const current = callSlotListeners.get(roomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        callSlotListeners.delete(roomId);
      }
    }
  };
}

/**
 * Dispatches a `room_call_participants` change payload from the unified room channel to listeners.
 */
export function emitRoomCallSlotChange(
  roomId: string,
  change: RealtimeCallSlotChange
): void {
  const listeners = callSlotListeners.get(roomId);
  if (!listeners) return;
  listeners.forEach((listener) => listener(change));
}


/**
 * Registers a listener for `room_queue_items` postgres_changes received via the unified room channel.
 */
export function subscribeToRoomQueueChanges(
  roomId: string,
  listener: QueueListener
): () => void {
  let set = queueListeners.get(roomId);
  if (!set) {
    set = new Set();
    queueListeners.set(roomId, set);
  }
  set.add(listener);

  return () => {
    const current = queueListeners.get(roomId);
    if (current) {
      current.delete(listener);
      if (current.size === 0) {
        queueListeners.delete(roomId);
      }
    }
  };
}

/**
 * Dispatches a `room_queue_items` change payload from the unified room channel to listeners.
 */
export function emitRoomQueueChange(roomId: string, change: RealtimeQueueChange): void {
  const listeners = queueListeners.get(roomId);
  if (!listeners) return;
  listeners.forEach((listener) => listener(change));
}
