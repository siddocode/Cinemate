'use client';

import React from 'react';
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
} from 'lucide-react';
import { RoomMember, RoomQueueItem } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { extractYouTubeId } from '@/lib/utils/youtube';
import { formatTime } from '@/lib/utils/time';
import { cn } from '@/lib/utils/cn';
import { YouTubeIcon } from '@/components/common/YouTubeIcon';

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
  onAddVideos: () => void;
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
  onAddVideos,
}) => {
  if (!isOpen) return null;

  const currentYouTubeId =
    currentVideoType === 'youtube' ? extractYouTubeId(currentVideoUrl) : null;
  const currentThumbnail = currentYouTubeId
    ? `https://i.ytimg.com/vi/${currentYouTubeId}/mqdefault.jpg`
    : undefined;

  const resolveAddedBy = (userId: string) =>
    members.find((member) => member.userId === userId)?.username || 'A viewer';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-[#071611]/70 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-[#E8DDC5]/16 bg-[#0B1E17] shadow-[-24px_0_70px_rgba(0,0,0,0.55)] cinema-enter">
        <div className="flex items-center justify-between gap-3 border-b border-[#E8DDC5]/12 px-4 py-3.5">
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
            onClick={onClose}
            className="rounded-full p-1.5 text-[#CDBF9F] hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer"
            aria-label="Close watch queue"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
                onClick={onAddVideos}
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
                  onClick={onAddVideos}
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
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border border-[#E8DDC5]/12 bg-[#102B23]/75 p-2 transition-colors',
                        isBusy && 'opacity-65'
                      )}
                    >
                      <span className="w-4 shrink-0 text-center font-mono text-xs font-semibold text-[#CDBF9F]/80">
                        {index + 1}
                      </span>
                      <div className="h-11 w-[72px] shrink-0 overflow-hidden rounded-lg bg-[#071A13]">
                        <QueueThumbnail
                          src={item.thumbnailUrl}
                          videoType={item.videoType}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
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

        <div className="border-t border-[#E8DDC5]/12 px-4 py-3">
          <p className="text-center text-xs leading-relaxed text-[#CDBF9F]/85">
            Viewers can add and remove their own picks. The host or co-host controls
            what plays next.
          </p>
        </div>
      </aside>
    </div>
  );
};
