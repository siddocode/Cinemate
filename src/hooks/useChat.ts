'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ChatMessage } from '@/core/types/room.types';
import { UserIdentity } from '@/core/types/session.types';
import { roomService } from '@/lib/services/roomService';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { RealtimeChannel } from '@supabase/supabase-js';

interface UseChatProps {
  roomId: string;
  user: UserIdentity;
  channel: RealtimeChannel | null;
}

export function useChat({ roomId, user, channel }: UseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
                content: 'Welcome to your Duo watch party! Chat in real-time as you watch together.',
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

  // 2. Realtime Subscription for incoming messages & typing
  useEffect(() => {
    if (!roomId || !isSupabaseConfigured()) return;

    const supabase = getSupabaseBrowserClient();
    const chatChannelName = `room_chat:${roomId}`;
    const chatChannel = supabase.channel(chatChannelName);

    // Postgres Changes subscription for persistent messages
    chatChannel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const newRow = payload.new as {
            id: string;
            room_id: string;
            user_id: string;
            content: string;
            type: 'chat' | 'system';
            created_at: string;
          };

          // If the message is from another user, fetch username or profile
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
            // Avoid duplicate if optimistically added
            if (prev.some((m) => m.id === incomingMsg.id)) {
              return prev;
            }
            return [...prev, incomingMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chatChannel);
    };
  }, [roomId, user.id, user.username]);

  // 3. Typing indicator broadcast listener via shared channel
  useEffect(() => {
    if (!channel) return;

    channel.on(
      'broadcast',
      { event: 'CHAT_TYPING' },
      (payload: { payload: { userId: string; username: string; isTyping: boolean } }) => {
        if (payload.payload.userId !== user.id) {
          if (payload.payload.isTyping) {
            setPartnerTyping(payload.payload.username);
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
  }, [channel, user.id]);

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
          // Replace optimistic ID with server ID
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? saved : m))
          );
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

  // 6. Broadcast typing state
  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (!channel) return;
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

