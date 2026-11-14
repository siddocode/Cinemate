'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Link2,
  ListVideo,
  Loader2,
  Monitor,
  Play,
  Upload,
  Users2,
  Zap,
} from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { fetchDashboardData } from '@/lib/services/dashboardService';
import { FavoriteItem } from '@/lib/services/favoriteService';
import { UserRoomSummary } from '@/core/types/room.types';
import { RecentRoomsSection } from '@/components/room/RecentRoomsSection';
import { FavoritesSection } from '@/components/room/FavoritesSection';
import {
  SourceSetupModal,
  SourceSetupMode,
} from '@/components/home/SourceSetupModal';
import { generateRoomCode, normalizeRoomCode } from '@/lib/utils/code';
import { JOIN_ROOM_BUTTON_STAGES, useLoadingStages } from '@/hooks/useLoadingStages';

interface SecondarySourceProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function SecondarySource({
  title,
  description,
  icon,
  onClick,
  disabled = false,
}: SecondarySourceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center justify-between gap-2 sm:gap-2.5 rounded-xl sm:rounded-2xl border border-[#E8DDC5]/14 bg-[#102B23]/75 p-3 sm:p-3.5 text-left transition hover:border-[#9670FF]/45 hover:bg-[#173D30] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
        <span className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg border border-[#E8DDC5]/15 bg-[#0B1E17] text-[#B397FF]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] sm:text-sm font-semibold text-[#F7F4EC] leading-tight truncate">
            {title}
          </span>
          <span className="mt-0.5 block text-[11px] sm:text-xs leading-snug text-[#CDBF9F] line-clamp-2">
            {description}
          </span>
        </span>
      </div>
      <span className="flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full border border-[#E8DDC5]/15 bg-[#173D30] text-[#E8DDC5] transition-transform group-hover:translate-x-0.5 group-hover:border-[#9670FF]/60 group-hover:text-white">
        <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#9670FF]" />
      </span>
    </button>
  );
}

function NetflixPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DDC5]/14 bg-[#102B23]/70 px-3 py-1 text-xs font-medium text-[#F7F4EC]">
      <svg
        className="h-3 w-3 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path d="M5 2h3.5v20H5V2z" fill="#B1060E" />
        <path d="M15.5 2H19v20h-3.5V2z" fill="#B1060E" />
        <path d="M5 2h3.8l10.2 20h-3.8L5 2z" fill="#E50914" />
      </svg>
      <span>Netflix</span>
    </span>
  );
}

function PrimeVideoPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DDC5]/14 bg-[#102B23]/70 px-3 py-1 text-xs font-medium text-[#F7F4EC]">
      <span className="font-bold italic text-[11px] text-[#00A8E1] tracking-tight leading-none">
        prime
      </span>
      <span>Prime Video</span>
    </span>
  );
}

function YouTubeWaveDecoration() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 w-3/4 sm:w-3/5 lg:w-1/2 overflow-hidden select-none"
      style={{
        WebkitMaskImage:
          'linear-gradient(to right, transparent 0%, black 25%, black 100%)',
        maskImage:
          'linear-gradient(to right, transparent 0%, black 25%, black 100%)',
      }}
    >
      {/* Soft emerald/purple ambient glow */}
      <div className="absolute -right-6 top-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-gradient-to-bl from-[#10B981]/15 via-[#9670FF]/10 to-transparent blur-3xl pointer-events-none" />
      <svg
        viewBox="0 0 380 230"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full object-cover opacity-60 sm:opacity-75"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="yt-wave" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.08" />
            <stop offset="30%" stopColor="#34D399" stopOpacity="0.65" />
            <stop offset="70%" stopColor="#8B5CF6" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#B397FF" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {/* Harmonically spaced fluid wave ribbon */}
        <g stroke="url(#yt-wave)">
          <path d="M0.0 175.0C95.0 220.0 210.0 35.0 380.0 15.0" strokeWidth="1.2" opacity="0.32" />
          <path d="M2.4 177.1C96.8 215.3 208.4 39.5 381.1 21.1" strokeWidth="1.0" opacity="0.36" />
          <path d="M4.7 179.2C98.7 210.5 206.8 43.9 382.1 27.1" strokeWidth="1.2" opacity="0.41" />
          <path d="M7.1 181.3C100.5 205.8 205.3 48.4 383.2 33.2" strokeWidth="1.0" opacity="0.46" />
          <path d="M9.5 183.4C102.4 201.1 203.7 52.9 384.2 39.2" strokeWidth="1.2" opacity="0.52" />
          <path d="M11.8 185.5C104.2 196.3 202.1 57.4 385.3 45.3" strokeWidth="1.0" opacity="0.58" />
          <path d="M14.2 187.6C106.1 191.6 200.5 61.8 386.3 51.3" strokeWidth="1.2" opacity="0.63" />
          <path d="M16.6 189.7C107.9 186.8 198.9 66.3 387.4 57.4" strokeWidth="1.0" opacity="0.67" />
          <path d="M18.9 191.8C109.7 182.1 197.4 70.8 388.4 63.4" strokeWidth="1.2" opacity="0.69" />
          <path d="M21.3 193.9C111.6 177.4 195.8 75.3 389.5 69.5" strokeWidth="1.0" opacity="0.68" />
          <path d="M23.7 196.1C113.4 172.6 194.2 79.7 390.5 75.5" strokeWidth="1.2" opacity="0.64" />
          <path d="M26.1 198.2C115.3 167.9 192.6 84.2 391.6 81.6" strokeWidth="1.0" opacity="0.59" />
          <path d="M28.4 200.3C117.1 163.2 191.1 88.7 392.6 87.6" strokeWidth="1.2" opacity="0.53" />
          <path d="M30.8 202.4C118.9 158.4 189.5 93.2 393.7 93.7" strokeWidth="1.0" opacity="0.47" />
          <path d="M33.2 204.5C120.8 153.7 187.9 97.6 394.7 99.7" strokeWidth="1.2" opacity="0.42" />
          <path d="M35.5 206.6C122.6 148.9 186.3 102.1 395.8 105.8" strokeWidth="1.0" opacity="0.37" />
          <path d="M37.9 208.7C124.5 144.2 184.7 106.6 396.8 111.8" strokeWidth="1.2" opacity="0.33" />
          <path d="M40.3 210.8C126.3 139.5 183.2 111.1 397.9 117.9" strokeWidth="1.0" opacity="0.29" />
        </g>
      </svg>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { user, isAuthenticated } = useSession();

  const [setupMode, setSetupMode] = useState<SourceSetupMode | null>(null);
  const [isCreatingSource, setIsCreatingSource] = useState(false);

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [navigatingAction, setNavigatingAction] = useState<
    'create' | 'join' | 'shelf' | null
  >(null);
  const [recentRooms, setRecentRooms] = useState<UserRoomSummary[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loadedDashboardUserId, setLoadedDashboardUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user.id) {
      return;
    }

    let isMounted = true;
    const targetUserId = user.id;

    fetchDashboardData(targetUserId)
      .then((data) => {
        if (!isMounted) return;
        setRecentRooms(data.recentRooms);
        setFavorites(data.favorites);
        setLoadedDashboardUserId(targetUserId);
      })
      .catch(() => {
        if (!isMounted) return;
        setRecentRooms([]);
        setFavorites([]);
        setLoadedDashboardUserId(targetUserId);
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user.id]);

  const isDashboardLoading = Boolean(
    isAuthenticated && user.id && loadedDashboardUserId !== user.id
  );

  const isLobbyBusy = navigatingAction !== null || isCreatingSource;
  const { stage: joinButtonStage } = useLoadingStages(
    navigatingAction === 'join',
    JOIN_ROOM_BUTTON_STAGES
  );

  const goToYouTube = () => {
    if (isLobbyBusy) return;
    setNavigatingAction('create');
    router.push('/browse');
  };

  const handleCreateFromModal = ({ title, url }: { title: string; url?: string }) => {
    if (isLobbyBusy) return;
    const code = generateRoomCode();
    const params = new URLSearchParams();
    params.set('create', '1');
    const trimmedTitle = title.trim();
    if (trimmedTitle) params.set('title', trimmedTitle);

    if (setupMode === 'url' && url) {
      params.set('source', 'url');
      params.set('video', url);
    } else {
      params.set('source', 'upload');
      params.set('openUpload', '1');
    }

    setNavigatingAction('create');
    setIsCreatingSource(true);
    router.push(`/room/${code}?${params.toString()}`);
  };

  const handleJoinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
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
    <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-8 pt-5 sm:px-6 sm:pb-10 sm:pt-7">
      {/* Soft emerald ambient light at top right */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-96 w-96 max-w-full overflow-hidden opacity-60">
        <div className="h-full w-full rounded-full bg-gradient-to-bl from-[#1D7355]/30 via-[#104735]/20 to-transparent blur-3xl" />
      </div>

      {/* Header section */}
      <header className="relative z-10">
        <p className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.2em] text-[#9670FF]">
          New watch party
        </p>
        <h1 className="mt-1.5 font-serif text-[32px] sm:text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-[#F7F4EC]">
          <span className="relative inline-block text-[#F9E8C7] drop-shadow-[0_0_18px_rgba(249,232,199,0.45)]">
            What
          </span>{' '}
          are we watching?
        </h1>
        <p className="mt-2 max-w-xl text-sm sm:text-base leading-relaxed text-[#CDBF9F]">
          Start with YouTube, or bring your own link or upload. We&apos;ll keep
          everyone in sync.
        </p>
      </header>

      {/* Main Content Layout */}
      <div className="relative z-10 mt-5 sm:mt-6 grid gap-3.5 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* Left Column (YouTube, Secondary Sources, Coming Soon) */}
        <div className="flex flex-col gap-3 sm:gap-3.5">
          {/* Main YouTube Hero Card */}
          <section className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-[#9670FF]/35 bg-gradient-to-br from-[#122A22]/95 via-[#0B1E17]/95 to-[#071510]/95 shadow-[0_16px_40px_rgba(0,0,0,0.35)] p-4 sm:p-6 sm:py-7 text-left transition hover:border-[#9670FF]/55">
            {/* Abstract flowing wave decoration on right */}
            <YouTubeWaveDecoration />

            <div className="relative z-10 flex flex-col items-start max-w-none sm:max-w-md lg:max-w-lg">
              {/* Header: YouTube pill icon + YouTube text */}
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="flex h-6 w-9 sm:h-7 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-[#FF0000] shadow-[0_4px_14px_rgba(255,0,0,0.35)]">
                  <Play className="h-3.5 w-3.5 fill-white text-white ml-0.5" />
                </div>
                <h2 className="font-serif text-[26px] sm:text-3xl font-semibold leading-none tracking-tight text-[#F7F4EC]">
                  YouTube
                </h2>
              </div>

              {/* Description */}
              <p className="mt-2.5 text-[13.5px] sm:text-sm leading-relaxed text-[#CDBF9F] max-w-md">
                Search videos, build a shared line-up, and watch together with host-controlled playback.
              </p>

              {/* Feature badges */}
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 sm:gap-x-4 gap-y-1.5 text-xs text-[#CDBF9F] font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <ListVideo className="h-3.5 w-3.5 text-[#B397FF] shrink-0" />
                  Shared queue
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users2 className="h-3.5 w-3.5 text-[#B397FF] shrink-0" />
                  Up to 4 viewers
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5 text-[#B397FF] shrink-0" />
                  Host sync
                </span>
              </div>

              {/* Purple Action Button */}
              <div className="mt-4 sm:mt-5">
                <button
                  type="button"
                  onClick={goToYouTube}
                  disabled={isLobbyBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#7D34EB] to-[#9747FF] hover:from-[#8944F2] hover:to-[#A25BFF] px-5 sm:px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_18px_rgba(125,52,235,0.4)] transition cursor-pointer disabled:opacity-75 disabled:cursor-wait"
                >
                  {isLobbyBusy && navigatingAction === 'create' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>Connecting…</span>
                    </>
                  ) : (
                    <>
                      <span>Watch on YouTube</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Secondary Sources: Direct URL & Local Upload (2 columns side by side) */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <SecondarySource
              title="Direct URL"
              description="Paste an MP4, WebM, or stream link."
              icon={<Link2 className="h-4 w-4" />}
              onClick={() => setSetupMode('url')}
              disabled={isLobbyBusy}
            />
            <SecondarySource
              title="Local Upload"
              description="Create a room, then upload a clip (≤ 50MB)."
              icon={<Upload className="h-4 w-4" />}
              onClick={() => setSetupMode('upload')}
              disabled={isLobbyBusy}
            />
          </div>

          {/* Coming Soon Pills */}
          <div className="flex items-center justify-center sm:justify-start gap-2.5 py-1">
            <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#CDBF9F]/85 shrink-0">
              Coming soon
            </span>
            <NetflixPill />
            <PrimeVideoPill />
          </div>
        </div>

        {/* Right Column / Mobile following stream */}
        <div className="flex flex-col gap-3 sm:gap-3.5 lg:sticky lg:top-20">
          {/* Join a Room Card */}
          <section className="relative overflow-hidden rounded-2xl border border-[#D8CEB8] bg-[#EDE2CA] p-4 sm:p-5 text-[#102B23] shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
            {/* Misty forest silhouette background illustration */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/forest-silhouette.png"
              alt=""
              className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-28 sm:h-32 object-contain opacity-35 select-none"
            />

            <div className="relative z-10">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-[#102B23] text-[#F7F4EC] shadow-sm">
                  <Users2 className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                <div>
                  <h2 className="font-serif text-xl sm:text-2xl font-bold leading-none text-[#102B23]">
                    Join a room
                  </h2>
                  <p className="mt-1 text-xs sm:text-[13px] text-[#173D30]/85 font-normal">
                    Have an invite link or room code?
                  </p>
                </div>
              </div>

              <form onSubmit={handleJoinRoom} className="mt-3.5 space-y-2.5">
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3.5 flex items-center text-[#8C7D68]">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <input
                    id="join-room-input"
                    type="text"
                    placeholder="Room code or invite link"
                    value={joinCodeInput}
                    onChange={(event) => setJoinCodeInput(event.target.value)}
                    disabled={isLobbyBusy}
                    aria-label="Room code or invite link"
                    className="w-full rounded-xl border border-[#D5C8AF] bg-[#FAF5EC] py-2.5 pl-10 pr-3 text-sm text-[#102B23] placeholder-[#9F917C] outline-none transition focus:border-[#7D34EB] focus:ring-1 focus:ring-[#7D34EB] disabled:opacity-50"
                  />
                </div>
                {joinError && (
                  <p className="text-xs text-red-600 font-medium px-1">{joinError}</p>
                )}
                <button
                  type="submit"
                  disabled={isLobbyBusy}
                  className="w-full rounded-full bg-gradient-to-r from-[#7D34EB] to-[#9747FF] hover:from-[#8944F2] hover:to-[#A25BFF] py-2.5 sm:py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(125,52,235,0.35)] transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-75"
                >
                  {navigatingAction === 'join' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>{joinButtonStage.label}</span>
                    </>
                  ) : (
                    <>
                      <span>Join Room</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </section>

          {/* Built for a shared screen (desktop only) */}
          <section className="hidden lg:block rounded-2xl border border-[#E8DDC5]/12 bg-[#173D30]/45 p-4">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/75">
              Built for a shared screen
            </p>
            <ul className="mt-3 space-y-2.5 text-xs sm:text-[13px] leading-relaxed text-[#CDBF9F]/90">
              <li className="flex items-start gap-2">
                <Play className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B397FF]" />
                The host controls play, pause, and seek for everyone.
              </li>
              <li className="flex items-start gap-2">
                <ListVideo className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B397FF]" />
                Everyone can add videos to the shared queue.
              </li>
              <li className="flex items-start gap-2">
                <Users2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B397FF]" />
                Chat and voice stay beside the screening.
              </li>
            </ul>
          </section>
        </div>
      </div>

      {/* Feature Pillars: Real-time Sync, Watch Together, Any Device */}
      <div className="relative z-10 mt-6 sm:mt-8 border-t border-[#E8DDC5]/10 pt-4 pb-2">
        <div className="grid grid-cols-3 divide-x divide-[#E8DDC5]/10 text-center">
          <div className="flex flex-col items-center px-1 sm:px-2">
            <Zap className="h-4 w-4 text-[#B397FF]" />
            <h3 className="mt-1.5 text-xs sm:text-[13px] font-semibold text-[#F7F4EC] leading-tight">
              Real-time Sync
            </h3>
            <p className="mt-0.5 text-[11px] sm:text-xs text-[#A6BAAE] leading-tight">
              Play, pause and seek together
            </p>
          </div>

          <div className="flex flex-col items-center px-1 sm:px-2">
            <Users2 className="h-4 w-4 text-[#B397FF]" />
            <h3 className="mt-1.5 text-xs sm:text-[13px] font-semibold text-[#F7F4EC] leading-tight">
              Watch Together
            </h3>
            <p className="mt-0.5 text-[11px] sm:text-xs text-[#A6BAAE] leading-tight">
              Host control, shared queue
            </p>
          </div>

          <div className="flex flex-col items-center px-1 sm:px-2">
            <Monitor className="h-4 w-4 text-[#B397FF]" />
            <h3 className="mt-1.5 text-xs sm:text-[13px] font-semibold text-[#F7F4EC] leading-tight">
              Any Device
            </h3>
            <p className="mt-0.5 text-[11px] sm:text-xs text-[#A6BAAE] leading-tight">
              Works on desktop and mobile
            </p>
          </div>
        </div>
      </div>

      {/* Recent Rooms and Favorites (Durable application history) */}
      <div className="relative z-10 mx-auto mt-4 flex w-full max-w-5xl flex-col">
        <RecentRoomsSection
          isExternalNavigating={isLobbyBusy}
          onStartNavigation={() => setNavigatingAction('shelf')}
          externalRooms={isAuthenticated && loadedDashboardUserId === user.id ? recentRooms : []}
          isExternalLoading={isDashboardLoading}
          onRoomsChange={setRecentRooms}
        />
        <FavoritesSection
          isExternalNavigating={isLobbyBusy}
          onStartNavigation={() => setNavigatingAction('shelf')}
          externalFavorites={isAuthenticated && loadedDashboardUserId === user.id ? favorites : []}
          isExternalLoading={isDashboardLoading}
          onFavoritesChange={setFavorites}
        />
      </div>

      {setupMode && (
        <SourceSetupModal
          key={setupMode}
          mode={setupMode}
          isOpen
          isBusy={isCreatingSource}
          onClose={() => setSetupMode(null)}
          onConfirm={handleCreateFromModal}
        />
      )}
    </div>
  );
}
