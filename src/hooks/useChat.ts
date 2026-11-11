'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ChatMessage } from '@/core/types/room.types';
import { UserIdentity } from '@/core/types/session.types';
import { roomService } from '@/lib/services/roomService';
import {
  getAuthenticatedAccessToken,
  getSupabaseBrowserClient,
} from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  RealtimeChatMessageRow,
  RealtimeTypingPayload,
  subscribeToRoomChatInserts,
  subscribeToRoomTyping,
} from '@/lib/supabase/roomRealtimeBus';
import { RealtimeChannel } from '@supabase/supabase-js';

interface UseChatProps {
  roomId: string;
  user: UserIdentity;
  channel?: RealtimeChannel | null;
}

export function useChat({ roomId, user, channel }: UseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  // 1. Load initial chat messages
  useEffect(() => {
    if (!roomId) return;

    let isMounted = true;
    async function loadMessages() {
      setIsLoading(true);
      try {
        const history = await roomService.getChatMessages(roomId);
        if (isMounted) {
          if (history.length > 0) {
            setMessages(history);
          } else {
            // Initial friendly welcome message
            setMessages([
              {
                id: 'welcome-msg',
                roomId,
                userId: 'system',
                username: 'Syncora',
                content: 'Welcome to your watch party! Chat in real-time as you watch together.',
                type: 'system',
                createdAt: new Date().toISOString(),
              },
            ]);
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
  }, [roomId]);

  // 2. Realtime Subscription for incoming messages
  // Reuses events dispatched by the unified room channel when channel prop is managed by useRoom
  useEffect(() => {
    if (!roomId || !isSupabaseConfigured()) return;

    const supabase = getSupabaseBrowserClient();

    const handleIncomingRow = async (newRow: RealtimeChatMessageRow) => {
      let senderName = user.id === newRow.user_id ? user.username : 'Partner';

      if (user.id !== newRow.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', newRow.user_id)
          .maybeSingle();

        if (profile?.username) {
          senderName = profile.username;
        }
      }

      const incomingMsg: ChatMessage = {
        id: newRow.id,
        roomId: newRow.room_id,
        userId: newRow.user_id,
        username: senderName,
        content: newRow.content,
        type: newRow.type,
        createdAt: newRow.created_at,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === incomingMsg.id)) {
          return prev;
        }
        // Replace matching optimistic temp message if realtime arrives before insert response
        const tempIndex = prev.findIndex(
          (m) =>
            m.id.startsWith('temp-') &&
            m.userId === incomingMsg.userId &&
            m.content === incomingMsg.content
        );
        if (tempIndex !== -1) {
          return prev.map((m, idx) => (idx === tempIndex ? incomingMsg : m));
        }
        return [...prev, incomingMsg];
      });
    };

    // Unified room channel mode (channel prop passed by RoomView/ChatContainer, even while null during initial connect)
    if (channel !== undefined) {
      return subscribeToRoomChatInserts(roomId, handleIncomingRow);
    }

    // Standalone fallback mode if no shared channel prop is supplied (private, members-only topic)
    const standaloneChannel = supabase.channel(`room_chat:${roomId}`, {
      config: { private: true },
    });
    let isDisposed = false;
    standaloneChannel.on(
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
      supabase.removeChannel(standaloneChannel);
    };
  }, [roomId, user.id, user.username, channel]);

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

  // 4. Send Message function with optimistic local update
  const sendMessage = useCallback(
    async (content: string, type: 'chat' | 'system' = 'chat') => {
      const trimmed = content.trim();
      if (!trimmed || !roomId) return;

      const tempId = `temp-${Date.now()}`;
      const optimisticMessage: ChatMessage = {
        id: tempId,
        roomId,
        userId: user.id,
        username: user.username,
        content: trimmed,
        type,
        createdAt: new Date().toISOString(),
      };

      // Optimistically append
      setMessages((prev) => [...prev, optimisticMessage]);

      try {
        const saved = await roomService.sendChatMessage({
          roomId,
          userId: user.id,
          username: user.username,
          content: trimmed,
          type,
        });

        if (saved) {
          // Replace optimistic ID with server ID, removing duplicate if realtime arrived first
          setMessages((prev) => {
            const alreadyPresent = prev.some((m) => m.id === saved.id);
            if (alreadyPresent) {
              return prev.filter((m) => m.id !== tempId);
            }
            return prev.map((m) => (m.id === tempId ? saved : m));
          });
        }
      } catch (err) {
        console.warn('[Syncora] Send message error:', err);
      }
    },
    [roomId, user.id, user.username]
  );

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
    messages,
    sendMessage,
    sendReaction,
    partnerTyping,
    setTyping,
    isLoading,
  };
}

