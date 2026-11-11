'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  Tv,
  MessageSquare,
  Send,
  Sparkles,
  Play,
  Volume2,
  Maximize,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useSession } from '@/hooks/useSession';

interface RoomSkeletonViewProps {
  roomCode: string;
  initialVideoId?: string;
}

export const RoomSkeletonView: React.FC<RoomSkeletonViewProps> = ({
  roomCode,
  initialVideoId,
}) => {
  const { user } = useSession();
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [dummyMessages, setDummyMessages] = useState<
    Array<{ id: string; user: string; text: string; time: string; isSystem?: boolean }>
  >([
    {
      id: '1',
      user: 'Syncora',
      text: `Room ${roomCode} created. Share the link with your watch partner!`,
      time: 'Just now',
      isSystem: true,
    },
    {
      id: '2',
      user: user.username,
      text: 'Hey! Ready for our watch party 🍿',
      time: 'Just now',
    },
  ]);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    setDummyMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        user: user.username,
        text: chatInput.trim(),
        time: 'Just now',
      },
    ]);
    setChatInput('');
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] bg-[#090a0f] overflow-hidden">
      {/* Room Sub-Header / Partner Bar */}
      <div className="h-14 border-b border-neutral-800/80 px-4 sm:px-6 flex items-center justify-between bg-neutral-950/60 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Room:</span>
            <span className="text-xs font-mono font-bold bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-lg text-indigo-400">
              {roomCode}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="h-8 text-xs"
            leftIcon={copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          >
            {copied ? 'Link Copied!' : 'Copy Partner Invite'}
          </Button>
        </div>

        {/* Duo Status Indicator */}
        <div className="flex items-center gap-3">
          <Badge variant="purple" dot className="hidden sm:inline-flex text-xs">
            Host: {user.username} (You)
          </Badge>
          <Badge variant="warning" dot className="text-xs">
            Waiting for Partner...
          </Badge>
        </div>
      </div>

      {/* Main Watch Area: Side-by-Side Theater Mode on Desktop, Stacked on Mobile */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Column: Video Theater Player (Takes 70% width on Desktop) */}
        <div className="flex-1 flex flex-col bg-black/60 p-3 sm:p-4 lg:p-6 overflow-y-auto">
          <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col justify-center">
            {/* 16:9 Video Aspect Ratio Frame */}
            <div className="relative w-full aspect-video bg-neutral-950 rounded-2xl border border-neutral-800/80 overflow-hidden shadow-2xl flex flex-col items-center justify-center text-center p-6 group">
              {initialVideoId ? (
                <iframe
                  className="w-full h-full pointer-events-none"
                  src={`https://www.youtube-nocookie.com/embed/${initialVideoId}?autoplay=0&controls=0&rel=0`}
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              ) : (
                <div className="flex flex-col items-center max-w-md">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 animate-pulse">
                    <Tv className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    Video Player Ready for Synchronization
                  </h3>
                  <p className="text-xs text-neutral-400 mt-2">
                    Phase 4 will link the official YouTube IFrame Player API for host-authoritative
                    playback, sub-second sync, and automatic drift recovery.
                  </p>
                </div>
              )}

              {/* Player Bottom Control Overlay Skeleton */}
              <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-between px-4 opacity-90">
                <div className="flex items-center gap-3">
                  <button className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
                    <Play className="w-4 h-4 fill-white" />
                  </button>
                  <span className="text-xs font-mono text-neutral-300">00:00 / 00:00</span>
                </div>
                <div className="flex items-center gap-3 text-neutral-300">
                  <Volume2 className="w-4 h-4 hover:text-white cursor-pointer" />
                  <Maximize className="w-4 h-4 hover:text-white cursor-pointer" />
                </div>
              </div>
            </div>

            {/* Video Metadata / Controls strip */}
            <div className="mt-4 flex items-center justify-between text-xs text-neutral-400 px-1">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Side-by-side synchronized viewing mode
              </span>
              <span>Duo Watch Session</span>
            </div>
          </div>
        </div>

        {/* Right Column: Persistent Live Chat Panel (Takes 30% width on Desktop, fixed min-w-[340px]) */}
        <div className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-neutral-800/80 bg-neutral-950/70 flex flex-col h-64 lg:h-full shrink-0">
          {/* Chat Header */}
          <div className="h-12 border-b border-neutral-800/80 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Live Duo Chat
              </span>
            </div>
            <span className="text-[11px] text-neutral-500">Real-time</span>
          </div>

          {/* Chat Messages Scroll Container */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            {dummyMessages.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.isSystem
                    ? 'text-center my-2'
                    : msg.user === user.username
                    ? 'flex flex-col items-end'
                    : 'flex flex-col items-start'
                }
              >
                {msg.isSystem ? (
                  <span className="inline-block text-[11px] bg-neutral-900 border border-neutral-800 text-neutral-400 px-2.5 py-1 rounded-full">
                    {msg.text}
                  </span>
                ) : (
                  <div className="max-w-[85%] space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 px-1">
                      <span className="font-semibold text-neutral-300">{msg.user}</span>
                      <span>•</span>
                      <span>{msg.time}</span>
                    </div>
                    <div
                      className={`text-xs px-3 py-2 rounded-2xl ${
                        msg.user === user.username
                          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-tr-xs'
                          : 'bg-neutral-800 text-neutral-200 rounded-tl-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Chat Message Input Form */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-neutral-800/80 flex items-center gap-2 shrink-0 bg-neutral-950"
          >
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Chat with your partner..."
              className="text-xs py-2 h-9"
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              className="h-9 px-3 shrink-0"
              disabled={!chatInput.trim()}
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
