'use client';

import React, { useState, useEffect } from 'react';
import { ListPlus, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { YouTubeBrowser } from '@/components/youtube/YouTubeBrowser';
import { YouTubeVideoSummary } from '@/core/types/youtube.types';

interface YouTubeQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (videos: YouTubeVideoSummary[]) => Promise<void> | void;
  onBackToQueue?: () => void;
}

export const YouTubeQueueModal: React.FC<YouTubeQueueModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  onBackToQueue,
}) => {
  if (!isOpen) return null;
  return (
    <YouTubeQueueModalContent
      onClose={onClose}
      onAdd={onAdd}
      onBackToQueue={onBackToQueue}
    />
  );
};

const YouTubeQueueModalContent: React.FC<Omit<YouTubeQueueModalProps, 'isOpen'>> = ({
  onClose,
  onAdd,
  onBackToQueue,
}) => {
  const [selected, setSelected] = useState<YouTubeVideoSummary[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAdding) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isAdding]);

  const handleSelect = (video: YouTubeVideoSummary) => {
    setError(null);
    setSelected((prev) =>
      prev.some((item) => item.videoId === video.videoId)
        ? prev.filter((item) => item.videoId !== video.videoId)
        : [...prev, video]
    );
  };

  const handleAdd = async () => {
    if (selected.length === 0 || isAdding) return;
    setIsAdding(true);
    setError(null);
    try {
      await onAdd(selected);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add those videos.');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none" role="dialog" aria-modal="true">
      {/* Soft non-intrusive backdrop on mobile (tap to close); hidden on desktop so video remains clickable */}
      <div
        className="absolute inset-0 bg-[#071611]/45 backdrop-blur-[1px] transition-opacity drawer-backdrop pointer-events-auto lg:hidden"
        onClick={() => {
          if (!isAdding) onClose();
        }}
        aria-hidden="true"
      />

      {/* Wide cinema slide-over side drawer */}
      <aside className="relative z-10 flex h-full w-full max-w-lg lg:w-[32rem] xl:w-[36rem] lg:max-w-none flex-col border-l border-[#E8DDC5]/16 bg-[#0B1E17] shadow-[-28px_0_72px_rgba(0,0,0,0.65)] drawer-enter pointer-events-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#E8DDC5]/12 px-4 py-3.5 shrink-0 bg-[#0E281F]">
          <div className="flex items-center gap-2.5 min-w-0">
            {onBackToQueue ? (
              <button
                type="button"
                onClick={onBackToQueue}
                disabled={isAdding}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E8DDC5]/20 bg-[#173D30] text-[#E8DDC5] hover:border-[#9670FF]/50 hover:text-[#F7F4EC] transition-colors cursor-pointer disabled:opacity-50"
                title="Back to watch queue"
                aria-label="Back to watch queue"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#9670FF]/35 bg-[#9670FF]/12 text-[#B397FF]">
                <ListPlus className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-serif text-lg sm:text-xl font-semibold leading-tight text-[#F7F4EC] truncate">
                Add to Watch Queue
              </h2>
              <p className="text-xs text-[#CDBF9F]/85 truncate mt-0.5">
                Search YouTube or paste a link · Everyone can add
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isAdding}
            className="rounded-full p-1.5 text-[#CDBF9F] hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer shrink-0 disabled:opacity-40"
            aria-label="Close add to queue"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable YouTube Browser Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <YouTubeBrowser
            onSelect={handleSelect}
            selectedIds={selected.map((video) => video.videoId)}
          />

          {error && (
            <p className="rounded-xl border border-[#DC2626]/40 bg-[#2A1215] px-3 py-2 text-[13px] text-[#FCA5A5]">
              {error}
            </p>
          )}
        </div>

        {/* Sticky Floating Action Bar — Pinned at bottom, NEVER scrolled off-screen! */}
        <div className="shrink-0 border-t border-[#E8DDC5]/14 bg-[#0E281F]/95 backdrop-blur-md p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
          {selected.length > 0 && (
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#9670FF] px-1.5 font-mono text-xs font-bold text-[#0B1E18] shrink-0">
                  {selected.length}
                </span>
                <span className="text-xs text-[#F7F4EC] font-medium truncate">
                  {selected.length === 1
                    ? selected[0].title
                    : `${selected.length} videos selected`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-xs font-semibold text-[#B397FF] hover:text-[#D2C1FF] cursor-pointer shrink-0"
              >
                Clear
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghostSand"
              size="sm"
              onClick={onClose}
              disabled={isAdding}
              className="h-9 px-3.5"
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              isLoading={isAdding}
              disabled={selected.length === 0}
              onClick={() => void handleAdd()}
              leftIcon={<ListPlus className="w-4 h-4" />}
              className={`h-9 px-4 transition-all ${
                selected.length > 0
                  ? 'shadow-[0_0_20px_rgba(150,112,255,0.4)]'
                  : 'opacity-50'
              }`}
            >
              {selected.length > 0
                ? `Add ${selected.length} to Queue`
                : 'Select videos to add'}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
};
