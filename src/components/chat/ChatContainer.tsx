'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  Bell,
  BellOff,
  PanelRightClose,
  ChevronDown,
  RotateCcw,
  AlertCircle,
  X,
  Check,
  CheckCheck,
} from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { UserIdentity } from '@/core/types/session.types';
import {
  InitialChatHistory,
  ParticipantPresence,
  RoomMember,
} from '@/core/types/room.types';
import { Button } from '@/components/ui/Button';
import { RealtimeChannel } from '@supabase/supabase-js';

const QUICK_EMOJIS = ['❤️', '🍿', '😂', '😮', '🔥', '👏', '👀'];

interface ChatContainerProps {
  roomId: string;
  user: UserIdentity;
  partnerName?: string;
  channel: RealtimeChannel | null;
  members?: RoomMember[];
  presenceList?: ParticipantPresence[];
  initialHistory?: InitialChatHistory;
  onCollapse?: () => void;
  voiceSection?: React.ReactNode;
  isChatOpen?: boolean;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  roomId,
  user,
  partnerName,
  channel,
  members,
  presenceList,
  initialHistory,
  onCollapse,
  voiceSection,
  isChatOpen = true,
}) => {
  const {
    messages,
    sendMessage,
    retryMessage,
    dismissFailedMessage,
    sendReaction,
    partnerTyping,
    setTyping,
    isLoading,
  } = useChat({
    roomId,
    user,
    channel,
    members,
    presenceList,
    initialHistory,
    isChatOpen,
  });

  const [input, setInput] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
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

  // Auto-scroll ONLY the chat message list container (never the video player or window)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }

    // Subtle audio chime on partner message if enabled
    if (messages.length > prevMessagesCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.userId !== user.id && lastMsg.type === 'chat' && soundEnabled) {
        playNotificationTone();
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages, partnerTyping, user.id, soundEnabled, playNotificationTone]);

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
    if (pendingReaction !== null) return;
    setPendingReaction(emoji);
    try {
      await sendReaction(emoji);
    } finally {
      setPendingReaction(null);
    }
  };

  return (
    <aside className="w-full lg:w-[350px] xl:w-[380px] lg:flex-none flex-1 min-h-0 border-t lg:border-t-0 lg:border-l border-[#E8DDC5]/14 bg-[#0B1E17] flex flex-col overflow-hidden">
      {/* Chat Header Bar (visible on both mobile and desktop) */}
      <div className="flex h-9 sm:h-10 border-b border-[#E8DDC5]/12 bg-[#0E281F] px-3 sm:px-4 items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-3.5 h-3.5 text-[#9670FF] shrink-0" />
          <span className="text-xs font-mono uppercase tracking-[0.16em] text-[#E8DDC5] truncate">
            Chat
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#7AD3A8] shrink-0" />
          {partnerName && (
            <span className="text-xs text-[#CDBF9F]/70 truncate hidden sm:inline">
              · {partnerName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            className="text-[#CDBF9F] hover:text-[#F7F4EC] p-1.5 rounded-lg hover:bg-[#E8DDC5]/8 transition-colors cursor-pointer"
            title={soundEnabled ? 'Mute message chime' : 'Enable message chime'}
            aria-label={soundEnabled ? 'Mute message chime' : 'Enable message chime'}
          >
            {soundEnabled ? (
              <Bell className="w-3.5 h-3.5 text-[#E8DDC5]" />
            ) : (
              <BellOff className="w-3.5 h-3.5 text-[#CDBF9F]/45" />
            )}
          </button>

          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="text-[#CDBF9F] hover:text-[#F7F4EC] p-1.5 rounded-lg hover:bg-[#E8DDC5]/8 transition-colors cursor-pointer"
              title="Minimize chat to expand video"
              aria-label="Minimize chat panel"
            >
              <PanelRightClose className="w-4 h-4 hidden lg:block" />
              <ChevronDown className="w-4 h-4 lg:hidden" />
            </button>
          )}
        </div>
      </div>

      {/* Desktop Docked Voice Lounge Strip */}
      {voiceSection}

      {/* Independently Scrollable Messages Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 p-3 sm:p-4 overflow-y-auto overscroll-contain touch-pan-y space-y-2.5 sm:space-y-3"
      >
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs font-mono text-[#CDBF9F]/85">
            Loading conversation...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-6 select-none pointer-events-none">
            <MessageSquare className="w-5 h-5 text-[#9670FF]/40 mb-1.5" />
            <p className="text-xs text-[#CDBF9F]/65 font-medium">No messages yet</p>
            <p className="text-[11px] text-[#CDBF9F]/45 mt-0.5">Start chatting while watching together</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.userId === user.id;
            const isSystem = msg.type === 'system';
            const nextMsg = messages[index + 1];
            const isLastOfMyRun = isMe && (!nextMsg || nextMsg.userId !== user.id || nextMsg.type === 'system');

            if (isSystem) {
              return (
                <div key={msg.id} className="text-center my-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[13px] bg-[#0E281F] border border-[#E8DDC5]/12 text-[#CDBF9F] px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF]" />
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
                <div className="max-w-[88%] sm:max-w-[85%] space-y-1">
                  <div
                    className={`flex items-center gap-1.5 text-xs px-1 ${
                      isMe ? 'justify-end text-[#CDBF9F]' : 'text-[#CDBF9F]/85'
                    }`}
                  >
                    <span className="font-medium text-[#E8DDC5]">
                      {isMe ? 'You' : msg.username}
                    </span>
                    <span className="text-[#E8DDC5]/40">·</span>
                    <span className="font-mono text-[11px] text-[#CDBF9F]/85">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className={`text-sm px-3.5 py-2.5 sm:py-2 rounded-2xl break-words leading-relaxed transition-opacity ${
                      msg.status === 'failed'
                        ? 'bg-[#3B181A] border border-[#F87171]/55 text-[#FDECEC] rounded-tr-xs'
                        : isMe
                        ? 'bg-[#194234] border border-[#7AD3A8]/30 text-[#F7F4EC] rounded-tr-xs'
                        : 'bg-[#122A21] border border-[#E8DDC5]/14 text-[#F7F4EC] rounded-tl-xs'
                    } ${msg.status === 'sending' ? 'opacity-80' : ''}`}
                  >
                    {msg.content}
                  </div>

                  {/* Delivery & Read Receipts Status for sender */}
                  {isMe && isLastOfMyRun && (
                    <div className="flex items-center justify-end px-1 gap-1 text-[11px] font-mono select-none">
                      {msg.status === 'sending' && (
                        <span className="inline-flex items-center gap-1 text-[#CDBF9F]/65" title="Sent">
                          <Check className="w-3 h-3 text-[#CDBF9F]/65" />
                        </span>
                      )}
                      {msg.status === 'sent' && (
                        <span className="inline-flex items-center gap-1 text-[#CDBF9F]/90" title="Delivered">
                          <Check className="w-3 h-3 text-[#CDBF9F]/90" />
                        </span>
                      )}
                      {msg.status === 'seen' && (
                        <span className="inline-flex items-center gap-1 text-[#7AD3A8]" title={msg.seenBy?.length ? `Seen by ${msg.seenBy.join(', ')}` : 'Seen'}>
                          <CheckCheck className="w-3.5 h-3.5 text-[#7AD3A8]" />
                          <span>Seen</span>
                        </span>
                      )}
                    </div>
                  )}

                  {isMe && msg.status === 'failed' && (
                    <div className="flex items-center justify-end gap-2 px-1 text-xs text-[#FCA5A5]">
                      <span className="inline-flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Failed to save</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void retryMessage(msg.id)}
                        className="inline-flex items-center gap-1 text-[#E8DDC5] hover:text-[#F7F4EC] underline underline-offset-2 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissFailedMessage(msg.id)}
                        className="text-[#CDBF9F]/85 hover:text-[#F7F4EC] cursor-pointer"
                        aria-label="Dismiss failed message"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Typing Indicator */}
        {partnerTyping && (
          <div className="flex items-center text-[13px] text-[#CDBF9F] py-0.5">
            <span className="inline-flex gap-2 items-center bg-[#0E281F] border border-[#E8DDC5]/14 px-2.5 py-1 rounded-full">
              <span>{partnerTyping || partnerName || 'Someone'} is typing</span>
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF] animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF] animate-pulse delay-100" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF] animate-pulse delay-200" />
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Quick Emoji Reaction Strip */}
      <div className="px-2.5 sm:px-3 py-1 sm:py-1.5 border-t border-[#E8DDC5]/10 bg-[#0E281F]/80 flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 justify-between">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={pendingReaction !== null}
              onClick={() => handleQuickReaction(emoji)}
              className={`text-sm sm:text-base p-1 sm:p-1.5 rounded-lg sm:rounded-xl hover:bg-[#173D30] transition-transform hover:scale-110 cursor-pointer disabled:opacity-50 disabled:pointer-events-none min-w-[30px] min-h-[30px] sm:min-w-[34px] sm:min-h-[34px] flex items-center justify-center ${
                pendingReaction === emoji ? 'scale-110 animate-pulse' : ''
              }`}
              aria-label={`Send reaction ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Message Input Form */}
      <form
        onSubmit={handleSend}
        className="p-2 sm:p-2.5 border-t border-[#E8DDC5]/12 flex items-center gap-2 shrink-0 bg-[#0E281F] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={`Message ${partnerName || 'room'}...`}
            className="w-full bg-[#173D30]/80 border border-[#E8DDC5]/18 rounded-xl px-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#F7F4EC] placeholder-[#CDBF9F]/65 focus:outline-none focus:border-[#9670FF] focus:ring-1 focus:ring-[#9670FF]/40 transition-colors"
          />
        </div>

        <Button
          type="submit"
          size="sm"
          variant="primary"
          className="h-[40px] sm:h-[34px] px-3.5 shrink-0"
          disabled={!input.trim()}
          aria-label="Send message"
        >
          <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        </Button>
      </form>
    </aside>
  );
};
