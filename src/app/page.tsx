'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users2,
  Tv,
  ArrowRight,
  Link2,
} from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { RecentRoomsSection } from '@/components/room/RecentRoomsSection';
import { FavoritesSection } from '@/components/room/FavoritesSection';
import { AccentUnderline } from '@/components/common/AccentUnderline';
import { FeaturePillars } from '@/components/common/FeaturePillars';
import { generateRoomCode, normalizeRoomCode } from '@/lib/utils/code';
import { extractYouTubeId } from '@/lib/utils/youtube';

export default function HomePage() {
  const router = useRouter();
  const { user, isAuthenticated } = useSession();
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');

  // Create room state
  const [roomTitle, setRoomTitle] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const [createError, setCreateError] = useState('');

  // Join room state
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [navigatingAction, setNavigatingAction] = useState<'create' | 'join' | 'shelf' | null>(null);

  const isLobbyBusy = navigatingAction !== null;

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLobbyBusy) return;
    setCreateError('');

    const code = generateRoomCode();
    const params = new URLSearchParams();
    params.set('create', '1');
    const trimmedTitle = roomTitle.trim();
    if (trimmedTitle) {
      params.set('title', trimmedTitle);
    }

    if (videoInput.trim()) {
      const ytId = extractYouTubeId(videoInput.trim());
      if (ytId) {
        params.set('v', ytId);
      } else {
        setCreateError('Please enter a valid YouTube video URL or ID.');
        return;
      }
    }

    setNavigatingAction('create');
    const query = params.toString();
    router.push(`/room/${code}${query ? `?${query}` : ''}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLobbyBusy) return;
    setJoinError('');

    const input = joinCodeInput.trim();
    if (!input) {
      setJoinError('Please enter a room code or invite link.');
      return;
    }

    let extractedCode = input;
    if (input.includes('/room/')) {
      const parts = input.split('/room/');
      if (parts[1]) {
        extractedCode = parts[1].split(/[?#]/)[0];
      }
    }

    setNavigatingAction('join');
    const normalized = normalizeRoomCode(extractedCode);
    router.push(`/room/${normalized}`);
  };

  return (
    <div className="flex-1 flex flex-col justify-between max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4 pb-8 sm:pt-5 sm:pb-10">
      <div className="flex flex-col items-center text-center">
        {/* Centered Editorial Hero Heading */}
        <h1 className="font-serif text-3xl sm:text-4xl lg:text-[2.95rem] font-bold tracking-[-0.02em] leading-[1.06] text-[#F7F4EC] max-w-3xl">
          Watch YouTube together.
          <br />
          <span className="font-normal">
            Chat side-by-side in{' '}
            <AccentUnderline>real-time.</AccentUnderline>
          </span>
        </h1>

        <p className="mt-2 text-xs sm:text-sm text-[#CDBF9F] max-w-xl leading-relaxed">
          Zero lag. Host-synchronized playback. Private watch rooms for up to 4
          friends—enjoy YouTube, direct streams, and personal uploads together.
        </p>

        {/* Centered Warm Sand Beige Room Launcher Card */}
        <div className="w-full max-w-lg mt-4 sm:mt-5 text-left">
          <Card glow tone="sand" className="p-4 sm:p-5">
            {/* Pill Tab Switcher */}
            <div className="grid grid-cols-2 p-1 bg-[#DFD2B4] rounded-full mb-3.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                disabled={isLobbyBusy}
                className={`py-2 px-3 font-semibold rounded-full transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:pointer-events-none ${
                  activeTab === 'create'
                    ? 'bg-[#102B23] text-[#F7F4EC] shadow-sm'
                    : 'text-[#173D30]/80 hover:text-[#102B23]'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>Create Room</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('join')}
                disabled={isLobbyBusy}
                className={`py-2 px-3 font-semibold rounded-full transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:pointer-events-none ${
                  activeTab === 'join'
                    ? 'bg-[#102B23] text-[#F7F4EC] shadow-sm'
                    : 'text-[#173D30]/80 hover:text-[#102B23]'
                }`}
              >
                <Users2 className="w-3.5 h-3.5" />
                <span>Join Room</span>
              </button>
            </div>

            {/* Create Room Form */}
            {activeTab === 'create' && (
              <form onSubmit={handleCreateRoom} className="space-y-3">
                <Input
                  label="Room Name"
                  placeholder="e.g. Movie Night, YouTube Chill"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  maxLength={50}
                  disabled={isLobbyBusy}
                  required
                />
                <Input
                  label="Initial YouTube URL (Optional)"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  error={createError}
                  leftIcon={<Link2 className="w-4 h-4" />}
                  helperText="Leave blank to paste a link, direct video URL, or upload a clip (up to 50MB) inside the room."
                  disabled={isLobbyBusy}
                />
                <Button
                  type="submit"
                  size="lg"
                  variant="primary"
                  className="w-full mt-1"
                  isLoading={navigatingAction === 'create'}
                  disabled={isLobbyBusy}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {navigatingAction === 'create' ? 'Opening Room…' : 'Create Watch Party'}
                </Button>
              </form>
            )}

            {/* Join Room Form */}
            {activeTab === 'join' && (
              <form onSubmit={handleJoinRoom} className="space-y-3">
                <Input
                  label="Room Code or Invitation Link"
                  placeholder="e.g. SYNC-8492 or paste invite URL"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  error={joinError}
                  leftIcon={<Link2 className="w-4 h-4" />}
                  helperText="Enter the 8-character room code or invite link (up to 4 viewers per room)."
                  disabled={isLobbyBusy}
                  autoFocus
                />
                <Button
                  type="submit"
                  size="lg"
                  variant="primary"
                  className="w-full mt-1"
                  isLoading={navigatingAction === 'join'}
                  disabled={isLobbyBusy}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {navigatingAction === 'join' ? 'Joining Room…' : 'Join Room Now'}
                </Button>
              </form>
            )}

            {/* Card Footer Status */}
            <div className="pt-2.5 mt-3.5 border-t border-[#173D30]/12">
              {isAuthenticated ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#173D30]/80 truncate">
                    Signed in as{' '}
                    <strong className="font-semibold text-[#102B23]">
                      {user.username || user.email}
                    </strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#15803D] font-semibold shrink-0">
                    <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                    Ready to Host
                  </span>
                </div>
              ) : (
                <p className="text-xs text-[#173D30]/80 text-center">
                  Want to save your watch parties and identity?{' '}
                  <Link
                    href="/login"
                    className="text-[#7235A8] hover:text-[#5B218F] font-semibold underline underline-offset-4"
                  >
                    Sign in or register
                  </Link>
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Recent Rooms & Saved Favorites Shelves */}
        <RecentRoomsSection
          isExternalNavigating={isLobbyBusy}
          onStartNavigation={() => setNavigatingAction('shelf')}
        />
        <FavoritesSection
          isExternalNavigating={isLobbyBusy}
          onStartNavigation={() => setNavigatingAction('shelf')}
        />
      </div>

      {/* Bottom 3-Column Feature Pillars */}
      <FeaturePillars />
    </div>
  );
}
