'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DuoStatus, ParticipantPresence, Room } from '@/core/types/room.types';
import { CallParticipantState, CallStatus } from '@/core/types/call.types';
import { CALL_CONSTANTS, SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { useSession } from '@/hooks/useSession';
import { favoriteService } from '@/lib/services/favoriteService';

export interface RoomHeaderVoiceProps {
  status: CallStatus;
  isInCall: boolean;
  isLeaving?: boolean;
  isCallFull: boolean;
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

  useEffect(() => {
    if (isAuthenticated && user.id && room.videoUrl) {
      favoriteService.isFavorite(user.id, room.videoUrl).then((fav) => {
        setIsFav(fav);
      });
    }
  }, [isAuthenticated, user.id, room.videoUrl]);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
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

      {/* Main Screening Header Bar */}
      <div className="min-h-12 sm:min-h-14 px-3 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Room Title, Sand Beige Room Code Pill & Favorite */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <h1 className="font-serif text-base sm:text-xl font-semibold tracking-tight text-[#F7F4EC] max-w-[88px] sm:max-w-[220px] truncate">
              {room.title}
            </h1>

            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-semibold bg-[#E8DDC5] hover:bg-[#F7F4EC] px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[#102B23] transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              title="Copy room invitation link"
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
            onClick={handleCopyLink}
            className="h-8 text-xs rounded-full hidden md:inline-flex"
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
              className={`h-7 sm:h-8 px-2 sm:px-2.5 rounded-full border text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-55 disabled:pointer-events-none ${
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
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Active Participants Pill (Supports up to MAX_ROOM_PARTICIPANTS = 4) */}
          {(() => {
            const others = presenceList
              ? presenceList.filter((p) => p.userId !== user.id)
              : duoStatus.partner
              ? [duoStatus.partner]
              : [];

            if (others.length === 0) {
              return (
                <button
                  type="button"
                  onClick={onOpenParticipants || handleCopyLink}
                  className="cursor-pointer transition-opacity hover:opacity-90 shrink-0"
                  title="View participants or invite friends"
                >
                  <Badge variant="warning" dot className="text-[10px] sm:text-[11px] whitespace-nowrap">
                    <span className="sm:hidden">{copied ? 'Copied' : 'Invite'}</span>
                    <span className="hidden sm:inline">
                      {copied ? 'Invite Link Copied' : 'Waiting for Viewers · Invite'}
                    </span>
                  </Badge>
                </button>
              );
            }

            const totalOnline = 1 + others.length;
            const otherNames = others.map((p) => p.username).join(', ');
            return (
              <button
                type="button"
                onClick={onOpenParticipants}
                className="cursor-pointer transition-opacity hover:opacity-90 shrink-0 text-left"
                title={`Online (${totalOnline}/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}): You, ${otherNames}. Click to manage.`}
              >
                <Badge
                  variant="success"
                  dot
                  className="text-[10px] sm:text-[11px] max-w-[125px] sm:max-w-[220px] truncate whitespace-nowrap cursor-pointer"
                >
                  <span className="sm:hidden">
                    {totalOnline}/{SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} · {others[0]?.username}
                    {others.length > 1 ? ` +${others.length - 1}` : ''}
                  </span>
                  <span className="hidden sm:inline">
                    {totalOnline}/{SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} Online · {otherNames}
                  </span>
                </Badge>
              </button>
            );
          })()}

          {/* Members / Permissions Trigger */}
          {onOpenParticipants && (
            <button
              type="button"
              onClick={onOpenParticipants}
              className="h-7 sm:h-8 px-2 sm:px-2.5 rounded-full bg-[#173D30] border border-[#E8DDC5]/18 text-[#CDBF9F] hover:text-[#F7F4EC] hover:border-[#E8DDC5]/35 text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              title="Room Members & Permissions"
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
              className="h-7 sm:h-8 text-[11px] sm:text-xs px-2.5 sm:px-3 rounded-full"
              leftIcon={<Film className="w-3.5 h-3.5" />}
              title="Load YouTube link, video URL, or upload a movie file to watch together"
              aria-label="Load watch media or upload video"
            >
              <span className="hidden sm:inline">Media / URL</span>
              <span className="sm:hidden">Media</span>
            </Button>
          )}

          {/* Voice Call Compact Header Controls */}
          {voiceCall && (
            <>
              {voiceCall.isInCall ? (
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
                  <span className="hidden xl:inline text-[11px] font-mono text-[#E8DDC5] px-1 whitespace-nowrap">
                    {voiceCall.status === 'connected'
                      ? `Voice Call ${voiceCall.participantCount}/${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}`
                      : voiceCall.status === 'reconnecting'
                      ? 'Reconnecting'
                      : voiceCall.status === 'connecting'
                      ? 'Connecting'
                      : `Voice Call 1/${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}`}
                  </span>
                  <button
                    type="button"
                    onClick={voiceCall.onToggleMute}
                    disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
                    className={`h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-45 disabled:pointer-events-none ${
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
                    className="h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center text-[#F2B8B2] hover:bg-[#3A1E1C] transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
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
              ) : voiceCall.isCallFull ? (
                <Badge
                  variant="default"
                  className="h-7 sm:h-8 text-[10px] sm:text-[11px] px-2.5 hidden sm:inline-flex whitespace-nowrap"
                  title={`Voice call is limited to ${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS} participants`}
                >
                  <Headphones className="w-3 h-3 text-[#9670FF]" />
                  <span>
                    Voice {CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}/{CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}
                  </span>
                </Badge>
              ) : voiceCall.incomingCaller ? (
                <Button
                  variant="accent"
                  size="sm"
                  onClick={voiceCall.onJoinCall}
                  isLoading={voiceCall.status === 'joining'}
                  disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
                  className="h-7 sm:h-8 text-[11px] sm:text-xs px-2.5 sm:px-3 rounded-full whitespace-nowrap"
                  leftIcon={<PhoneCall className="w-3.5 h-3.5 animate-pulse" />}
                  title="Join audio-only voice call"
                  aria-label="Join audio-only voice call"
                >
                  <span className="hidden sm:inline">
                    {voiceCall.status === 'joining'
                      ? 'Joining…'
                      : `Join Voice · ${voiceCall.incomingCaller.username}`}
                  </span>
                  <span className="sm:hidden">
                    {voiceCall.status === 'joining' ? 'Joining…' : 'Join Voice'}
                  </span>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={voiceCall.onJoinCall}
                  isLoading={voiceCall.status === 'joining'}
                  disabled={Boolean(voiceCall.isLeaving) || isLeavingRoom}
                  className="h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3 rounded-full whitespace-nowrap"
                  leftIcon={<Mic className="w-3.5 h-3.5 text-[#9670FF]" />}
                  title="Start audio-only voice call (no camera)"
                  aria-label="Join voice call"
                >
                  <span className="hidden sm:inline">
                    {voiceCall.status === 'joining' ? 'Joining…' : 'Voice Call'}
                  </span>
                  <span className="sm:hidden">
                    {voiceCall.status === 'joining' ? 'Joining…' : 'Voice Call'}
                  </span>
                </Button>
              )}
            </>
          )}

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
            className="h-7 w-7 sm:h-8 sm:w-8 p-0 rounded-full text-[#CDBF9F] hover:text-[#F2B8B2] hover:bg-[#3A1E1C]/60"
            title={isHost ? 'Close & Leave Room' : 'Leave Room'}
            aria-label={isHost ? 'Close and leave screening room' : 'Leave screening room'}
          >
            {isLeavingRoom ? (
              <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
