'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  InitialChatHistory,
  ParticipantPresence,
  RoomMember,
} from '@/core/types/room.types';
import { UserIdentity } from '@/core/types/session.types';
import { roomService } from '@/lib/services/roomService';
import {
  getAuthenticatedAccessToken,
  getSupabaseBrowserClient,
} from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  RealtimeChatMessageRow,
  RealtimeChatSeenPayload,
  RealtimeTypingPayload,
  subscribeToRoomChatBroadcasts,
  subscribeToRoomChatInserts,
  subscribeToRoomChatSeen,
  subscribeToRoomTyping,
} from '@/lib/supabase/roomRealtimeBus';
import {
  ChatBroadcastPayload,
  ChatPersistenceError,
  generateChatMessageId,
  isValidChatBroadcastPayload,
  mergeChatHistory,
  resolveCachedSenderName,
  syncParticipantNameCache,
  upsertChatMessage,
} from '@/lib/utils/chat';
import { RealtimeChannel } from '@supabase/supabase-js';

interface UseChatProps {
  roomId: string;
  user: UserIdentity;
  channel?: RealtimeChannel | null;
  members?: RoomMember[];
  presenceList?: ParticipantPresence[];
  initialHistory?: InitialChatHistory;
}

interface PendingMessageEntry {
  content: string;
  type: 'chat' | 'system';
  createdAt: string;
  broadcastSent: boolean;
}

const PERSIST_RETRY_DELAYS_MS = [400, 1200];

export function useChat({
  roomId,
  user,
  channel,
  members,
  presenceList,
  initialHistory,
}: UseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [welcomeTimestamp] = useState<string>(() => new Date().toISOString());

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const participantNamesRef = useRef<Map<string, string>>(new Map());
  const inFlightProfileLookupsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const standaloneChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingMessagesRef = useRef<Map<string, PendingMessageEntry>>(new Map());
  const retryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const activeRoomIdRef = useRef<string>(roomId);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    const timers = retryTimersRef.current;
    return () => {
      isMountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Reset per-room caches and pending retries when switching rooms
  useEffect(() => {
    activeRoomIdRef.current = roomId;
    participantNamesRef.current.clear();
    inFlightProfileLookupsRef.current.clear();
    pendingMessagesRef.current.clear();
    retryTimersRef.current.forEach((timer) => clearTimeout(timer));
    retryTimersRef.current.clear();
  }, [roomId]);

  // Keep in-memory participant name cache synchronized with room members, presence, and self
  useEffect(() => {
    syncParticipantNameCache(participantNamesRef.current, {
      self: user.id ? { id: user.id, username: user.username } : undefined,
      members,
      presenceList,
    });

    // Backfill any message rendered with a generic fallback name once participant data arrives
    setMessages((prev) => {
      let changed = false;
      const updated = prev.map((msg) => {
        if (msg.type === 'system') return msg;
        if (msg.username !== 'Viewer' && msg.username !== 'Guest') return msg;
        const cached = participantNamesRef.current.get(msg.userId);
        if (cached && cached !== msg.username) {
          changed = true;
          return { ...msg, username: cached };
        }
        return msg;
      });
      return changed ? updated : prev;
    });
  }, [user.id, user.username, members, presenceList]);

  // Single-flight fallback profile lookup ONLY when a sender is missing from cache
  const lookupAndCacheProfile = useCallback(
    (targetUserId: string) => {
      if (!targetUserId || !isSupabaseConfigured()) return;
      if (participantNamesRef.current.has(targetUserId)) return;
      if (inFlightProfileLookupsRef.current.has(targetUserId)) return;

      const supabase = getSupabaseBrowserClient();
      const targetRoomId = roomId;

      const lookupPromise = (async () => {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', targetUserId)
            .maybeSingle();

          const resolved = profile?.username?.trim() || null;
          if (resolved && isMountedRef.current && activeRoomIdRef.current === targetRoomId) {
            participantNamesRef.current.set(targetUserId, resolved);
            setMessages((prev) =>
              prev.map((m) =>
                m.userId === targetUserId && (m.username === 'Viewer' || m.username === 'Guest')
                  ? { ...m, username: resolved }
                  : m
              )
            );
          }
          return resolved;
        } catch {
          return null;
        } finally {
          inFlightProfileLookupsRef.current.delete(targetUserId);
        }
      })();

      inFlightProfileLookupsRef.current.set(targetUserId, lookupPromise);
    },
    [roomId]
  );

  const usesPrefetchedHistory = Boolean(
    initialHistory && initialHistory.roomId === roomId
  );
  const prefetchedLoaded = Boolean(initialHistory?.loaded);
  const prefetchedMessages = initialHistory?.messages;

  // Sync participant name cache from prefetched history when available
  useEffect(() => {
    if (!usesPrefetchedHistory || !prefetchedLoaded || !prefetchedMessages) return;
    prefetchedMessages.forEach((msg) => {
      if (msg.userId && msg.username && msg.username !== 'Guest' && msg.username !== 'Viewer') {
        participantNamesRef.current.set(msg.userId, msg.username);
      }
    });
  }, [usesPrefetchedHistory, prefetchedLoaded, prefetchedMessages]);

  // Timestamp this viewer joined the room. Conversations that happened before
  // this point are hidden so late joiners only see chat from when they arrived.
  const selfJoinedAtMs = useMemo(() => {
    const joinedAt = members?.find((member) => member.userId === user.id)?.joinedAt;
    if (!joinedAt) return null;
    const timestamp = new Date(joinedAt).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }, [members, user.id]);

  // 1. Load initial chat messages only when useRoom did not already prefetch them
  useEffect(() => {
    if (!roomId || usesPrefetchedHistory) return;

    let isMounted = true;
    async function loadMessages() {
      setIsLoading(true);
      try {
        const history = await roomService.getChatMessages(
          roomId,
          selfJoinedAtMs !== null ? new Date(selfJoinedAtMs).toISOString() : undefined
        );
        if (isMounted) {
          history.forEach((msg) => {
            if (msg.userId && msg.username && msg.username !== 'Guest' && msg.username !== 'Viewer') {
              participantNamesRef.current.set(msg.userId, msg.username);
            }
          });

          if (history.length > 0) {
            setMessages((prev) => mergeChatHistory(history, prev));
          } else {
            // Initial friendly welcome message (preserve any messages already received while loading)
            const welcome: ChatMessage = {
              id: 'welcome-msg',
              roomId,
              userId: 'system',
              username: 'Syncora',
              content: 'Welcome to your watch party! Chat in real-time as you watch together.',
              type: 'system',
              createdAt: welcomeTimestamp,
            };
            setMessages((prev) => (prev.length > 0 ? prev : [welcome]));
          }
        }
      } catch (err) {
        console.warn('[Syncora] Failed to load chat history:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadMessages();

    return () => {
      isMounted = false;
    };
  }, [roomId, usesPrefetchedHistory, welcomeTimestamp, selfJoinedAtMs]);

  const resolvedMessages = useMemo(() => {
    if (!usesPrefetchedHistory || !prefetchedLoaded || !prefetchedMessages) {
      return messages;
    }

    if (prefetchedMessages.length > 0) {
      return mergeChatHistory(prefetchedMessages, messages);
    }

    if (messages.length > 0) {
      return messages;
    }

    return [
      {
        id: 'welcome-msg',
        roomId,
        userId: 'system',
        username: 'Syncora',
        content: 'Welcome to your watch party! Chat in real-time as you watch together.',
        type: 'system' as const,
        createdAt: welcomeTimestamp,
      },
    ];
  }, [
    usesPrefetchedHistory,
    prefetchedLoaded,
    prefetchedMessages,
    messages,
    roomId,
    welcomeTimestamp,
  ]);

  const effectiveIsLoading = usesPrefetchedHistory
    ? !initialHistory?.loaded && Boolean(initialHistory?.isLoading)
    : isLoading;

  // Hide anything said before this viewer joined (system notices are always kept).
  const visibleMessages = useMemo(() => {
    if (selfJoinedAtMs === null) return resolvedMessages;
    return resolvedMessages.filter(
      (msg) =>
        msg.type === 'system' || new Date(msg.createdAt).getTime() >= selfJoinedAtMs
    );
  }, [resolvedMessages, selfJoinedAtMs]);

  // 2. Realtime Subscription for incoming Broadcasts (instant) and Postgres Changes (durable)
  // Reuses events dispatched by the unified room channel when channel prop is managed by useRoom
  useEffect(() => {
    if (!roomId || !isSupabaseConfigured()) return;

    const supabase = getSupabaseBrowserClient();

    const handleIncomingBroadcast = (payload: ChatBroadcastPayload) => {
      if (!isValidChatBroadcastPayload(payload, roomId)) return;

      const senderName = resolveCachedSenderName(
        participantNamesRef.current,
        payload.userId,
        payload.userId === user.id ? user.username : payload.username
      );

      const incomingMsg: ChatMessage = {
        id: payload.id,
        roomId: payload.roomId,
        userId: payload.userId,
        username: senderName,
        content: payload.content,
        type: payload.type,
        createdAt: payload.createdAt,
        status: 'sent',
      };

      setMessages((prev) => upsertChatMessage(prev, incomingMsg));

      // Broadcast seen receipt to let sender know their message was received
      if (payload.userId !== user.id && channel) {
        void channel.send({
          type: 'broadcast',
          event: 'CHAT_SEEN',
          payload: {
            roomId,
            userId: user.id,
            username: user.username,
            lastSeenMessageId: payload.id,
            seenAt: new Date().toISOString(),
          },
        }).catch(() => {});
      }
    };

    const handleIncomingRow = (newRow: RealtimeChatMessageRow) => {
      const hasCachedName =
        newRow.user_id === user.id || participantNamesRef.current.has(newRow.user_id);

      const senderName =
        newRow.user_id === user.id
          ? user.username
          : resolveCachedSenderName(participantNamesRef.current, newRow.user_id);

      const incomingMsg: ChatMessage = {
        id: newRow.id,
        roomId: newRow.room_id,
        userId: newRow.user_id,
        username: senderName,
        content: newRow.content,
        type: newRow.type,
        createdAt: newRow.created_at,
        status: 'sent',
      };

      setMessages((prev) => upsertChatMessage(prev, incomingMsg));

      // Broadcast seen receipt for incoming row if from another user
      if (newRow.user_id !== user.id && channel) {
        void channel.send({
          type: 'broadcast',
          event: 'CHAT_SEEN',
          payload: {
            roomId,
            userId: user.id,
            username: user.username,
            lastSeenMessageId: newRow.id,
            seenAt: new Date().toISOString(),
          },
        }).catch(() => {});
      }

      // Only hit profiles table if sender is genuinely absent from member/presence cache
      if (!hasCachedName) {
        lookupAndCacheProfile(newRow.user_id);
      }
    };

    const handleIncomingSeen = (seenPayload: RealtimeChatSeenPayload) => {
      if (seenPayload.userId === user.id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (
            m.userId === user.id &&
            (m.id === seenPayload.lastSeenMessageId ||
              new Date(m.createdAt).getTime() <= new Date(seenPayload.seenAt).getTime())
          ) {
            const currentSeenBy = m.seenBy || [];
            const nextSeenBy = currentSeenBy.includes(seenPayload.username)
              ? currentSeenBy
              : [...currentSeenBy, seenPayload.username];
            return {
              ...m,
              status: 'seen',
              seenBy: nextSeenBy,
            };
          }
          return m;
        })
      );
    };

    // Unified room channel mode (channel prop passed by RoomView/ChatContainer, even while null during initial connect)
    if (channel !== undefined) {
      const unsubBroadcast = subscribeToRoomChatBroadcasts(roomId, handleIncomingBroadcast);
      const unsubInserts = subscribeToRoomChatInserts(roomId, handleIncomingRow);
      const unsubSeen = subscribeToRoomChatSeen(roomId, handleIncomingSeen);
      return () => {
        unsubBroadcast();
        unsubInserts();
        unsubSeen();
      };
    }

    // Standalone fallback mode if no shared channel prop is supplied (private, members-only topic)
    const standaloneChannel = supabase.channel(`room_chat:${roomId}`, {
      config: { private: true },
    });
    standaloneChannelRef.current = standaloneChannel;
    let isDisposed = false;
    standaloneChannel
      .on('broadcast', { event: 'CHAT_MESSAGE' }, (msg: { payload?: unknown }) => {
        if (isValidChatBroadcastPayload(msg?.payload, roomId)) {
          handleIncomingBroadcast(msg.payload);
        }
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          handleIncomingRow(payload.new as RealtimeChatMessageRow);
        }
      );

    void (async () => {
      try {
        const token = await getAuthenticatedAccessToken(supabase);
        await supabase.realtime.setAuth(token ?? null);
      } catch (authErr) {
        console.warn('[Syncora] Failed to refresh Realtime auth token:', authErr);
      }
      if (!isDisposed) standaloneChannel.subscribe();
    })();

    return () => {
      isDisposed = true;
      if (standaloneChannelRef.current === standaloneChannel) {
        standaloneChannelRef.current = null;
      }
      supabase.removeChannel(standaloneChannel);
    };
  }, [roomId, user.id, user.username, channel, lookupAndCacheProfile]);

  // 3. Typing indicator broadcast listener via shared channel
  useEffect(() => {
    if (!roomId || !channel) return;

    const unsubscribe = subscribeToRoomTyping(
      roomId,
      channel,
      (payload: RealtimeTypingPayload) => {
        if (payload.userId !== user.id) {
          if (payload.isTyping) {
            setPartnerTyping(payload.username);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
              setPartnerTyping(null);
            }, 3000);
          } else {
            setPartnerTyping(null);
          }
        }
      }
    );

    return () => {
      unsubscribe();
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [roomId, channel, user.id]);

  // Helper: persist message to PostgreSQL independently with bounded transient retries
  const persistMessageWithRetry = useCallback(
    async (
      messageId: string,
      content: string,
      type: 'chat' | 'system',
      createdAt: string
    ): Promise<void> => {
      const targetRoomId = roomId;

      const runAttempt = async (attempt: number): Promise<void> => {
        try {
          const saved = await roomService.sendChatMessage({
            id: messageId,
            roomId: targetRoomId,
            userId: user.id,
            username: user.username,
            content,
            type,
            createdAt,
          });

          if (!isMountedRef.current || activeRoomIdRef.current !== targetRoomId) return;

          pendingMessagesRef.current.delete(messageId);
          if (saved) {
            // Guarantee minimum display time for "Sending..." (at least 500ms)
            // so it never flickers or vanishes abruptly in 20ms
            const elapsed = Date.now() - new Date(createdAt).getTime();
            const minHold = 500;
            if (elapsed < minHold) {
              await new Promise((resolve) => setTimeout(resolve, minHold - elapsed));
            }
            if (!isMountedRef.current || activeRoomIdRef.current !== targetRoomId) return;

            setMessages((prev) =>
              upsertChatMessage(prev, {
                ...saved,
                status: prev.find((m) => m.id === messageId)?.status === 'seen' ? 'seen' : 'sent',
                errorMessage: undefined,
              })
            );
          }
        } catch (err: unknown) {
          if (!isMountedRef.current || activeRoomIdRef.current !== targetRoomId) return;

          const retryable = err instanceof ChatPersistenceError ? err.retryable : true;
          if (retryable && attempt < PERSIST_RETRY_DELAYS_MS.length) {
            const delayMs = PERSIST_RETRY_DELAYS_MS[attempt];
            const timer = setTimeout(() => {
              retryTimersRef.current.delete(timer);
              if (!isMountedRef.current || activeRoomIdRef.current !== targetRoomId) return;
              void runAttempt(attempt + 1);
            }, delayMs);
            retryTimersRef.current.add(timer);
            return;
          }

          const errorMessage =
            err instanceof Error ? err.message : 'Could not save message.';
          console.warn('[Syncora] Chat persistence failed:', errorMessage);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, status: 'failed', errorMessage }
                : m
            )
          );
        }
      };

      await runAttempt(0);
    },
    [roomId, user.id, user.username]
  );

  const broadcastChatMessage = useCallback(
    (payload: ChatBroadcastPayload): boolean => {
      const activeChannel = channel ?? standaloneChannelRef.current;
      if (!activeChannel) return false;
      try {
        void activeChannel
          .send({
            type: 'broadcast',
            event: 'CHAT_MESSAGE',
            payload,
          })
          .catch((err) => {
            console.warn('[Syncora] Chat broadcast error:', err);
          });
        return true;
      } catch (err) {
        console.warn('[Syncora] Chat broadcast error:', err);
        return false;
      }
    },
    [channel]
  );

  // 4. Instant Send: optimistic render + immediate Realtime Broadcast + independent DB persistence
  const sendMessage = useCallback(
    async (content: string, type: 'chat' | 'system' = 'chat') => {
      const trimmed = content.trim();
      if (!trimmed || !roomId) return;

      const messageId = generateChatMessageId();
      const createdAt = new Date().toISOString();

      const optimisticMessage: ChatMessage = {
        id: messageId,
        roomId,
        userId: user.id,
        username: user.username,
        content: trimmed,
        type,
        createdAt,
        status: 'sending',
      };

      // 1. Optimistic local UI update
      setMessages((prev) => upsertChatMessage(prev, optimisticMessage));

      // 2. Immediate Realtime Broadcast over the authorized room channel
      const broadcastSent = broadcastChatMessage({
        id: messageId,
        roomId,
        userId: user.id,
        username: user.username,
        content: trimmed,
        type,
        createdAt,
      });

      pendingMessagesRef.current.set(messageId, {
        content: trimmed,
        type,
        createdAt,
        broadcastSent,
      });

      // 3. Independent PostgreSQL persistence (with automatic retries on transient failures)
      await persistMessageWithRetry(messageId, trimmed, type, createdAt);
    },
    [roomId, user.id, user.username, broadcastChatMessage, persistMessageWithRetry]
  );

  // 4b. Manual retry for messages that failed persistence
  const retryMessage = useCallback(
    async (messageId: string) => {
      const pending = pendingMessagesRef.current.get(messageId);
      if (!pending || !roomId) return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, status: 'sending', errorMessage: undefined }
            : m
        )
      );

      if (!pending.broadcastSent) {
        pending.broadcastSent = broadcastChatMessage({
          id: messageId,
          roomId,
          userId: user.id,
          username: user.username,
          content: pending.content,
          type: pending.type,
          createdAt: pending.createdAt,
        });
      }

      await persistMessageWithRetry(
        messageId,
        pending.content,
        pending.type,
        pending.createdAt
      );
    },
    [roomId, user.id, user.username, broadcastChatMessage, persistMessageWithRetry]
  );

  // 4c. Dismiss a failed unsent message from the local list
  const dismissFailedMessage = useCallback((messageId: string) => {
    pendingMessagesRef.current.delete(messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  // 5. Quick Reaction shortcut
  const sendReaction = useCallback(
    async (emoji: string) => {
      await sendMessage(emoji, 'chat');
    },
    [sendMessage]
  );

  // 6. Broadcast typing state (throttled to save Realtime message quota)
  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (!channel) return;
      const now = Date.now();

      // Throttle typing 'true' events to once every 2.5 seconds; allow 'false' immediately
      if (isTyping && now - lastTypingSentRef.current < 2500) {
        return;
      }
      lastTypingSentRef.current = now;

      try {
        channel.send({
          type: 'broadcast',
          event: 'CHAT_TYPING',
          payload: {
            userId: user.id,
            username: user.username,
            isTyping,
          },
        });
      } catch (err) {
        console.warn('[Syncora] Typing broadcast error:', err);
      }
    },
    [channel, user.id, user.username]
  );

  return {
    messages: visibleMessages,
    sendMessage,
    retryMessage,
    dismissFailedMessage,
    sendReaction,
    partnerTyping,
    setTyping,
    isLoading: effectiveIsLoading,
  };
}
