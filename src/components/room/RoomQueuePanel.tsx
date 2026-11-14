'use client';

import React, { useState } from 'react';
import {
  X,
  ListVideo,
  Play,
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  Loader2,
  Film,
  AlertCircle,
  GripVertical,
  ArrowLeft,
  ListPlus,
} from 'lucide-react';
import { RoomMember, RoomQueueItem } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { YouTubeVideoSummary } from '@/core/types/youtube.types';
import { extractYouTubeId } from '@/lib/utils/youtube';
import { formatTime } from '@/lib/utils/time';
import { cn } from '@/lib/utils/cn';
import { YouTubeIcon } from '@/components/common/YouTubeIcon';
import { YouTubeBrowser } from '@/components/youtube/YouTubeBrowser';
import { Button } from '@/components/ui/Button';

interface RoomQueuePanelProps {
  isOpen: boolean;
  onClose: () => void;
  items: RoomQueueItem[];
  currentVideoUrl: string;
  currentVideoType: VideoSourceType;
  nowPlayingTitle?: string | null;
  canControl: boolean;
  currentUserId: string;
  members: RoomMember[];
  isLoading?: boolean;
  error?: string | null;
  busyItemId?: string | null;
  onPlay: (item: RoomQueueItem) => void;
  onRemove: (item: RoomQueueItem) => void;
  onMove: (item: RoomQueueItem, direction: 'up' | 'down') => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onAddVideos?: () => void;
  onAddVideosToQueue?: (videos: YouTubeVideoSummary[]) => Promise<void> | void;
}

function QueueThumbnail({
  src,
  videoType,
  className,
}: {
  src?: string;
  videoType: VideoSourceType;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" loading="lazy" className={cn('h-full w-full object-cover', className)} />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#173D30]">
      {videoType === 'youtube' ? (
        <YouTubeIcon className="w-4 h-4 text-[#E87A70]" />
      ) : (
        <Film className="w-4 h-4 text-[#CDBF9F]/60" />
      )}
    </div>
  );
}

export const RoomQueuePanel: React.FC<RoomQueuePanelProps> = ({
  isOpen,
  onClose,
  items,
  currentVideoUrl,
  currentVideoType,
  nowPlayingTitle,
  canControl,
  currentUserId,
  members,
  isLoading = false,
  error,
  busyItemId,
  onPlay,
  onRemove,
  onMove,
  onReorder,
  onAddVideos,
  onAddVideosToQueue,
}) => {
  const [view, setView] = useState<'queue' | 'add'>('queue');
  const [selectedVideos, setSelectedVideos] = useState<YouTubeVideoSummary[]>([]);
  const [isAddingVideos, setIsAddingVideos] = useState(false);
  const [addVideosError, setAddVideosError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const currentYouTubeId =
    currentVideoType === 'youtube' ? extractYouTubeId(currentVideoUrl) : null;
  const currentThumbnail = currentYouTubeId
    ? `https://i.ytimg.com/vi/${currentYouTubeId}/mqdefault.jpg`
    : undefined;

  const resolveAddedBy = (userId: string) =>
    members.find((member) => member.userId === userId)?.username || 'A viewer';

  const handleClose = () => {
    setView('queue');
    setSelectedVideos([]);
    setAddVideosError(null);
    onClose();
  };

  const handleSelectVideo = (video: YouTubeVideoSummary) => {
    setAddVideosError(null);
    setSelectedVideos((prev) =>
      prev.some((item) => item.videoId === video.videoId)
        ? prev.filter((item) => item.videoId !== video.videoId)
        : [...prev, video]
    );
  };

  const handleCommitAddVideos = async () => {
    if (selectedVideos.length === 0 || isAddingVideos) return;
    setIsAddingVideos(true);
    setAddVideosError(null);
    try {
      if (onAddVideosToQueue) {
        await onAddVideosToQueue(selectedVideos);
      }
      setSelectedVideos([]);
      setView('queue');
    } catch (err: unknown) {
      setAddVideosError(
        err instanceof Error ? err.message : 'Could not add those videos to queue.'
      );
    } finally {
      setIsAddingVideos(false);
    }
  };

  const handleOpenAddView = () => {
    if (onAddVideosToQueue) {
      setView('add');
    } else {
      onAddVideos?.();
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    if (!canControl || busyItemId) {
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    if (!canControl || busyItemId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    if (!canControl || busyItemId) return;
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();
    const sourceIdxStr = e.dataTransfer.getData('text/plain');
    const sourceIndex = sourceIdxStr !== '' ? Number(sourceIdxStr) : draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (
      sourceIndex !== null &&
      !isNaN(sourceIndex) &&
      sourceIndex !== targetIndex &&
      onReorder
    ) {
      onReorder(sourceIndex, targetIndex);
    }
  };

  const handleTouchStart = (index: number) => {
    if (!canControl || busyItemId) return;
    setDraggedIndex(index);
    setDragOverIndex(index);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (draggedIndex === null) return;
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = elem?.closest('[data-queue-index]');
    if (card) {
      const targetIdx = Number(card.getAttribute('data-queue-index'));
      if (!isNaN(targetIdx) && targetIdx !== dragOverIndex) {
        setDragOverIndex(targetIdx);
      }
    }
  };

  const handleTouchEnd = () => {
    if (
      draggedIndex !== null &&
      dragOverIndex !== null &&
      draggedIndex !== dragOverIndex &&
      onReorder
    ) {
      onReorder(draggedIndex, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleTouchCancel = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none" role="dialog" aria-modal="true">
      {/* Soft non-intrusive backdrop on mobile (tap to close); hidden on desktop so video remains clickable */}
      <div
        className="absolute inset-0 bg-[#071611]/45 backdrop-blur-[1px] transition-opacity drawer-backdrop pointer-events-auto lg:hidden"
        onClick={handleClose}
        aria-hidden="true"
      />
      <aside className="relative z-10 flex h-full w-full max-w-lg lg:w-[32rem] xl:w-[36rem] lg:max-w-none flex-col border-l border-[#E8DDC5]/16 bg-[#0B1E17] shadow-[-28px_0_72px_rgba(0,0,0,0.65)] drawer-enter pointer-events-auto">
        {view === 'add' ? (
          <div className="flex items-center justify-between gap-3 border-b border-[#E8DDC5]/12 px-4 py-3.5 shrink-0 bg-[#0E281F]">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedVideos([]);
                  setView('queue');
                }}
                disabled={isAddingVideos}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E8DDC5]/20 bg-[#173D30] text-[#E8DDC5] hover:border-[#9670FF]/50 hover:text-[#F7F4EC] transition-colors cursor-pointer disabled:opacity-50"
                title="Back to watch queue"
                aria-label="Back to watch queue"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
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
              onClick={handleClose}
              disabled={isAddingVideos}
              className="rounded-full p-1.5 text-[#CDBF9F] hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer shrink-0 disabled:opacity-40"
              aria-label="Close add to queue"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-b border-[#E8DDC5]/12 px-4 py-3.5 shrink-0 bg-[#0E281F]">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#9670FF]/35 bg-[#9670FF]/12 text-[#B397FF]">
                <ListVideo className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h2 className="font-serif text-xl font-semibold leading-tight text-[#F7F4EC]">
                  Watch queue
                </h2>
                <p className="mt-0.5 text-xs text-[#CDBF9F]/85">
                  {items.length === 0
                    ? 'Line up the next video'
                    : `${items.length} video${items.length === 1 ? '' : 's'} up next`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 text-[#CDBF9F] hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer"
              aria-label="Close watch queue"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {view === 'add' ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              <YouTubeBrowser
                onSelect={handleSelectVideo}
                selectedIds={selectedVideos.map((video) => video.videoId)}
              />

              {addVideosError && (
                <p className="rounded-xl border border-[#DC2626]/40 bg-[#2A1215] px-3 py-2 text-[13px] text-[#FCA5A5]">
                  {addVideosError}
                </p>
              )}
            </div>

            {/* Sticky Floating Action Bar — Pinned at bottom */}
            <div className="shrink-0 border-t border-[#E8DDC5]/14 bg-[#0E281F]/95 backdrop-blur-md p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
              {selectedVideos.length > 0 && (
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#9670FF] px-1.5 font-mono text-xs font-bold text-[#0B1E18] shrink-0">
                      {selectedVideos.length}
                    </span>
                    <span className="text-xs text-[#F7F4EC] font-medium truncate">
                      {selectedVideos.length === 1
                        ? selectedVideos[0].title
                        : `${selectedVideos.length} videos selected`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedVideos([])}
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
                  onClick={() => {
                    setSelectedVideos([]);
                    setView('queue');
                  }}
                  disabled={isAddingVideos}
                  className="h-9 px-3.5"
                >
                  Back to Queue
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  isLoading={isAddingVideos}
                  disabled={selectedVideos.length === 0}
                  onClick={() => void handleCommitAddVideos()}
                  leftIcon={<ListPlus className="w-4 h-4" />}
                  className={`h-9 px-4 transition-all ${
                    selectedVideos.length > 0
                      ? 'shadow-[0_0_20px_rgba(150,112,255,0.4)]'
                      : 'opacity-50'
                  }`}
                >
                  {selectedVideos.length > 0
                    ? `Add ${selectedVideos.length} to Queue`
                    : 'Select videos to add'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              {currentVideoUrl && (
                <section>
                  <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/85">
                    Now playing
                  </p>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[#9670FF]/30 bg-[#102B23] p-2.5">
                    <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-[#071A13]">
                      <QueueThumbnail src={currentThumbnail} videoType={currentVideoType} />
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-[#F7F4EC]">
                        {nowPlayingTitle ||
                          (currentVideoType === 'youtube'
                            ? 'YouTube video'
                            : 'Current video source')}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-[0.12em] text-[#7AD3A8]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#7AD3A8]" />
                        Host-synced
                      </p>
                    </div>
                  </div>
                </section>
              )}

              <section>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/85">
                    Up next
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAddView}
                    className="inline-flex items-center gap-1 rounded-full border border-[#9670FF]/40 px-2.5 py-1 text-xs font-semibold text-[#B397FF] hover:bg-[#9670FF]/12 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Add videos
                  </button>
                </div>

                {error && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-xl border border-[#E87A70]/30 bg-[#331B1A] px-2.5 py-2 text-xs text-[#F2B8B2]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {isLoading && (
                  <div className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-[#E8DDC5]/12 bg-[#102B23]/70 px-3 py-5 text-[13px] text-[#CDBF9F]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9670FF]" />
                    Loading queue…
                  </div>
                )}

                {!isLoading && items.length === 0 && (
                  <div className="mt-2 rounded-2xl border border-dashed border-[#E8DDC5]/18 bg-[#102B23]/55 p-5 text-center">
                    <ListVideo className="w-6 h-6 mx-auto text-[#CDBF9F]/40" />
                    <p className="mt-1.5 text-sm font-semibold text-[#F7F4EC]">
                      The queue is empty
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#CDBF9F]/85">
                      Anyone in the room can add YouTube videos. The host plays them in
                      order.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenAddView}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#7235A8] px-3 py-1.5 text-xs font-semibold text-[#F7F4EC] hover:bg-[#8342BE] transition-colors cursor-pointer"
                    >
                      <YouTubeIcon className="w-3.5 h-3.5" />
                      Find videos
                    </button>
                  </div>
                )}

            {!isLoading && items.length > 0 && (
              <div className="mt-2 space-y-2">
                {items.map((item, index) => {
                  const isBusy = busyItemId === item.id;
                  const canRemove = canControl || item.addedBy === currentUserId;
                  const isDragging = draggedIndex === index;
                  const isDragOver =
                    dragOverIndex === index &&
                    draggedIndex !== null &&
                    draggedIndex !== index;

                  return (
                    <div
                      key={item.id}
                      data-queue-index={index}
                      draggable={canControl && !isBusy}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnter={(e) => handleDragEnter(e, index)}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, index)}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-xl border p-2 transition-all duration-150',
                        canControl && !isBusy && 'cursor-grab active:cursor-grabbing',
                        isDragging &&
                          'opacity-40 scale-[0.98] border-dashed border-[#9670FF] bg-[#173D30]/40',
                        isDragOver &&
                          'border-[#9670FF] ring-2 ring-[#9670FF]/70 bg-[#173D30] shadow-[0_0_16px_rgba(150,112,255,0.3)] scale-[1.01]',
                        !isDragging &&
                          !isDragOver &&
                          'border-[#E8DDC5]/12 bg-[#102B23]/75 hover:border-[#E8DDC5]/24',
                        isBusy && 'opacity-65 pointer-events-none'
                      )}
                    >
                      <div className="flex shrink-0 items-center gap-1">
                        {canControl && (
                          <div
                            className="flex items-center justify-center p-0.5 text-[#CDBF9F]/40 group-hover:text-[#CDBF9F] active:text-[#9670FF] touch-none select-none cursor-grab active:cursor-grabbing transition-colors"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                            onTouchStart={() => handleTouchStart(index)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            onTouchCancel={handleTouchCancel}
                          >
                            <GripVertical className="w-3.5 h-3.5 shrink-0" />
                          </div>
                        )}
                        <span className="w-4 shrink-0 text-center font-mono text-xs font-semibold text-[#CDBF9F]/80">
                          {index + 1}
                        </span>
                      </div>
                      <div className="h-11 w-[72px] shrink-0 overflow-hidden rounded-lg bg-[#071A13] select-none pointer-events-none">
                        <QueueThumbnail
                          src={item.thumbnailUrl}
                          videoType={item.videoType}
                        />
                      </div>
                      <div className="min-w-0 flex-1 select-none">
                        <p className="line-clamp-2 text-xs font-semibold leading-snug text-[#F7F4EC]">
                          {item.title}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-[#CDBF9F]/85">
                          {item.channelTitle || resolveAddedBy(item.addedBy)}
                          {item.durationSeconds > 0
                            ? ` · ${formatTime(item.durationSeconds)}`
                            : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5">
                        {canControl && (
                          <>
                            <button
                              type="button"
                              onClick={() => onMove(item, 'up')}
                              disabled={index === 0 || isBusy}
                              className="rounded-md p-1 text-[#CDBF9F]/85 hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer disabled:opacity-25 disabled:pointer-events-none"
                              aria-label={`Move ${item.title} up`}
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onMove(item, 'down')}
                              disabled={index === items.length - 1 || isBusy}
                              className="rounded-md p-1 text-[#CDBF9F]/85 hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer disabled:opacity-25 disabled:pointer-events-none"
                              aria-label={`Move ${item.title} down`}
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onPlay(item)}
                          disabled={!canControl || isBusy}
                          className="rounded-md p-1.5 text-[#7AD3A8] hover:bg-[#173D30] transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                          title={canControl ? 'Play now' : 'Only the host can start playback'}
                          aria-label={`Play ${item.title}`}
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                        </button>
                        {canRemove && (
                          <button
                            type="button"
                            onClick={() => onRemove(item)}
                            disabled={isBusy}
                            className="rounded-md p-1 text-[#CDBF9F]/85 hover:bg-[#3A1E1C]/60 hover:text-[#F2B8B2] transition-colors cursor-pointer disabled:opacity-30"
                            aria-label={`Remove ${item.title} from queue`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-[#E8DDC5]/12 px-4 py-3 shrink-0">
          <p className="text-center text-xs leading-relaxed text-[#CDBF9F]/85">
            {canControl
              ? 'Drag items or use arrows to reorder the playlist. The host controls what plays next.'
              : 'Viewers can add and remove their own picks. The host controls what plays next.'}
          </p>
        </div>
      </>
    )}
      </aside>
    </div>
  );
};
