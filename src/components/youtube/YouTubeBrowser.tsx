'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Search,
  Loader2,
  Link2,
  Check,
  AlertCircle,
  ArrowRight,
  Plus,
  X,
} from 'lucide-react';
import { YouTubeVideoSummary } from '@/core/types/youtube.types';
import { extractYouTubeId } from '@/lib/utils/youtube';
import { YouTubeIcon } from '@/components/common/YouTubeIcon';
import { Button } from '@/components/ui/Button';
import { formatTime } from '@/lib/utils/time';
import { cn } from '@/lib/utils/cn';

export interface YouTubeBrowserHandle {
  search: (term: string) => void;
  focusSearch: () => void;
}

interface YouTubeBrowserProps {
  onSelect: (video: YouTubeVideoSummary) => void;
  selectedIds?: string[];
  className?: string;
}

const QUICK_SEARCHES = [
  'Music',
  'Gaming',
  'Movies',
  'Comedy',
  'Podcasts',
  'Documentaries',
  'Lo-fi',
  'Trailers',
];

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

function errorMessageFor(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'YOUTUBE_NOT_CONFIGURED':
      return 'YouTube search is not configured on this server yet. Paste a YouTube link below to continue.';
    case 'YOUTUBE_QUOTA_EXCEEDED':
      return 'YouTube search quota is exhausted for today. Paste a YouTube link below instead.';
    case 'YOUTUBE_RATE_LIMITED':
      return 'Searching too quickly. Wait a few seconds, then try again.';
    case 'YOUTUBE_EMBED_DISABLED':
    case 'YOUTUBE_PRIVATE':
    case 'YOUTUBE_NOT_FOUND':
      return 'That video cannot be watched together. Try a different video.';
    default:
      return fallback;
  }
}

export const YouTubeBrowser = forwardRef<YouTubeBrowserHandle, YouTubeBrowserProps>(
  function YouTubeBrowser({ onSelect, selectedIds = [], className }, ref) {
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [activeChip, setActiveChip] = useState<string | null>('All');
    const [lastQuery, setLastQuery] = useState('');
    const [results, setResults] = useState<YouTubeVideoSummary[]>([]);
    const [nextPageToken, setNextPageToken] = useState<string | undefined>();
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);

    const [showLinkFallback, setShowLinkFallback] = useState(false);
    const [linkInput, setLinkInput] = useState('');
    const [isCheckingLink, setIsCheckingLink] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);

    const selectedSet = new Set(selectedIds);

    const runSearch = useCallback(
      async (searchQuery: string, pageToken?: string) => {
        const trimmed = searchQuery.trim();
        if (!trimmed) {
          setSearchError('Type a search term or pick a category.');
          return;
        }

        if (pageToken) {
          setIsLoadingMore(true);
        } else {
          setIsSearching(true);
          setLastQuery(trimmed);
          setResults([]);
          setNextPageToken(undefined);
        }
        setSearchError(null);
        setHasSearched(true);

        try {
          const params = new URLSearchParams({ q: trimmed, maxResults: '12' });
          if (pageToken) params.set('pageToken', pageToken);
          const response = await fetch(`/api/youtube/search?${params.toString()}`);
          const payload = (await response.json().catch(() => ({}))) as
            | { items?: YouTubeVideoSummary[]; nextPageToken?: string }
            | ApiErrorPayload;

          if (!response.ok) {
            const errorPayload = payload as ApiErrorPayload;
            setSearchError(
              errorMessageFor(
                errorPayload.error,
                errorPayload.message || 'YouTube search failed. Please try again.'
              )
            );
            return;
          }

          const data = payload as { items?: YouTubeVideoSummary[]; nextPageToken?: string };
          const items = data.items || [];
          setResults((prev) => (pageToken ? [...prev, ...items] : items));
          setNextPageToken(data.nextPageToken);
        } catch {
          setSearchError('Could not reach the server. Check your connection and try again.');
        } finally {
          setIsSearching(false);
          setIsLoadingMore(false);
        }
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        search: (term: string) => {
          const trimmed = term.trim();
          if (!trimmed) return;
          setQuery(trimmed);
          setActiveChip(term);
          void runSearch(trimmed);
        },
        focusSearch: () => {
          searchInputRef.current?.focus();
          searchInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        },
      }),
      [runSearch]
    );

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        const isTyping =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target?.isContentEditable;

        if (event.key === '/' && !isTyping) {
          event.preventDefault();
          searchInputRef.current?.focus();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSearchSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      setActiveChip(null);
      void runSearch(query);
    };

    const handleQuickSearch = (term: string) => {
      setQuery(term);
      setActiveChip(term);
      void runSearch(term);
    };

    const handleShowAll = () => {
      if (isSearching) return;
      setQuery('');
      setActiveChip('All');
      setResults([]);
      setNextPageToken(undefined);
      setSearchError(null);
      setHasSearched(false);
      setLastQuery('');
    };

    const handleLinkSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = linkInput.trim();
      if (!trimmed) {
        setLinkError('Paste a YouTube URL or video ID.');
        return;
      }

      if (!extractYouTubeId(trimmed)) {
        setLinkError(
          'That does not look like a YouTube link. Try a watch, shorts, live, or youtu.be URL.'
        );
        return;
      }

      setIsCheckingLink(true);
      setLinkError(null);

      try {
        const response = await fetch(
          `/api/youtube/videos?url=${encodeURIComponent(trimmed)}`
        );
        const payload = (await response.json().catch(() => ({}))) as
          | { item?: YouTubeVideoSummary; items?: YouTubeVideoSummary[] }
          | ApiErrorPayload;

        if (!response.ok) {
          const errorPayload = payload as ApiErrorPayload;
          setLinkError(
            errorMessageFor(
              errorPayload.error,
              errorPayload.message || 'That YouTube link could not be loaded.'
            )
          );
          return;
        }

        const item = (payload as { item?: YouTubeVideoSummary }).item;
        if (!item) {
          setLinkError('That YouTube link could not be loaded. Try another video.');
          return;
        }

        onSelect(item);
        setLinkInput('');
        setShowLinkFallback(false);
      } catch {
        setLinkError('Could not check that link. Check your connection and try again.');
      } finally {
        setIsCheckingLink(false);
      }
    };

    return (
      <div className={cn('w-full', className)}>
        <form onSubmit={handleSearchSubmit} className="flex w-full items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#CDBF9F]/60" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search YouTube videos, creators, or moods"
              maxLength={120}
              enterKeyHint="search"
              autoComplete="off"
              className="h-11 w-full rounded-full border border-[#E8DDC5]/18 bg-[#0B1E17] pl-11 pr-11 text-sm text-[#F7F4EC] placeholder:text-[#CDBF9F]/65 transition focus:border-[#9670FF]/65 focus:outline-none focus:ring-2 focus:ring-[#9670FF]/20"
              aria-label="Search YouTube"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#CDBF9F]/65 transition hover:bg-[#E8DDC5]/10 hover:text-[#F7F4EC] cursor-pointer"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isSearching}
            className="h-11 shrink-0 rounded-full px-4 sm:px-5"
          >
            <span className="hidden sm:inline">Search</span>
            <span className="sm:hidden">Go</span>
          </Button>
        </form>

        <div className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={handleShowAll}
            disabled={isSearching}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50',
              activeChip === 'All'
                ? 'border-[#E8DDC5] bg-[#E8DDC5] text-[#102B23]'
                : 'border-[#E8DDC5]/14 bg-[#173D30]/65 text-[#E8DDC5] hover:border-[#E8DDC5]/35 hover:bg-[#173D30]'
            )}
          >
            All
          </button>
          {QUICK_SEARCHES.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => handleQuickSearch(term)}
              disabled={isSearching}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50',
                activeChip === term
                  ? 'border-[#E8DDC5] bg-[#E8DDC5] text-[#102B23]'
                  : 'border-[#E8DDC5]/14 bg-[#173D30]/65 text-[#E8DDC5] hover:border-[#E8DDC5]/35 hover:bg-[#173D30]'
              )}
            >
              {term}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#CDBF9F]/85">
          <span className="inline-flex items-center gap-1.5">
            <YouTubeIcon className="h-3.5 w-5" />
            Search results from YouTube
          </span>
          <button
            type="button"
            onClick={() => {
              setShowLinkFallback((prev) => !prev);
              setLinkError(null);
            }}
            className="inline-flex items-center gap-1.5 font-medium text-[13px] text-[#B397FF] transition hover:text-[#D2C1FF] cursor-pointer"
          >
            <Link2 className="h-3.5 w-3.5" />
            Paste a link instead
          </button>
        </div>

        {showLinkFallback && (
          <form
            onSubmit={handleLinkSubmit}
            className="mt-3 rounded-2xl border border-[#E8DDC5]/14 bg-[#0B1E17] p-3 sm:p-4"
          >
            <label
              htmlFor="youtube-link-fallback"
              className="text-xs font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/90"
            >
              YouTube link or video ID
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="youtube-link-fallback"
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="off"
                className="h-10 flex-1 rounded-full border border-[#E8DDC5]/18 bg-[#071A13] px-4 text-sm text-[#F7F4EC] placeholder:text-[#CDBF9F]/65 focus:border-[#9670FF]/65 focus:outline-none focus:ring-2 focus:ring-[#9670FF]/20"
              />
              <Button
                type="submit"
                variant="secondary"
                size="md"
                isLoading={isCheckingLink}
                className="rounded-full"
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Check &amp; select
              </Button>
            </div>
            {linkError && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-[#F2B8B2]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{linkError}</span>
              </p>
            )}
          </form>
        )}

        {searchError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#E9B872]/25 bg-[#292214]/80 px-3 py-2.5 text-xs text-[#F0C987]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{searchError}</span>
          </div>
        )}

        {isSearching && (
          <>
            <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="animate-pulse">
                  <div className="aspect-video rounded-xl bg-[#173D30]" />
                  <div className="mt-2.5 flex gap-2.5">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-[#173D30]" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                      <div className="h-3 w-11/12 rounded bg-[#173D30]" />
                      <div className="h-2.5 w-2/5 rounded bg-[#173D30]/70" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[#CDBF9F]/85">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9670FF]" />
              Searching YouTube…
            </div>
          </>
        )}

        {!isSearching && results.length > 0 && (
          <>
            <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">
              {results.map((video) => {
                const isSelected = selectedSet.has(video.videoId);
                return (
                  <button
                    key={video.videoId}
                    type="button"
                    onClick={() => onSelect(video)}
                    className="group min-w-0 text-left cursor-pointer"
                    aria-pressed={isSelected}
                    title={isSelected ? `Remove ${video.title} from line-up` : `Add ${video.title} to line-up`}
                  >
                    <div
                      className={cn(
                        'relative aspect-video overflow-hidden rounded-xl border bg-[#071A13] transition',
                        isSelected
                          ? 'border-[#9670FF] ring-2 ring-[#9670FF]/30'
                          : 'border-[#E8DDC5]/10 group-hover:border-[#E8DDC5]/25'
                      )}
                    >
                      {video.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={video.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <YouTubeIcon className="h-8 w-12 opacity-45" />
                        </div>
                      )}
                      {video.durationSeconds > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-tight text-white">
                          {formatTime(video.durationSeconds)}
                        </span>
                      )}
                      {/* Persistent add affordance — always visible, no hover/scroll needed */}
                      <span
                        className={cn(
                          'absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition',
                          isSelected
                            ? 'bg-[#9670FF] text-[#0B1E18]'
                            : 'bg-[#0B1E17]/92 text-[#F7F4EC] border border-[#E8DDC5]/25 group-hover:border-[#9670FF]/60'
                        )}
                      >
                        {isSelected ? (
                          <>
                            <Check className="h-3 w-3" />
                            Added
                          </>
                        ) : (
                          <>
                            <Plus className="h-3 w-3" />
                            Add
                          </>
                        )}
                      </span>
                      <span
                        className={cn(
                          'absolute inset-0 flex items-center justify-center bg-[#071A13]/35 opacity-0 transition-opacity group-hover:opacity-100'
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0B1E17]/92 px-3 py-1.5 text-xs font-semibold text-[#F7F4EC] shadow-lg backdrop-blur-sm">
                          {isSelected ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#B397FF]" />
                              In line-up
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5 text-[#B397FF]" />
                              Add to queue
                            </>
                          )}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#9670FF] text-[#0B1E18] shadow">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2.5 flex items-start gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#173D30] text-xs font-semibold uppercase text-[#E8DDC5]">
                        {(video.channelTitle || 'Y').charAt(0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug text-[#F7F4EC] transition-colors group-hover:text-white">
                          {video.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[#CDBF9F]/85">
                          {video.channelTitle || 'YouTube'}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {nextPageToken && (
              <div className="mt-6 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isLoading={isLoadingMore}
                  onClick={() => void runSearch(lastQuery, nextPageToken)}
                  className="rounded-full px-4"
                >
                  Show more
                </Button>
              </div>
            )}
          </>
        )}

        {!isSearching && hasSearched && results.length === 0 && !searchError && (
          <div className="mt-10 flex flex-col items-center px-4 text-center">
            <Search className="h-8 w-8 text-[#CDBF9F]/35" />
            <p className="mt-3 text-sm font-semibold text-[#F7F4EC]">No playable videos found</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-[#CDBF9F]/90">
              Try a broader search, another category, or paste a YouTube link directly.
            </p>
            <button
              type="button"
              onClick={() => setShowLinkFallback(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#E8DDC5]/18 px-3.5 py-1.5 text-[13px] font-medium text-[#B397FF] transition hover:border-[#9670FF]/45 hover:text-[#D2C1FF] cursor-pointer"
            >
              <Link2 className="h-3.5 w-3.5" />
              Paste a link
            </button>
          </div>
        )}

        {!hasSearched && !isSearching && (
          <div className="mt-10 flex flex-col items-center px-4 text-center">
            <YouTubeIcon className="h-10 w-14" />
            <h2 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-[#F7F4EC]">
              Find something for the room
            </h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[#CDBF9F]/90">
              Search YouTube above, or start with one of these. Selected videos stay in
              order in your shared line-up.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {['Movie trailers', 'Live concert', 'Lo-fi study mix'].map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => handleQuickSearch(term)}
                  className="rounded-full border border-[#E8DDC5]/14 bg-[#173D30]/60 px-3.5 py-1.5 text-[13px] text-[#E8DDC5] transition hover:border-[#9670FF]/45 hover:text-[#F7F4EC] cursor-pointer"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-1.5 border-t border-[#E8DDC5]/12 pt-3 text-xs leading-relaxed text-[#CDBF9F]/85 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Results and metadata from YouTube. Playback uses the official embedded
            player.
          </span>
          <a
            href="https://www.youtube.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#CDBF9F]/85 transition hover:text-[#E8DDC5]"
          >
            youtube.com
          </a>
        </div>
      </div>
    );
  }
);

YouTubeBrowser.displayName = 'YouTubeBrowser';
