'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Play, Trash2, Tv, Link2, Upload, Film } from 'lucide-react';
import { roomService } from '@/lib/services/roomService';
import { UserRoomSummary } from '@/core/types/room.types';
import { useSession } from '@/hooks/useSession';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import {
  REOPEN_ROOM_BUTTON_STAGES,
  useLoadingStages,
} from '@/hooks/useLoadingStages';

function formatRelativeDate(isoDate: string): string {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return 'Recently active';
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

interface RecentRoomsSectionProps {
  isExternalNavigating?: boolean;
  onStartNavigation?: () => void;
  externalRooms?: UserRoomSummary[];
  isExternalLoading?: boolean;
  onRoomsChange?: React.Dispatch<React.SetStateAction<UserRoomSummary[]>>;
}

export const RecentRoomsSection: React.FC<RecentRoomsSectionProps> = ({
  isExternalNavigating = false,
  onStartNavigation,
  externalRooms,
  isExternalLoading,
  onRoomsChange,
}) => {
  const router = useRouter();
  const { user, isAuthenticated } = useSession();
  const [internalRooms, setInternalRooms] = useState<UserRoomSummary[]>([]);
  const [isInternalLoading, setIsInternalLoading] = useState(true);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [exitingRoomId, setExitingRoomId] = useState<string | null>(null);
  const [openingRoomId, setOpeningRoomId] = useState<string | null>(null);

  const usesExternalData = externalRooms !== undefined;
  const rooms = usesExternalData
    ? externalRooms.filter((r) => r.hostId === user.id)
    : internalRooms;
  const isLoading = usesExternalData
    ? Boolean(isExternalLoading)
    : isInternalLoading;

  useEffect(() => {
    if (usesExternalData) {
      return;
    }

    if (!isAuthenticated || !user.id) {
      return;
    }

    let isMounted = true;
    roomService
      .getUserRooms(user.id)
      .then((items) => {
        if (isMounted) {
          setInternalRooms(items.filter((r) => r.hostId === user.id));
          setIsInternalLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setInternalRooms([]);
          setIsInternalLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [user.id, isAuthenticated, usesExternalData]);

  const isNavigating = isExternalNavigating || openingRoomId !== null;
  const isActionLocked = isNavigating || deletingRoomId !== null || exitingRoomId !== null;
  const { stage: reopenButtonStage } = useLoadingStages(
    openingRoomId !== null,
    REOPEN_ROOM_BUTTON_STAGES
  );

  const handleOpenRoom = (room: UserRoomSummary) => {
    if (isNavigating || deletingRoomId !== null) return;
    if (exitingRoomId !== null) return;
    setOpeningRoomId(room.id);
    onStartNavigation?.();
    router.push(`/room/${room.code}`);
  };

  const handleRemoveRoom = async (
    room: UserRoomSummary,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (isNavigating || deletingRoomId !== null) return;
    if (exitingRoomId !== null) return;
    setDeletingRoomId(room.id);
    try {
      const isHost = room.hostId === user.id;
      const removed = await roomService.leaveOrDeleteRoom(room.id, user.id, isHost);
      if (removed) {
        // Trigger smooth dissolve/collapse animation before removing from DOM
        setExitingRoomId(room.id);
        setTimeout(() => {
          const updateRooms = onRoomsChange ?? setInternalRooms;
          updateRooms((prev) => prev.filter((r) => r.id !== room.id));
          setExitingRoomId((prev) => (prev === room.id ? null : prev));
          setDeletingRoomId((prev) => (prev === room.id ? null : prev));
        }, 220);
      } else {
        setDeletingRoomId(null);
      }
    } catch {
      setDeletingRoomId(null);
    }
  };

  if (!isAuthenticated || (!isLoading && rooms.length === 0)) {
    return null;
  }

  const getVideoSourceBadge = (room: UserRoomSummary) => {
    if (!room.videoUrl) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-[#CDBF9F]/90">
          <Film className="w-3 h-3" />
          No video yet
        </span>
      );
    }
    if (room.videoType === 'youtube') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-[#E8DDC5]">
          <Tv className="w-3 h-3 text-[#9670FF]" />
          YouTube
        </span>
      );
    }
    if (room.videoType === 'upload') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-[#E8DDC5]">
          <Upload className="w-3 h-3 text-[#9670FF]" />
          Uploaded Video
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[#E8DDC5]">
        <Link2 className="w-3 h-3 text-[#9670FF]" />
        Direct Stream
      </span>
    );
  };

  return (
    <section className="w-full max-w-5xl border-t border-[#E8DDC5]/12 pt-5 mt-6 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#E8DDC5]" />
          <h2 className="font-serif text-xl sm:text-2xl font-medium tracking-tight text-[#F7F4EC]">
            Your Recent Rooms
          </h2>
        </div>
        {!isLoading && (
          <span className="text-xs font-mono uppercase tracking-[0.14em] text-[#CDBF9F]">
            {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="bg-[#173D30]/80 border border-[#E8DDC5]/12 rounded-xl p-3.5 space-y-2.5 animate-pulse"
            >
              <div className="h-4 w-2/3 rounded bg-[#0E281F]" />
              <div className="h-3 w-1/2 rounded bg-[#0E281F]" />
              <div className="h-8 w-full rounded-lg bg-[#0E281F]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rooms.map((room) => {
            const isHost = room.hostId === user.id;
            const isDeletingThisRoom = deletingRoomId === room.id;
            const isExitingThisRoom = exitingRoomId === room.id;
            return (
              <article
                key={room.id}
                className={cn(
                  'relative overflow-hidden rounded-xl p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 transition-all duration-200',
                  isExitingThisRoom
                    ? 'opacity-0 scale-95 -translate-y-1.5 blur-[1px] pointer-events-none'
                    : isDeletingThisRoom
                    ? 'bg-[#181111]/90 border border-[#E87A70]/40 shadow-[0_4px_24px_rgba(232,122,112,0.14)] pointer-events-none'
                    : 'bg-[#173D30]/75 border border-[#E8DDC5]/16 hover:border-[#E8DDC5]/35 hover:bg-[#173D30]/95'
                )}
              >
                {/* Cinema Deletion Overlay */}
                {isDeletingThisRoom && (
                  <div
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#091B15]/92 backdrop-blur-[2px] rounded-xl text-center p-3 cinema-enter"
                    role="status"
                    aria-live="polite"
                  >
                    {/* Architectural cinema dual-ring spinner */}
                    <div className="relative flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full border-2 border-[#E8DDC5]/15 border-t-[#F2B8B2] border-r-[#F2B8B2]/60 animate-spin" />
                      <div className="absolute w-2 h-2 rounded-full bg-[#F2B8B2] shadow-[0_0_8px_#F2B8B2] animate-pulse" />
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                      <span className="font-mono text-xs uppercase tracking-[0.16em] text-[#F2B8B2] font-semibold">
                        {isHost ? 'Deleting Room…' : 'Leaving Room…'}
                      </span>
                      <span className="text-[11px] text-[#CDBF9F]/75 font-sans">
                        {isHost ? 'Releasing screening & queue' : 'Removing from shelf'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenRoom(room)}
                    disabled={isActionLocked}
                    className="min-w-0 flex-1 text-left cursor-pointer disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9670FF] rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[#F7F4EC] truncate">
                        {room.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[11px] font-mono font-semibold bg-[#E8DDC5] text-[#102B23] px-2 py-0.5 rounded-full">
                        {room.code}
                      </span>
                      <Badge variant={isHost ? 'purple' : 'default'}>
                        {isHost ? 'Host' : 'Member'}
                      </Badge>
                      <span
                        suppressHydrationWarning
                        className="font-mono text-[11px] text-[#CDBF9F]/85 ml-auto sm:ml-0"
                      >
                        {formatRelativeDate(room.lastSyncedAt)}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => void handleRemoveRoom(room, e)}
                    disabled={isActionLocked}
                    className={cn(
                      'min-w-[36px] min-h-[36px] sm:min-w-[30px] sm:min-h-[30px] flex items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0 disabled:opacity-45 disabled:pointer-events-none',
                      isDeletingThisRoom
                        ? 'bg-[#3A1E1C] border-[#E87A70]/50 text-[#F2B8B2]'
                        : 'bg-[#0E281F]/80 hover:bg-[#3A1E1C] border-[#E8DDC5]/14 text-[#CDBF9F] hover:text-[#F2B8B2]'
                    )}
                    title={isHost ? 'Delete room' : 'Leave room'}
                    aria-label={isHost ? `Delete ${room.title}` : `Leave ${room.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E8DDC5]/10">
                  <div className="min-w-0 truncate text-xs">
                    {getVideoSourceBadge(room)}
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleOpenRoom(room);
                    }}
                    isLoading={openingRoomId === room.id}
                    disabled={isActionLocked}
                    className="h-7 px-3 text-xs shrink-0 rounded-lg"
                    leftIcon={<Play className="w-3 h-3 fill-current" />}
                  >
                    {openingRoomId === room.id
                      ? reopenButtonStage.label
                      : 'Reopen'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

