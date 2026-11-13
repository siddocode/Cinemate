'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  Clapperboard,
  Link2,
  ListVideo,
  Loader2,
  MessageCircle,
  Play,
  Upload,
  Users2,
} from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { fetchDashboardData } from '@/lib/services/dashboardService';
import { FavoriteItem } from '@/lib/services/favoriteService';
import { UserRoomSummary } from '@/core/types/room.types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RecentRoomsSection } from '@/components/room/RecentRoomsSection';
import { FavoritesSection } from '@/components/room/FavoritesSection';
import { YouTubeIcon } from '@/components/common/YouTubeIcon';
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
      className="group flex w-full items-center gap-3 rounded-xl border border-[#E8DDC5]/14 bg-[#102B23]/75 p-3.5 text-left transition hover:border-[#9670FF]/45 hover:bg-[#173D30] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E8DDC5]/10 bg-[#0B1E17] text-[#B397FF]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#F7F4EC]">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[#CDBF9F]/90">
          {description}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[#9670FF] transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function ComingSoonSource({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DDC5]/14 bg-[#102B23]/50 px-2.5 py-1 text-xs font-medium text-[#CDBF9F]/85">
      {icon}
      {label}
    </span>
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-8 pt-5 sm:px-6 sm:pb-10 sm:pt-7">
      <header>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#9670FF]">
          New watch party
        </p>
        <h1 className="mt-1.5 font-serif text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-[#F7F4EC] sm:text-4xl">
          What are we watching?
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#CDBF9F] sm:text-base">
          Start with YouTube, or bring your own link or upload. We&apos;ll keep
          everyone in sync.
        </p>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_336px] lg:items-start">
        <div>
          <section className="overflow-hidden rounded-2xl border border-[#E8DDC5]/14 bg-[#0B1E17] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
            <button
              type="button"
              onClick={goToYouTube}
              disabled={isLobbyBusy}
              className="group block w-full text-left disabled:cursor-wait disabled:opacity-80"
            >
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-xl bg-[#FF0000] shadow-[0_8px_24px_rgba(255,0,0,0.18)]">
                    <YouTubeIcon className="h-9 w-12" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-serif text-3xl font-semibold leading-none tracking-tight text-[#F7F4EC]">
                      YouTube
                    </h2>
                    <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[#CDBF9F]">
                      Search videos, build a shared line-up, and watch together with
                      host-controlled playback.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#CDBF9F]/85">
                      <span className="inline-flex items-center gap-1">
                        <ListVideo className="h-3.5 w-3.5 text-[#B397FF]" />
                        Shared queue
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users2 className="h-3.5 w-3.5 text-[#B397FF]" />
                        Up to 4 viewers
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Play className="h-3.5 w-3.5 text-[#B397FF]" />
                        Host sync
                      </span>
                    </div>
                  </div>
                </div>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-full border border-[#9670FF]/35 bg-[#9670FF]/10 text-[#E8DDC5] transition group-hover:border-[#9670FF]/60 group-hover:bg-[#9670FF]/20 group-hover:text-[#F7F4EC] sm:self-center">
                  {isLobbyBusy ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[#B397FF]" />
                  ) : (
                    <ArrowRight className="h-5 w-5" />
                  )}
                </span>
              </div>
            </button>
            <p className="border-t border-[#E8DDC5]/10 px-4 py-2.5 text-[11px] leading-relaxed text-[#CDBF9F]/70">
              YouTube is a trademark of Google LLC. Syncora is an independent watch-party
              app and is not affiliated with YouTube.
            </p>
          </section>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <SecondarySource
              title="Direct URL"
              description="Paste an MP4, WebM, or stream link."
              icon={<Link2 className="h-4 w-4" />}
              onClick={() => setSetupMode('url')}
              disabled={isLobbyBusy}
            />
            <SecondarySource
              title="Local upload"
              description="Create a room, then upload a clip."
              icon={<Upload className="h-4 w-4" />}
              onClick={() => setSetupMode('upload')}
              disabled={isLobbyBusy}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#E8DDC5]/10 pt-3">
            <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/75">
              Coming soon
            </span>
            <ComingSoonSource
              icon={<Clapperboard className="h-3 w-3" />}
              label="Netflix"
            />
            <ComingSoonSource
              icon={<Play className="h-3 w-3" />}
              label="Prime Video"
            />
          </div>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20">
          <section className="rounded-2xl border border-[#CDBF9F]/70 bg-[#EDE2CA] p-4 text-[#102B23] shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#102B23] text-[#F7F4EC]">
                <Users2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-serif text-xl font-semibold leading-none">
                  Join a room
                </h2>
                <p className="mt-1 text-xs text-[#173D30]/85">
                  Have an invite link or room code?
                </p>
              </div>
            </div>

            <form onSubmit={handleJoinRoom} className="mt-3 space-y-2.5">
              <Input
                id="join-room-input"
                placeholder="Room code or invite link"
                value={joinCodeInput}
                onChange={(event) => setJoinCodeInput(event.target.value)}
                error={joinError}
                leftIcon={<Link2 className="h-4 w-4" />}
                disabled={isLobbyBusy}
                aria-label="Room code or invite link"
                className="bg-[#F7F4EC]/70"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={navigatingAction === 'join'}
                disabled={isLobbyBusy}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                className="w-full rounded-full"
              >
                {navigatingAction === 'join' ? joinButtonStage.label : 'Join Room'}
              </Button>
            </form>

            <div className="mt-3 border-t border-[#173D30]/15 pt-2.5 text-xs leading-relaxed">
              {isAuthenticated ? (
                <span className="text-[#173D30]/90">
                  Signed in as{' '}
                  <strong className="font-semibold text-[#102B23]">
                    {user.username || user.email}
                  </strong>
                </span>
              ) : (
                <span className="text-[#173D30]/90">
                  Want to keep your rooms?{' '}
                  <Link
                    href="/login"
                    className="font-semibold text-[#7235A8] underline underline-offset-4 hover:text-[#5B218F]"
                  >
                    Sign in
                  </Link>
                </span>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[#E8DDC5]/12 bg-[#173D30]/45 p-4">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/75">
              Built for a shared screen
            </p>
            <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-[#CDBF9F]/90">
              <li className="flex items-start gap-2">
                <Play className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B397FF]" />
                The host controls play, pause, and seek for everyone.
              </li>
              <li className="flex items-start gap-2">
                <ListVideo className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B397FF]" />
                Everyone can add videos to the shared queue.
              </li>
              <li className="flex items-start gap-2">
                <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B397FF]" />
                Chat and voice stay beside the screening.
              </li>
            </ul>
          </section>
        </aside>
      </div>

      <div className="mx-auto mt-2 flex w-full max-w-5xl flex-col">
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
