'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clapperboard,
  Cpu,
  Film,
  Gamepad2,
  ListVideo,
  Music2,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Podcast,
  Search,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import {
  YouTubeBrowser,
  YouTubeBrowserHandle,
} from '@/components/youtube/YouTubeBrowser';
import { YouTubeIcon } from '@/components/common/YouTubeIcon';
import { YouTubeVideoSummary } from '@/core/types/youtube.types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { generateRoomCode } from '@/lib/utils/code';
import { savePendingQueue } from '@/lib/utils/pendingQueue';
import { formatTime } from '@/lib/utils/time';
import { cn } from '@/lib/utils/cn';

const MAX_QUEUE_SEED = 20;

const BROWSE_CATEGORIES = [
  { label: 'Music', term: 'Music', icon: Music2 },
  { label: 'Gaming', term: 'Gaming', icon: Gamepad2 },
  { label: 'Movies', term: 'Movies', icon: Clapperboard },
  { label: 'Comedy', term: 'Comedy', icon: Trophy },
  { label: 'Podcasts', term: 'Podcasts', icon: Podcast },
  { label: 'Documentaries', term: 'Documentaries', icon: Film },
  { label: 'News', term: 'News', icon: Newspaper },
  { label: 'Technology', term: 'Technology', icon: Cpu },
];

interface LineupPanelProps {
  inputId: string;
  selected: YouTubeVideoSummary[];
  roomTitle: string;
  error: string;
  isStarting: boolean;
  onRemove: (videoId: string) => void;
  onClear: () => void;
  onRoomTitleChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose?: () => void;
}

const LineupPanel: React.FC<LineupPanelProps> = ({
  inputId,
  selected,
  roomTitle,
  error,
  isStarting,
  onRemove,
  onClear,
  onRoomTitleChange,
  onSubmit,
  onClose,
}) => {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0B2019]">
      <div className="flex items-start justify-between gap-3 border-b border-[#E8DDC5]/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListVideo className="h-4 w-4 text-[#B397FF]" />
            <h2 className="text-sm font-semibold text-[#F7F4EC]">Your line-up</h2>
            <span className="rounded-full bg-[#E8DDC5] px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-[#102B23]">
              {selected.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[#CDBF9F]/65">
            {selected.length === 0
              ? 'Add videos from the grid'
              : 'The first video starts the room'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              disabled={isStarting}
              className="rounded-full px-2 py-1 text-[10px] font-semibold text-[#CDBF9F]/70 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC] cursor-pointer disabled:opacity-45"
            >
              Clear
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#CDBF9F]/70 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC] cursor-pointer"
              aria-label="Close line-up"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {selected.length === 0 ? (
          <div className="flex h-full min-h-[190px] flex-col items-center justify-center px-6 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#173D30] text-[#B397FF]">
              <ListVideo className="h-4 w-4" />
            </span>
            <p className="mt-3 text-xs font-semibold text-[#F7F4EC]">
              Your line-up is empty
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#CDBF9F]/65">
              Add a video from the grid or paste a YouTube link. Everyone can add to
              the queue once the room starts.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#E8DDC5]/8">
            {selected.map((video, index) => (
              <li
                key={video.videoId}
                className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-[#E8DDC5]/5"
              >
                <span className="w-4 shrink-0 text-center font-mono text-[10px] text-[#CDBF9F]/45">
                  {index + 1}
                </span>
                <div className="relative h-12 w-[76px] shrink-0 overflow-hidden rounded-md bg-[#071A13]">
                  {video.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <YouTubeIcon className="h-4 w-6 opacity-45" />
                    </div>
                  )}
                  {video.durationSeconds > 0 && (
                    <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/85 px-1 font-mono text-[8px] font-semibold text-white">
                      {formatTime(video.durationSeconds)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs font-medium leading-snug text-[#F7F4EC]">
                    {video.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-[#CDBF9F]/60">
                    {video.channelTitle}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#9670FF]/80">
                    {index === 0 ? 'Starts now' : 'Up next'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(video.videoId)}
                  disabled={isStarting}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#CDBF9F]/55 transition hover:bg-[#3A1E1C] hover:text-[#F2B8B2] cursor-pointer disabled:opacity-45"
                  aria-label={`Remove ${video.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-[#E8DDC5]/10 bg-[#0B1E17] px-4 py-3"
      >
        <Input
          id={inputId}
          label="Room name"
          placeholder="e.g. Friday Movie Night"
          value={roomTitle}
          onChange={(event) => onRoomTitleChange(event.target.value)}
          maxLength={50}
          tone="dark"
          disabled={isStarting}
        />
        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[#F2B8B2]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <Button
          type="submit"
          size="md"
          variant="primary"
          className="mt-3 w-full rounded-full"
          isLoading={isStarting}
          disabled={selected.length === 0}
          leftIcon={<Play className="h-4 w-4 fill-current" />}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          {isStarting ? 'Opening room…' : 'Start watch party'}
        </Button>
        <p className="mt-2 text-center text-[10px] leading-relaxed text-[#CDBF9F]/50">
          Up to 4 viewers · host-controlled playback · shared queue
        </p>
      </form>
    </div>
  );
};

export default function BrowsePage() {
  const router = useRouter();
  const browserRef = useRef<YouTubeBrowserHandle>(null);
  const [selected, setSelected] = useState<YouTubeVideoSummary[]>([]);
  const [roomTitle, setRoomTitle] = useState('');
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLineupOpen, setIsLineupOpen] = useState(true);
  const [isMobileLineupOpen, setIsMobileLineupOpen] = useState(false);

  const selectedIds = selected.map((video) => video.videoId);
  const firstSelected = selected[0];

  useEffect(() => {
    if (!isMobileLineupOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileLineupOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileLineupOpen]);

  const handleSelect = (video: YouTubeVideoSummary) => {
    setError('');
    setSelected((prev) => {
      if (prev.some((item) => item.videoId === video.videoId)) {
        return prev.filter((item) => item.videoId !== video.videoId);
      }
      if (prev.length >= MAX_QUEUE_SEED) {
        setError(`You can line up to ${MAX_QUEUE_SEED} videos. Remove one to add another.`);
        return prev;
      }
      return [...prev, video];
    });
  };

  const handleRemove = (videoId: string) => {
    setSelected((prev) => prev.filter((video) => video.videoId !== videoId));
  };

  const handleClear = () => {
    setSelected([]);
    setError('');
  };

  const handleStart = (event: React.FormEvent) => {
    event.preventDefault();
    if (isStarting) return;

    const first = selected[0];
    if (!first) {
      setError('Pick at least one YouTube video to start.');
      return;
    }

    const code = generateRoomCode();
    savePendingQueue(
      code,
      selected.map((video) => ({
        videoId: video.videoId,
        videoType: 'youtube' as const,
        title: video.title,
        channelTitle: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
        durationSeconds: video.durationSeconds,
      }))
    );

    const params = new URLSearchParams();
    params.set('create', '1');
    params.set('v', first.videoId);
    params.set('seedQueue', '1');
    const trimmedTitle = roomTitle.trim();
    if (trimmedTitle) params.set('title', trimmedTitle);

    setIsStarting(true);
    setIsMobileLineupOpen(false);
    router.push(`/room/${code}?${params.toString()}`);
  };

  const handleOpenLineup = () => {
    if (isLineupOpen) {
      document.getElementById('desktop-room-name-input')?.focus();
      return;
    }
    setIsLineupOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById('desktop-room-name-input')?.focus();
    });
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="sticky top-14 z-30 border-b border-[#E8DDC5]/10 bg-[#0B2019]/95 backdrop-blur-md sm:top-16">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-3 sm:px-5">
          <Link
            href="/"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#CDBF9F]/75 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC]"
            aria-label="Back to source selection"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex min-w-0 items-center gap-2.5">
            <YouTubeIcon className="h-6 w-9 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold text-[#F7F4EC]">YouTube</span>
                <span className="hidden text-[9px] font-mono uppercase tracking-[0.14em] text-[#CDBF9F]/55 sm:inline">
                  in Syncora
                </span>
              </div>
              <p className="hidden truncate text-[10px] text-[#CDBF9F]/55 sm:block">
                Browse videos for your watch party
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => browserRef.current?.focusSearch()}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#CDBF9F]/75 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC] cursor-pointer lg:hidden"
              aria-label="Focus search"
            >
              <Search className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsLineupOpen((prev) => !prev)}
              className="hidden h-9 items-center gap-1.5 rounded-full border border-[#E8DDC5]/14 px-3 text-xs font-medium text-[#E8DDC5] transition hover:border-[#9670FF]/45 hover:text-[#F7F4EC] cursor-pointer lg:inline-flex"
              aria-expanded={isLineupOpen}
            >
              <ListVideo className="h-4 w-4" />
              Line-up
              {selected.length > 0 && (
                <span className="rounded-full bg-[#E8DDC5] px-1.5 font-mono text-[9px] font-bold text-[#102B23]">
                  {selected.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenLineup}
              className="hidden h-9 items-center gap-1.5 rounded-full bg-[#7235A8] px-4 text-xs font-semibold text-[#F7F4EC] transition hover:bg-[#8342BE] cursor-pointer lg:inline-flex"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Start room
            </button>

            <button
              type="button"
              onClick={() => setIsMobileLineupOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#E8DDC5]/14 px-3 text-xs font-medium text-[#E8DDC5] transition hover:border-[#9670FF]/45 cursor-pointer lg:hidden"
              aria-label="Open line-up"
            >
              <ListVideo className="h-4 w-4" />
              {selected.length > 0 && (
                <span className="rounded-full bg-[#E8DDC5] px-1.5 font-mono text-[9px] font-bold text-[#102B23]">
                  {selected.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-start">
        <aside
          className={cn(
            'sticky top-28 hidden h-[calc(100dvh-7rem)] shrink-0 flex-col border-r border-[#E8DDC5]/10 bg-[#0B2019]/55 transition-[width] duration-200 sm:top-[7.5rem] sm:h-[calc(100dvh-7.5rem)] xl:flex',
            isSidebarCollapsed ? 'w-[72px]' : 'w-[220px]'
          )}
          aria-label="Browse categories"
        >
          <div className="p-2">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className={cn(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-xs font-medium text-[#CDBF9F]/80 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC] cursor-pointer',
                isSidebarCollapsed && 'justify-center px-0'
              )}
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span>Browse</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 rotate-180 opacity-45" />
                </>
              )}
            </button>
          </div>

          <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            <button
              type="button"
              onClick={() => browserRef.current?.focusSearch()}
              className={cn(
                'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-xs font-medium text-[#CDBF9F]/70 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC] cursor-pointer',
                isSidebarCollapsed && 'justify-center px-0'
              )}
              title="Search YouTube"
            >
              <Search className="h-4 w-4 shrink-0" />
              {!isSidebarCollapsed && <span>Search</span>}
            </button>
            {BROWSE_CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.label}
                  type="button"
                  onClick={() => browserRef.current?.search(category.term)}
                  className={cn(
                    'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-xs font-medium text-[#CDBF9F]/70 transition hover:bg-[#E8DDC5]/8 hover:text-[#F7F4EC] cursor-pointer',
                    isSidebarCollapsed && 'justify-center px-0'
                  )}
                  title={category.label}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!isSidebarCollapsed && <span>{category.label}</span>}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-[#E8DDC5]/10 p-2">
            <button
              type="button"
              onClick={handleOpenLineup}
              className={cn(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-xs font-medium text-[#E8DDC5] transition hover:bg-[#E8DDC5]/8 cursor-pointer',
                isSidebarCollapsed && 'justify-center px-0'
              )}
              title="Open line-up"
            >
              <ListVideo className="h-4 w-4 shrink-0 text-[#B397FF]" />
              {!isSidebarCollapsed && (
                <>
                  <span>Line-up</span>
                  {selected.length > 0 && (
                    <span className="ml-auto rounded-full bg-[#E8DDC5] px-1.5 font-mono text-[9px] font-bold text-[#102B23]">
                      {selected.length}
                    </span>
                  )}
                </>
              )}
            </button>
            {!isSidebarCollapsed && (
              <p className="px-3 pb-1 pt-2 text-[9px] leading-relaxed text-[#CDBF9F]/40">
                Videos and metadata are provided by YouTube.
              </p>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-3 pb-28 pt-5 sm:px-5 lg:pb-10">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#9670FF]/85">
                Browse
              </p>
              <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-[#F7F4EC] sm:text-3xl">
                Explore YouTube
              </h1>
            </div>
            <p className="hidden max-w-[240px] text-right text-[11px] leading-relaxed text-[#CDBF9F]/55 md:block">
              Pick videos, arrange your line-up, then start one shared room.
            </p>
          </div>

          <YouTubeBrowser
            ref={browserRef}
            onSelect={handleSelect}
            selectedIds={selectedIds}
          />
        </main>

        <aside
          className={cn(
            'sticky top-28 hidden h-[calc(100dvh-7rem)] shrink-0 border-l border-[#E8DDC5]/10 transition-[width] duration-200 sm:top-[7.5rem] sm:h-[calc(100dvh-7.5rem)] lg:block',
            isLineupOpen ? 'w-[360px]' : 'w-12'
          )}
          aria-label="Watch party line-up"
        >
          {isLineupOpen ? (
            <LineupPanel
              inputId="desktop-room-name-input"
              selected={selected}
              roomTitle={roomTitle}
              error={error}
              isStarting={isStarting}
              onRemove={handleRemove}
              onClear={handleClear}
              onRoomTitleChange={setRoomTitle}
              onSubmit={handleStart}
              onClose={() => setIsLineupOpen(false)}
            />
          ) : (
            <div className="flex h-full flex-col items-center gap-3 border-l border-[#E8DDC5]/10 py-3">
              <button
                type="button"
                onClick={() => setIsLineupOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#B397FF] transition hover:bg-[#E8DDC5]/8 cursor-pointer"
                aria-label="Open line-up"
              >
                <ListVideo className="h-4 w-4" />
              </button>
              <span className="rotate-180 text-[9px] font-mono uppercase tracking-[0.2em] text-[#CDBF9F]/50 [writing-mode:vertical-rl]">
                Line-up
              </span>
              {selected.length > 0 && (
                <span className="rounded-full bg-[#E8DDC5] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#102B23]">
                  {selected.length}
                </span>
              )}
            </div>
          )}
        </aside>
      </div>

      {isMobileLineupOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm cursor-default"
            onClick={() => setIsMobileLineupOpen(false)}
            aria-label="Close line-up"
          />
          <div
            className="cinema-enter absolute inset-y-0 right-0 w-full max-w-[22rem] border-l border-[#E8DDC5]/15 shadow-[-18px_0_50px_rgba(0,0,0,0.4)]"
            role="dialog"
            aria-modal="true"
            aria-label="Watch party line-up"
          >
            <LineupPanel
              inputId="mobile-room-name-input"
              selected={selected}
              roomTitle={roomTitle}
              error={error}
              isStarting={isStarting}
              onRemove={handleRemove}
              onClear={handleClear}
              onRoomTitleChange={setRoomTitle}
              onSubmit={handleStart}
              onClose={() => setIsMobileLineupOpen(false)}
            />
          </div>
        </div>
      )}

      {selected.length > 0 && !isMobileLineupOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E8DDC5]/12 bg-[#0B2019]/95 px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setIsMobileLineupOpen(true)}
            className="mx-auto flex w-full max-w-3xl items-center gap-3 rounded-xl bg-[#E8DDC5] p-2 text-left text-[#102B23] transition hover:bg-[#F7F4EC] cursor-pointer"
          >
            <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md bg-[#102B23]/10">
              {firstSelected?.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={firstSelected.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <YouTubeIcon className="h-4 w-6 opacity-45" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                {selected.length} video{selected.length === 1 ? '' : 's'} in line-up
              </p>
              <p className="truncate text-[10px] text-[#173D30]/65">
                {firstSelected?.title}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#102B23] px-3 py-1.5 text-[10px] font-semibold text-[#F7F4EC]">
              Review
              <ChevronRight className="h-3 w-3" />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
