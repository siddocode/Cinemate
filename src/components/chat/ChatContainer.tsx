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
  Smile,
  ArrowDown,
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
import { cn } from '@/lib/utils/cn';

const QUICK_EMOJIS = ['❤️', '🍿', '😂', '😮', '🔥', '👏', '👀'];

function getAvatarStyle(name: string) {
  const styles = [
    { bg: 'bg-[#1F4E3D]', text: 'text-[#7AD3A8]' },
    { bg: 'bg-[#43236C]', text: 'text-[#C4B5FD]' },
    { bg: 'bg-[#3E2E18]', text: 'text-[#FCD34D]' },
    { bg: 'bg-[#193B4D]', text: 'text-[#67E8F9]' },
    { bg: 'bg-[#4D1D2C]', text: 'text-[#FDA4AF]' },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % styles.length;
  return styles[idx];
}

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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadCountBelow, setUnreadCountBelow] = useState(0);
  const [prevCount, setPrevCount] = useState(messages.length);

  // Store information from previous renders in state (React 19 pattern)
  if (messages.length !== prevCount) {
    setPrevCount(messages.length);
    if (isScrolledUp) {
      setUnreadCountBelow((prev) => prev + (messages.length - prevCount));
    }
  }

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const prevMessagesCountRef = useRef(messages.length);
  const isScrolledUpRef = useRef(false);
  const hasInitializedScrollRef = useRef(false);

  const playNotificationTone = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
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

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const userScrolledUp = distanceFromBottom > 60;
    setIsScrolledUp(userScrolledUp);
    isScrolledUpRef.current = userScrolledUp;
    if (!userScrolledUp) {
      setUnreadCountBelow(0);
    }
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
      setIsScrolledUp(false);
      isScrolledUpRef.current = false;
      setUnreadCountBelow(0);
    }
  }, []);

  // Intelligent auto-scroll: Scroll automatically ONLY on initial load or when sending own message,
  // or when receiving a new message while already at bottom.
  // Prevent unprompted jumps when the user is reading older messages.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const isNewMessage = messages.length > prevMessagesCountRef.current;
    const isInitialLoad = !hasInitializedScrollRef.current && messages.length > 0;

    if (isInitialLoad) {
      hasInitializedScrollRef.current = true;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'auto',
      });
    } else if (isNewMessage) {
      const lastMsg = messages[messages.length - 1];
      const isMyMessage = lastMsg && lastMsg.userId === user.id;

      if (!isScrolledUpRef.current || isMyMessage) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'smooth',
        });
      }

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
    setShowEmojiPicker(false);
    await sendMessage(content, 'chat');
    scrollToBottom(true);
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
    <aside className="w-full h-full min-h-0 flex-1 border-t lg:border-t-0 lg:border-l border-[#E8DDC5]/14 bg-[#0B1E17] flex flex-col overflow-hidden relative">
      {/* Desktop Chat Header Bar (hidden on mobile where tabs control switching) */}
      <div className="hidden lg:flex h-9 sm:h-10 border-b border-[#E8DDC5]/12 bg-[#0E281F] px-3 sm:px-4 items-center justify-between shrink-0">
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

      {/* Independently Scrollable Messages Area with Floating Scroll-Down Pill */}
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 p-3 sm:p-4 overflow-y-auto overscroll-contain touch-pan-y space-y-3"
        >
          {isLoading && messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs font-mono text-[#CDBF9F]/85">
              Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-6 select-none pointer-events-none">
              <MessageSquare className="w-6 h-6 text-[#9670FF]/40 mb-1.5" />
              <p className="text-xs text-[#CDBF9F]/75 font-medium">No messages yet</p>
              <p className="text-[11px] text-[#CDBF9F]/45 mt-0.5">Start chatting while watching together</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.userId === user.id;
              const isSystem = msg.type === 'system';
              const nextMsg = messages[index + 1];
              const isLastOfMyRun =
                isMe && (!nextMsg || nextMsg.userId !== user.id || nextMsg.type === 'system');

              if (isSystem) {
                return (
                  <div key={msg.id} className="text-center my-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px] bg-[#0E281F] border border-[#E8DDC5]/12 text-[#CDBF9F] px-3 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF]" />
                      {msg.content}
                    </span>
                  </div>
                );
              }

              const initial = (msg.username || 'U').charAt(0).toUpperCase();
              const avatarStyle = getAvatarStyle(msg.username || 'user');

              return (
                <React.Fragment key={msg.id}>
                  {/* Desktop Message Bubble (Original clean style matching desktop design) */}
                  <div
                    className={cn(
                      'hidden lg:flex flex-col',
                      isMe ? 'items-end' : 'items-start'
                    )}
                  >
                    <div className="max-w-[85%] space-y-1">
                      <div
                        className={cn(
                          'flex items-center gap-1.5 text-xs px-1',
                          isMe ? 'justify-end text-[#CDBF9F]' : 'text-[#CDBF9F]/85'
                        )}
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
                        className={cn(
                          'text-sm px-3.5 py-2 rounded-2xl break-words leading-relaxed transition-opacity',
                          msg.status === 'failed'
                            ? 'bg-[#3B181A] border border-[#F87171]/55 text-[#FDECEC] rounded-tr-xs'
                            : isMe
                            ? 'bg-[#194234] border border-[#7AD3A8]/30 text-[#F7F4EC] rounded-tr-xs'
                            : 'bg-[#122A21] border border-[#E8DDC5]/14 text-[#F7F4EC] rounded-tl-xs',
                          msg.status === 'sending' && 'opacity-80'
                        )}
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
                            <span
                              className="inline-flex items-center gap-1 text-[#7AD3A8]"
                              title={msg.seenBy?.length ? `Seen by ${msg.seenBy.join(', ')}` : 'Seen'}
                            >
                              <CheckCheck className="w-3.5 h-3.5 text-[#7AD3A8]" />
                              <span>Seen</span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Retry on delivery failure */}
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

                  {/* Mobile Message Bubble (With Avatar Initial Badge) */}
                  <div className="lg:hidden flex items-start gap-2.5">
                    {/* Avatar circle with username initial */}
                    <div
                      className={cn(
                        'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold uppercase shrink-0 mt-0.5 shadow-sm',
                        avatarStyle.bg,
                        avatarStyle.text
                      )}
                    >
                      {initial}
                    </div>

                    {/* Message body + sender info */}
                    <div className="flex-1 min-w-0 max-w-[85%] space-y-1">
                      <div className="flex items-center gap-1.5 text-xs px-0.5">
                        <span className="font-semibold text-[#F7F4EC]">
                          {isMe ? `${msg.username} (You)` : msg.username}
                        </span>
                        <span className="text-[#E8DDC5]/40">·</span>
                        <span className="font-mono text-[11px] text-[#CDBF9F]/70">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={cn(
                          'text-sm px-3.5 py-2 rounded-2xl break-words leading-relaxed transition-opacity inline-block max-w-full',
                          msg.status === 'failed'
                            ? 'bg-[#3B181A] border border-[#F87171]/55 text-[#FDECEC]'
                            : isMe
                            ? 'bg-[#15382B] border border-[#7AD3A8]/25 text-[#F7F4EC]'
                            : 'bg-[#132A21] border border-[#E8DDC5]/12 text-[#F7F4EC]',
                          msg.status === 'sending' && 'opacity-80'
                        )}
                      >
                        {msg.content}
                      </div>

                      {/* Delivery & Read Receipts Status for sender */}
                      {isMe && isLastOfMyRun && (
                        <div className="flex items-center gap-1 text-[11px] font-mono select-none px-0.5">
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
                            <span
                              className="inline-flex items-center gap-1 text-[#7AD3A8]"
                              title={msg.seenBy?.length ? `Seen by ${msg.seenBy.join(', ')}` : 'Seen'}
                            >
                              <CheckCheck className="w-3.5 h-3.5 text-[#7AD3A8]" />
                              <span>Seen</span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Retry on delivery failure */}
                      {isMe && msg.status === 'failed' && (
                        <div className="flex items-center gap-2 px-1 text-xs text-[#FCA5A5]">
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
                </React.Fragment>
              );
            })
          )}

          {/* Typing Indicator */}
          {partnerTyping && (
            <div className="flex items-center text-[12px] text-[#CDBF9F] py-0.5">
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

        {/* Floating "New Messages ↓" Pill Button when user is scrolled up reading older messages */}
        {isScrolledUp && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-2 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#173D30] border border-[#9670FF]/60 text-[#F7F4EC] shadow-[0_6px_20px_rgba(0,0,0,0.55)] text-xs font-semibold cursor-pointer hover:bg-[#1E4D3C] active:scale-95 transition-all animate-cinemaFadeUp"
            aria-label="Scroll to latest messages"
          >
            <ArrowDown className="w-3.5 h-3.5 text-[#9670FF]" />
            <span>
              {unreadCountBelow > 0
                ? `${unreadCountBelow} new ${unreadCountBelow === 1 ? 'message' : 'messages'} ↓`
                : 'Latest messages'}
            </span>
          </button>
        )}
      </div>

      {/* Desktop Quick Emoji Reaction Strip (Permanently Visible) */}
      <div className="hidden lg:flex px-2.5 sm:px-3 py-1 sm:py-1.5 border-t border-[#E8DDC5]/10 bg-[#0E281F]/80 items-center justify-between gap-1 shrink-0">
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

      {/* Mobile Quick Emoji Reaction Strip (Toggled via Smiley Button) */}
      {showEmojiPicker && (
        <div className="lg:hidden px-3 py-1.5 border-t border-[#E8DDC5]/10 bg-[#0E281F]/95 flex items-center justify-between gap-1 shrink-0 animate-cinemaFadeUp">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 justify-around">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={pendingReaction !== null}
                onClick={() => handleQuickReaction(emoji)}
                className={cn(
                  'text-base p-1.5 rounded-xl hover:bg-[#173D30] transition-transform hover:scale-110 cursor-pointer disabled:opacity-50 min-w-[34px] min-h-[34px] flex items-center justify-center',
                  pendingReaction === emoji && 'scale-110 animate-pulse'
                )}
                aria-label={`Send reaction ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(false)}
            className="p-1 text-[#CDBF9F] hover:text-[#F7F4EC] cursor-pointer shrink-0"
            aria-label="Close emojis"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Desktop Chat Message Input Form (Original design matching desktop screenshot) */}
      <form
        onSubmit={handleSend}
        className="hidden lg:flex p-2.5 sm:p-3 border-t border-[#E8DDC5]/12 items-center gap-2 shrink-0 bg-[#0E281F]"
      >
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={`Message ${partnerName || 'room'}...`}
            className="w-full bg-[#173D30]/80 border border-[#E8DDC5]/18 rounded-xl px-3.5 py-2 text-sm text-[#F7F4EC] placeholder-[#CDBF9F]/65 focus:outline-none focus:border-[#9670FF] focus:ring-1 focus:ring-[#9670FF]/40 transition-colors"
          />
        </div>

        <Button
          type="submit"
          size="sm"
          variant="primary"
          className="h-[34px] px-3.5 shrink-0"
          disabled={!input.trim()}
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </form>

      {/* Mobile Chat Message Input Form — Pinned Above Keyboard with Safe-Area Bottom Padding */}
      <form
        onSubmit={handleSend}
        className="lg:hidden p-2 border-t border-[#E8DDC5]/12 flex items-center gap-2 shrink-0 bg-[#0E281F] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        {/* Pill Input Container */}
        <div className="relative flex-1 min-w-0 bg-[#132A21] border border-[#E8DDC5]/16 focus-within:border-[#9670FF]/60 rounded-full flex items-center px-2.5 py-1 transition-colors">
          {/* Smiley Emoji Trigger Button */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            className="p-1 rounded-full text-[#CDBF9F] hover:text-[#F7F4EC] transition-colors cursor-pointer shrink-0"
            title="Choose reaction emoji"
            aria-label="Quick reactions"
          >
            <Smile className="w-4 h-4 text-[#9670FF]" />
          </button>

          {/* Text input — 16px font-size prevents mobile browser auto-zoom */}
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={partnerName ? `Message ${partnerName}...` : 'Message...'}
            className="w-full bg-transparent px-2 py-1 text-base sm:text-sm text-[#F7F4EC] placeholder-[#CDBF9F]/60 focus:outline-none"
            autoComplete="off"
            autoCorrect="off"
          />

          {/* Quick Emoji Bar shortcut */}
          <button
            type="button"
            onClick={() => void handleQuickReaction('🍿')}
            className="p-1 rounded-full text-sm hover:scale-110 transition-transform cursor-pointer shrink-0 hidden xs:flex items-center justify-center"
            title="React with popcorn"
            aria-label="React with popcorn"
          >
            🍿
          </button>
        </div>

        {/* Circular Purple Send Button matching screenshot */}
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-10 h-10 rounded-full bg-[#7235A8] hover:bg-[#8342be] disabled:opacity-45 disabled:pointer-events-none text-white flex items-center justify-center shadow-[0_2px_10px_rgba(114,53,168,0.35)] active:scale-95 transition-all cursor-pointer shrink-0"
          aria-label="Send message"
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      </form>
    </aside>
  );
};
