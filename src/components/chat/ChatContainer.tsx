'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  Sparkles,
  Bell,
  BellOff,
} from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { UserIdentity } from '@/core/types/session.types';
import { Button } from '@/components/ui/Button';
import { RealtimeChannel } from '@supabase/supabase-js';

const QUICK_EMOJIS = ['❤️', '🍿', '😂', '😮', '🔥', '👏', '👀'];

interface ChatContainerProps {
  roomId: string;
  user: UserIdentity;
  partnerName?: string;
  channel: RealtimeChannel | null;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  roomId,
  user,
  partnerName,
  channel,
}) => {
  const {
    messages,
    sendMessage,
    sendReaction,
    partnerTyping,
    setTyping,
    isLoading,
  } = useChat({
    roomId,
    user,
    channel,
  });

  const [input, setInput] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const prevMessagesCountRef = useRef(messages.length);

  const playNotificationTone = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
          osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08); // A5
          gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.25);
        }
      }
    } catch {
      // Audio autoplay policy catch
    }
  }, []);

  // Auto-scroll on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    // Subtle audio chime on partner message if enabled
    if (messages.length > prevMessagesCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.userId !== user.id && lastMsg.type === 'chat' && soundEnabled) {
        playNotificationTone();
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages, user.id, soundEnabled, playNotificationTone]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setTyping(val.length > 0);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const content = input;
    setInput('');
    setTyping(false);
    await sendMessage(content, 'chat');
  };

  const handleQuickReaction = async (emoji: string) => {
    await sendReaction(emoji);
  };

  return (
    <div className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-neutral-800/80 bg-neutral-950/70 flex flex-col h-64 lg:h-full shrink-0">
      {/* Chat Header Bar */}
      <div className="h-12 border-b border-neutral-800/80 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">
            Duo Live Chat
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
        </div>

        <button
          onClick={() => setSoundEnabled((prev) => !prev)}
          className="text-neutral-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          title={soundEnabled ? 'Mute message chime' : 'Enable message chime'}
        >
          {soundEnabled ? (
            <Bell className="w-3.5 h-3.5 text-indigo-400" />
          ) : (
            <BellOff className="w-3.5 h-3.5 text-neutral-600" />
          )}
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-neutral-500">
            Loading chat...
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.userId === user.id;
            const isSystem = msg.type === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} className="text-center my-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] bg-neutral-900 border border-neutral-800 text-neutral-400 px-3 py-1 rounded-full shadow-sm">
                    <Sparkles className="w-3 h-3 text-indigo-400" />
                    {msg.content}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={isMe ? 'flex flex-col items-end' : 'flex flex-col items-start'}
              >
                <div className="max-w-[85%] space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 px-1">
                    <span className="font-semibold text-neutral-300">
                      {isMe ? 'You' : msg.username}
                    </span>
                    <span>•</span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className={`text-xs px-3.5 py-2 rounded-2xl shadow-sm break-words leading-relaxed ${
                      isMe
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-tr-xs'
                        : 'bg-neutral-800 border border-neutral-700/60 text-neutral-100 rounded-tl-xs'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Partner Typing Indicator */}
        {partnerTyping && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 italic py-1 animate-pulse">
            <span className="inline-flex gap-1 items-center bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full">
              <span>{partnerTyping || partnerName || 'Partner'} is typing</span>
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" />
                <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce delay-100" />
                <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce delay-200" />
              </span>
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Emoji Reaction Pill Strip */}
      <div className="px-3 pt-2 pb-1 border-t border-neutral-800/80 bg-neutral-950 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleQuickReaction(emoji)}
              className="text-sm px-1.5 py-0.5 rounded-lg hover:bg-neutral-800 transition-transform hover:scale-125 cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Message Input Form */}
      <form
        onSubmit={handleSend}
        className="p-3 border-t border-neutral-800/60 flex items-center gap-2 shrink-0 bg-neutral-950"
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={`Message ${partnerName || 'partner'}...`}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <Button
          type="submit"
          size="sm"
          variant="primary"
          className="h-8 px-3 shrink-0"
          disabled={!input.trim()}
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </form>
    </div>
  );
};
