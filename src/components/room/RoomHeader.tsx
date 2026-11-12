'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Check,
  Film,
  LogOut,
  AlertTriangle,
  Star,
  MessageSquare,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Headphones,
  Loader2,
  Users,
  Share2,
  MoreHorizontal,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DuoStatus, ParticipantPresence, Room } from '@/core/types/room.types';
import { CallParticipantState, CallStatus } from '@/core/types/call.types';
import { CALL_CONSTANTS, SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { useSession } from '@/hooks/useSession';
import { favoriteService } from '@/lib/services/favoriteService';
import { copyTextToClipboard, shareOrCopyInvite } from '@/lib/utils/share';

export interface RoomHeaderVoiceProps {
  status: CallStatus;
  isInCall: boolean;
  isLeaving?: boolean;
  isCallFull: boolean;
  canStartCall?: boolean;
  isMuted: boolean;
  isLocalSpeaking: boolean;
  isPeerSpeaking: boolean;
  incomingCaller: CallParticipantState | null;
  participantCount: number;
  onJoinCall: () => void;
  onLeaveCall: () => Promise<void> | void;
  onToggleMute: () => void;
}

interface RoomHeaderProps {
  room: Room;
  isHost: boolean;
  isCoHost?: boolean;
  canControl?: boolean;
  duoStatus: DuoStatus;
  presenceList?: ParticipantPresence[];
  hostGraceSecondsLeft: number | null;
  onChangeVideoClick: () => void;
  onOpenParticipants?: () => void;
  onCloseRoom?: () => Promise<void>;
  isChatOpen?: boolean;
  onToggleChat?: () => void;
  voiceCall?: RoomHeaderVoiceProps;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  room,
  isHost,
  isCoHost,
  canControl,
  duoStatus,
  presenceList,
  hostGraceSecondsLeft,
  onChangeVideoClick,
  onOpenParticipants,
  onCloseRoom,
  isChatOpen = true,
  onToggleChat,
  voiceCall,
}) => {
  const router = useRouter();
  const { user, isAuthenticated } = useSession();
  const [copied, setCopied] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [isFavLoading, setIsFavLoading] = useState(false);
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        mobileMenuRef.current &&
        event.target instanceof Node &&
        !mobileMenuRef.current.contains(event.target)
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (isAuthenticated && user.id && room.videoUrl) {
      favoriteService.isFavorite(user.id, room.videoUrl).then((fav) => {
        setIsFav(fav);
      });
    }
  }, [isAuthenticated, user.id, room.videoUrl]);

  const handleCopyLink = async () => {
    if (typeof window !== 'undefined') {
      const copiedOk = await copyTextToClipboard(window.location.href);
      if (copiedOk) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleShareInvite = async () => {
    if (typeof window === 'undefined') return;
    const outcome = await shareOrCopyInvite({
      roomTitle: room.title,
      roomCode: room.code,
      url: window.location.href,
    });
    if (outcome === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeaveRoom = async () => {
    if (isLeavingRoom) return;
    setIsLeavingRoom(true);
    try {
      if (voiceCall?.isInCall) {
        await voiceCall.onLeaveCall();
      }
      if (isHost && onCloseRoom) {
        await onCloseRoom();
      }
      router.push('/');
    } catch {
      setIsLeavingRoom(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!isAuthenticated || !user.id || !room.videoUrl || isFavLoading) return;

    setIsFavLoading(true);
    try {
      if (isFav) {
        await favoriteService.removeFavorite(user.id, room.videoUrl);
        setIsFav(false);
      } else {
        await favoriteService.addFavorite(user.id, {
          roomCode: room.code,
          videoId: room.videoUrl,
          videoTitle: room.title || 'Watch Party Video',
        });
        setIsFav(true);
      }
    } finally {
      setIsFavLoading(false);
    }
  };

  const others = presenceList
    ? presenceList.filter((p) => p.userId !== user.id)
    : duoStatus.partner
    ? [duoStatus.partner]
    : [];
  const totalOnline = 1 + others.length;
  const otherNames = others.map((p) => p.username).join(', ');

  const renderVoiceControls = (compactMobile: boolean) => {
    if (!voiceCall) return null;

    if (voiceCall.isInCall) {
      return (
        <div className="flex items-center gap-1 bg-[#133227] border border-[#E8DDC5]/18 rounded-full px-1.5 py-0.5">
          <span
            className={`w-2 h-2 rounded-full ml-1 shrink-0 ${
              voiceCall.isLocalSpeaking || voiceCall.isPeerSpeaking
                ? 'bg-[#7AD3A8] animate-pulse shadow-[0_0_8px_#7AD3A8]'
                : voiceCall.status === 'reconnecting'
                ? 'bg-[#E9B872] animate-pulse'
                : 'bg-[#7AD3A8]/70'
            }`}
            title={`Voice ${voiceCall.participantCount}/${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS} (${voiceCall.status})`}
          />
          {!compactMobile && (
            <span className="hidden xl:inline text-[11px] font-mono text-[#E8DDC5] px-1 whitespace-nowrap">
              {voiceCall.status === 'connected'
                ? `Voice Call ${voiceCall.participantCount}/${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}`
                : voiceCall.status === 'reconnecting'
                ? 'Reconnecting'
                : voiceCall.status === 'connecting'
                ? 'Connecting'
                : `Voice Call 1/${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}`}
            </span>
          )}
          <button
            type="button"
            onClick={voiceCall.onToggleMute}
            disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
            className={`h-6.5 w-6.5 sm:h-7 sm:w-7 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-45 disabled:pointer-events-none ${
              voiceCall.isMuted
                ? 'bg-[#3A1E1C] text-[#F2B8B2]'
                : 'hover:bg-[#1E4B3C] text-[#7AD3A8]'
            }`}
            title={voiceCall.isMuted ? 'Unmute mic' : 'Mute mic'}
            aria-label={voiceCall.isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {voiceCall.isMuted ? (
              <MicOff className="w-3.5 h-3.5" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void voiceCall.onLeaveCall()}
            disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
            className="h-6.5 w-6.5 sm:h-7 sm:w-7 rounded-full flex items-center justify-center text-[#F2B8B2] hover:bg-[#3A1E1C] transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
            title={isHost ? 'End voice call for everyone' : 'Leave voice call'}
            aria-label={isHost ? 'End voice call for everyone' : 'Leave voice call'}
          >
            {voiceCall.isLeaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PhoneOff className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      );
    }

    if (voiceCall.isCallFull) {
      return compactMobile ? (
        <span
          className="h-8 px-2.5 rounded-full bg-[#173D30] border border-[#E8DDC5]/18 text-[11px] font-mono text-[#CDBF9F] inline-flex items-center gap-1 whitespace-nowrap"
          title={`Voice call is limited to ${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS} participants`}
        >
          <Headphones className="w-3 h-3 text-[#9670FF]" />
          <span>
            {CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}/{CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}
          </span>
        </span>
      ) : (
        <Badge
          variant="default"
          className="h-8 text-[11px] px-2.5 inline-flex whitespace-nowrap"
          title={`Voice call is limited to ${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS} participants`}
        >
          <Headphones className="w-3 h-3 text-[#9670FF]" />
          <span>
            Voice {CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}/{CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}
          </span>
        </Badge>
      );
    }

    if (voiceCall.incomingCaller) {
      return (
        <Button
          variant="accent"
          size="sm"
          onClick={voiceCall.onJoinCall}
          isLoading={voiceCall.status === 'joining'}
          disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
          className="h-8 text-[11px] sm:text-xs px-2.5 sm:px-3 rounded-full whitespace-nowrap"
          leftIcon={<PhoneCall className="w-3.5 h-3.5 animate-pulse" />}
          title="Join audio-only voice call"
          aria-label="Join audio-only voice call"
        >
          {compactMobile
            ? voiceCall.status === 'joining'
              ? 'Joining…'
              : 'Join Voice'
            : voiceCall.status === 'joining'
            ? 'Joining…'
            : `Join Voice · ${voiceCall.incomingCaller.username}`}
        </Button>
      );
    }

    if (voiceCall.canStartCall === false) {
      return compactMobile ? (
        <button
          type="button"
          disabled
          className="h-8 w-8 rounded-full bg-[#173D30]/75 border border-[#E8DDC5]/15 text-[#CDBF9F]/70 inline-flex items-center justify-center opacity-60 cursor-not-allowed"
          title="Only the room host or permitted members can start a voice call. You can join once it begins."
          aria-label="Host starts voice call"
        >
          <MicOff className="w-3.5 h-3.5" />
        </button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled
          className="h-8 text-xs px-3 rounded-full whitespace-nowrap opacity-65"
          leftIcon={<MicOff className="w-3.5 h-3.5 text-[#CDBF9F]" />}
          title="Only the room host or permitted members can start a voice call. You can join once it begins."
          aria-label="Host starts voice call"
        >
          Host Starts Voice
        </Button>
      );
    }

    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={voiceCall.onJoinCall}
        isLoading={voiceCall.status === 'joining'}
        disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
        className="h-8 text-[11px] sm:text-xs px-2.5 sm:px-3 rounded-full whitespace-nowrap"
        leftIcon={<Mic className="w-3.5 h-3.5 text-[#9670FF]" />}
        title="Start audio-only voice call (no camera)"
        aria-label="Join voice call"
      >
        {voiceCall.status === 'joining'
          ? 'Joining…'
          : compactMobile
          ? 'Voice'
          : 'Voice Call'}
      </Button>
    );
  };

  return (
    <div className="shrink-0 flex flex-col border-b border-[#E8DDC5]/12 bg-[#0E281F]">
      {/* Disconnect Notice Banner if Host Disconnected */}
      {hostGraceSecondsLeft !== null && (
        <div className="bg-[#292214] border-b border-[#E9B872]/30 px-3 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#F0C987]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#E9B872] shrink-0" />
            <span>
              <strong className="font-semibold">Host disconnected.</strong> Room will
              close unless host reconnects.
            </span>
          </div>
          <span className="font-mono text-[11px] font-semibold bg-[#0E281F] border border-[#E9B872]/35 px-2.5 py-0.5 rounded-full text-[#F0C987]">
            {hostGraceSecondsLeft}s until room closes
          </span>
        </div>
      )}

      {/* Sleek Mobile Room Bar (single uncluttered luxury row) */}
      <div className="flex md:hidden items-center justify-between gap-2.5 px-3 py-2 min-h-[54px]">
        {/* Editorial Room Title & Quiet Copy/Live Metadata Subline */}
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[17px] font-semibold tracking-tight text-[#F7F4EC] leading-tight truncate">
            {room.title}
          </h1>
          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] font-mono text-[#CDBF9F] min-w-0">
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="inline-flex items-center gap-1 text-[#E8DDC5]/90 hover:text-[#F7F4EC] transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              title="Copy room invitation link"
              aria-label="Copy room code and invitation link"
            >
              <span className={copied ? 'text-[#7AD3A8]' : ''}>
                {copied ? 'Copied' : room.code}
              </span>
              {copied ? (
                <Check className="w-3 h-3 text-[#7AD3A8]" />
              ) : (
                <Copy className="w-2.5 h-2.5 text-[#CDBF9F]/70" />
              )}
            </button>

            <span className="text-[#E8DDC5]/25 shrink-0">·</span>

            <button
              type="button"
              onClick={onOpenParticipants || (() => void handleShareInvite())}
              className="inline-flex items-center gap-1.5 min-w-0 hover:text-[#F7F4EC] transition-colors cursor-pointer"
              title="View room members & permissions"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  others.length > 0 ? 'bg-[#7AD3A8]' : 'bg-[#E9B872]'
                }`}
              />
              <span className="truncate">
                {totalOnline}/{SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}
                {others.length > 0
                  ? ` · ${others[0]?.username}${others.length > 1 ? ` +${others.length - 1}` : ''}`
                  : ' online'}
              </span>
            </button>
          </div>
        </div>

        {/* Essential Mobile Actions + Refined Overflow Menu */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(canControl ?? isHost) ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onChangeVideoClick}
              className="h-8 text-[11px] px-2.5 rounded-full"
              leftIcon={<Film className="w-3.5 h-3.5" />}
              title="Load YouTube link, video URL, or upload a movie file to watch together"
              aria-label="Load watch media or upload video"
            >
              Media
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => void handleShareInvite()}
              className="h-8 px-2.5 rounded-full border border-[#E8DDC5]/22 bg-[#173D30] hover:bg-[#1E4B3C] text-[11px] font-medium text-[#E8DDC5] hover:text-[#F7F4EC] inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              title="Share or copy room invite link"
              aria-label="Share or copy room invite link"
            >
              {copied ? (
                <Check className="w-3 h-3 text-[#7AD3A8]" />
              ) : (
                <Share2 className="w-3 h-3 text-[#9670FF]" />
              )}
              <span>{copied ? 'Copied' : 'Invite'}</span>
            </button>
          )}

          {renderVoiceControls(true)}

          <div ref={mobileMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              className={`h-8 w-8 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                isMobileMenuOpen
                  ? 'bg-[#1E4B3C] border-[#9670FF]/60 text-[#F7F4EC]'
                  : 'bg-[#173D30]/90 border-[#E8DDC5]/20 text-[#E8DDC5] hover:border-[#E8DDC5]/40 hover:text-[#F7F4EC]'
              }`}
              aria-haspopup="menu"
              aria-expanded={isMobileMenuOpen}
              aria-label="Room actions menu"
              title="Invite, members, save, or leave room"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {isMobileMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+8px)] w-60 rounded-2xl border border-[#E8DDC5]/18 bg-[#0E281F]/98 shadow-2xl backdrop-blur-md p-1.5 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void handleShareInvite();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs text-[#F7F4EC] hover:bg-[#173D30] transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2.5">
                    {copied ? (
                      <Check className="w-4 h-4 text-[#7AD3A8] shrink-0" />
                    ) : (
                      <Share2 className="w-4 h-4 text-[#9670FF] shrink-0" />
                    )}
                    <span>{copied ? 'Invite Link Copied' : 'Share Invite Link'}</span>
                  </span>
                  <span className="text-[10px] font-mono text-[#CDBF9F]/70">
                    {room.code}
                  </span>
                </button>

                {onOpenParticipants && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenParticipants();
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs text-[#F7F4EC] hover:bg-[#173D30] transition-colors cursor-pointer text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-[#9670FF] shrink-0" />
                      <span>Members &amp; Permissions</span>
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#173D30] border border-[#E8DDC5]/15 text-[#CDBF9F]">
                      {totalOnline}/{SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}
                    </span>
                  </button>
                )}

                {room.videoUrl && isAuthenticated && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isFavLoading || isLeavingRoom}
                    onClick={() => {
                      void handleToggleFavorite();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-[#F7F4EC] hover:bg-[#173D30] transition-colors cursor-pointer text-left disabled:opacity-50"
                  >
                    {isFavLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#E9B872] shrink-0" />
                    ) : (
                      <Star
                        className={`w-4 h-4 shrink-0 ${
                          isFav ? 'fill-[#E9B872] text-[#E9B872]' : 'text-[#CDBF9F]'
                        }`}
                      />
                    )}
                    <span>{isFav ? 'Saved to Favorites' : 'Save to Favorites'}</span>
                  </button>
                )}

                <div className="my-1 border-t border-[#E8DDC5]/12" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={isLeavingRoom}
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    void handleLeaveRoom();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-[#F2B8B2] hover:bg-[#3A1E1C]/70 transition-colors cursor-pointer text-left disabled:opacity-50"
                >
                  {isLeavingRoom ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <LogOut className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {isLeavingRoom
                      ? 'Leaving Room…'
                      : isHost
                      ? 'Close & Leave Room'
                      : 'Leave Room'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Desktop Screening Header Bar */}
      <div className="hidden md:flex min-h-14 px-6 py-2 items-center justify-between gap-4">
        {/* Left: Room Title, Sand Beige Room Code Pill, Copy Invite & Favorite */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-serif text-xl font-semibold tracking-tight text-[#F7F4EC] min-w-0 truncate max-w-[240px]">
              {room.title}
            </h1>

            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold bg-[#E8DDC5] hover:bg-[#F7F4EC] px-2.5 py-1 rounded-full text-[#102B23] transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              title="Copy room invitation link"
              aria-label="Copy room code and invitation link"
            >
              <span>{room.code}</span>
              {copied ? (
                <Check className="w-3 h-3 text-[#15803D]" />
              ) : (
                <Copy className="w-3 h-3 text-[#173D30]/75" />
              )}
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopyLink()}
            className="h-8 text-xs rounded-full inline-flex"
            leftIcon={
              copied ? (
                <Check className="w-3.5 h-3.5 text-[#7AD3A8]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )
            }
          >
            {copied ? 'Copied' : 'Copy Invite'}
          </Button>

          {/* Favorite Video Toggle */}
          {room.videoUrl && isAuthenticated && (
            <button
              type="button"
              onClick={handleToggleFavorite}
              disabled={isFavLoading || isLeavingRoom}
              className={`h-8 px-2.5 rounded-full border text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-55 disabled:pointer-events-none ${
                isFav
                  ? 'bg-[#292214] border-[#E9B872]/40 text-[#F0C987]'
                  : 'bg-[#173D30] border-[#E8DDC5]/18 text-[#CDBF9F] hover:text-[#F7F4EC] hover:border-[#E8DDC5]/35'
              }`}
              title={isFav ? 'Saved to Favorites' : 'Save to Favorites'}
              aria-label={isFav ? 'Remove from Favorites' : 'Save to Favorites'}
            >
              {isFavLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Star
                  className={`w-3.5 h-3.5 ${
                    isFav ? 'fill-[#E9B872] text-[#E9B872]' : ''
                  }`}
                />
              )}
              <span className="hidden xl:inline">
                {isFavLoading ? 'Saving…' : isFav ? 'Saved' : 'Save'}
              </span>
            </button>
          )}
        </div>

        {/* Right: Participant Presence, Role & Room Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          {others.length === 0 ? (
            <button
              type="button"
              onClick={onOpenParticipants || (() => void handleShareInvite())}
              className="cursor-pointer transition-opacity hover:opacity-90 shrink-0"
              title="View participants or invite friends"
            >
              <Badge variant="warning" dot className="text-[11px] whitespace-nowrap">
                {copied ? 'Invite Link Copied' : 'Waiting for Viewers · Invite'}
              </Badge>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenParticipants}
              className="cursor-pointer transition-opacity hover:opacity-90 min-w-0 text-left"
              title={`Online (${totalOnline}/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}): You, ${otherNames}. Click to manage.`}
            >
              <Badge
                variant="success"
                dot
                className="text-[11px] max-w-[220px] truncate whitespace-nowrap cursor-pointer"
              >
                {totalOnline}/{SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} Online · {otherNames}
              </Badge>
            </button>
          )}

          {/* Members / Permissions Trigger */}
          {onOpenParticipants && (
            <button
              type="button"
              onClick={onOpenParticipants}
              className="h-8 px-2.5 rounded-full bg-[#173D30] border border-[#E8DDC5]/18 text-[#CDBF9F] hover:text-[#F7F4EC] hover:border-[#E8DDC5]/35 text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              title="Room Members & Permissions"
              aria-label="Room Members and Permissions"
            >
              <Users className="w-3.5 h-3.5 text-[#9670FF]" />
              <span className="hidden xl:inline">Members</span>
            </button>
          )}

          {/* User Role */}
          <Badge
            variant={isHost ? 'purple' : isCoHost ? 'success' : 'default'}
            dot={isHost || isCoHost}
            className="text-[11px] hidden lg:inline-flex"
          >
            {isHost ? 'Host' : isCoHost ? 'Co-Host' : 'Viewer'}
          </Badge>

          {/* Change Watch Media Source Button (Host, Co-Host or permitted controllers) */}
          {(canControl ?? isHost) && (
            <Button
              variant="primary"
              size="sm"
              onClick={onChangeVideoClick}
              className="h-8 text-xs px-3 rounded-full"
              leftIcon={<Film className="w-3.5 h-3.5" />}
              title="Load YouTube link, video URL, or upload a movie file to watch together"
              aria-label="Load watch media or upload video"
            >
              Media / URL
            </Button>
          )}

          {renderVoiceControls(false)}

          {/* Optional Desktop Chat Toggle when collapsed */}
          {onToggleChat && !isChatOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleChat}
              disabled={isLeavingRoom}
              className="h-8 text-xs rounded-full hidden lg:inline-flex"
              leftIcon={<MessageSquare className="w-3.5 h-3.5 text-[#9670FF]" />}
            >
              Chat
            </Button>
          )}

          {/* Leave Room Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleLeaveRoom()}
            disabled={isLeavingRoom}
            className="h-8 w-8 p-0 rounded-full text-[#CDBF9F] hover:text-[#F2B8B2] hover:bg-[#3A1E1C]/60"
            title={isHost ? 'Close & Leave Room' : 'Leave Room'}
            aria-label={isHost ? 'Close and leave screening room' : 'Leave screening room'}
          >
            {isLeavingRoom ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
