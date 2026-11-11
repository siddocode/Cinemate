'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users2,
  MessageSquare,
  Sparkles,
  Tv,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { generateRoomCode, normalizeRoomCode } from '@/lib/utils/code';
import { extractYouTubeId } from '@/lib/utils/youtube';

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');

  // Create room state
  const [roomTitle, setRoomTitle] = useState('Our Watch Party');
  const [videoInput, setVideoInput] = useState('');
  const [createError, setCreateError] = useState('');

  // Join room state
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');

    const code = generateRoomCode();
    let videoParam = '';

    if (videoInput.trim()) {
      const ytId = extractYouTubeId(videoInput.trim());
      if (ytId) {
        videoParam = `?v=${encodeURIComponent(ytId)}`;
      } else {
        setCreateError('Please enter a valid YouTube video URL or ID.');
        return;
      }
    }

    router.push(`/room/${code}${videoParam}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');

    const input = joinCodeInput.trim();
    if (!input) {
      setJoinError('Please enter a room code or invite link.');
      return;
    }

    // Check if input is a URL like http://.../room/SYNC-XXXX
    let extractedCode = input;
    if (input.includes('/room/')) {
      const parts = input.split('/room/');
      if (parts[1]) {
        extractedCode = parts[1].split(/[?#]/)[0];
      }
    }

    const normalized = normalizeRoomCode(extractedCode);
    router.push(`/room/${normalized}`);
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col justify-between overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-indigo-600/15 via-purple-600/10 to-transparent blur-3xl -z-10 pointer-events-none" />

      {/* Main Hero & Room Launcher */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 flex flex-col items-center text-center">
        {/* Top Feature Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs text-neutral-300 mb-6 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Real-time watch party crafted for two people</span>
        </div>

        {/* Hero Heading */}
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight max-w-3xl leading-[1.15]">
          Watch YouTube together.{' '}
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Chat side-by-side in real-time.
          </span>
        </h1>

        <p className="mt-4 text-base sm:text-lg text-neutral-400 max-w-2xl">
          Zero lag. Host-synchronized playback. No accounts required to jump in.
          Enjoy trailers, shows, music, and videos with your favorite person.
        </p>

        {/* Room Launcher Card */}
        <div className="w-full max-w-lg mt-10">
          <Card glow className="p-2 sm:p-3">
            {/* Tab Switcher */}
            <div className="grid grid-cols-2 p-1 bg-neutral-950/80 rounded-xl border border-neutral-800 mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className={`py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === 'create'
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Tv className="w-4 h-4" />
                Create Room for Two
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('join')}
                className={`py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === 'join'
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Users2 className="w-4 h-4" />
                Join Partner&apos;s Room
              </button>
            </div>

            {/* Create Room Form */}
            {activeTab === 'create' && (
              <form onSubmit={handleCreateRoom} className="space-y-4 p-3 text-left">
                <Input
                  label="Room Name"
                  placeholder="e.g. Movie Night, YouTube Chill"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  maxLength={50}
                  required
                />
                <Input
                  label="Initial YouTube URL (Optional)"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  error={createError}
                  helperText="You can also paste and change YouTube videos inside the room anytime."
                />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full mt-2"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Create Duo Watch Party
                </Button>
              </form>
            )}

            {/* Join Room Form */}
            {activeTab === 'join' && (
              <form onSubmit={handleJoinRoom} className="space-y-4 p-3 text-left">
                <Input
                  label="Room Code or Invitation Link"
                  placeholder="e.g. SYNC-8492 or paste invite URL"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  error={joinError}
                  helperText="Ask your partner for their 8-character room code or link."
                  autoFocus
                />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full mt-2"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Join Room Now
                </Button>
              </form>
            )}
          </Card>
        </div>

        {/* 3 Core Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-16 max-w-5xl w-full text-left">
          <Card className="p-5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-white">Sub-Second Playback Sync</h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              When the host plays, pauses, or seeks, the changes sync to your partner
              instantly. Smart drift correction keeps you perfectly in step.
            </p>
          </Card>

          <Card className="p-5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-white">Persistent Side-by-Side Chat</h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              Real-time messaging lives right beside the video. React, joke, and chat
              continuously without obscuring the screen or pausing the video.
            </p>
          </Card>

          <Card className="p-5">
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 mb-3">
              <Users2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-white">Live Partner Status</h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              See in real time if your partner is connected, buffering, or ready. No more
              asking &ldquo;Are you at minute 2:15 yet?&rdquo;
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
