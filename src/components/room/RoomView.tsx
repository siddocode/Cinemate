'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Tv,
  ArrowLeft,
  Users2,
  Film,
  AlertTriangle,
  UserX,
} from 'lucide-react';
import { useRoom } from '@/hooks/useRoom';
import { useSession } from '@/hooks/useSession';
import { useCall } from '@/hooks/useCall';
import { RoomHeader } from './RoomHeader';
import { ChangeVideoModal } from './ChangeVideoModal';
import { RoomParticipantsModal } from './RoomParticipantsModal';
import { RoomLoadingState } from './RoomLoadingState';
import { VoiceCallBar } from '@/components/call/VoiceCallBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { UniversalPlayer } from '@/components/player/UniversalPlayer';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';

interface RoomViewProps {
  roomCode: string;
  initialVideoId?: string;
  initialTitle?: string;
  allowCreate?: boolean;
}

export const RoomView: React.FC<RoomViewProps> = ({
  roomCode,
  initialVideoId,
  initialTitle,
  allowCreate = false,
}) => {
  const { user } = useSession();
  const {
    room,
    isHost,
    isCoHost,
    canControl,
    canStartCall,
    members,
    duoStatus,
    presenceList,
    isKicked,
    kickedMessage,
    isRoomClosed,
    roomClosedMessage,
    hostGraceSecondsLeft,
    isLoading,
    error,
    realtimeError,
    updateVideo,
    persistPlaybackSnapshot,
    applyRemoteVideo,
    kickMember,
    updateMemberRole,
    toggleGuestControl,
    toggleGuestCall,
    closeRoom,
    channel,
    initialChatHistory,
  } = useRoom(roomCode, initialTitle, allowCreate, initialVideoId);

  const [isChangeVideoOpen, setIsChangeVideoOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isVoiceAutoDuckEnabled, setIsVoiceAutoDuckEnabled] = useState(true);
  const hasLoadedInitialVideo = useRef(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const voiceCall = useCall({
    roomId: room?.id,
    hostId: room?.hostId,
    canStartCall,
    user,
    presenceList,
    members,
    isRoomReady: Boolean(room && !isLoading && !error && !isKicked && !isRoomClosed),
    audioRef: voiceAudioRef,
  });

  // If initial video was provided in query params and room has none, update it
  useEffect(() => {
    if (room && initialVideoId && !room.videoUrl && isHost && !hasLoadedInitialVideo.current) {
      hasLoadedInitialVideo.current = true;
      updateVideo(initialVideoId);
    }
  }, [room, initialVideoId, isHost, updateVideo]);

  // Loading Screen
  if (isLoading) {
    return <RoomLoadingState mode={allowCreate ? 'create' : 'join'} />;
  }

  // Kicked Screen
  if (isKicked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0E281F] p-4 text-center">
        <Card glow tone="sand" className="max-w-md w-full p-7 text-center space-y-5">
          <div className="w-11 h-11 rounded-xl bg-[#FDECEC] border border-[#DC2626]/25 text-[#B91C1C] flex items-center justify-center mx-auto">
            <UserX className="w-5 h-5" />
          </div>
            <div>
              <h2 className="font-serif text-2xl font-semibold text-[#102B23]">
                Removed from Screening Room
              </h2>
              <p className="text-xs text-[#173D30]/75 mt-1.5 leading-relaxed">
                {kickedMessage || 'You have been removed from this room by the host.'} If you rejoin later, your account is limited to view-only access (no Co-Host or playback controls).
              </p>
            </div>
            <div className="space-y-2.5">
              <Link href="/" className="block">
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
                  leftIcon={<ArrowLeft className="w-4 h-4" />}
                >
                  Return to Lounge
                </Button>
              </Link>
              <Button
                variant="outline"
                size="md"
                className="w-full"
                onClick={() => window.location.reload()}
              >
                Rejoin (View-Only)
              </Button>
            </div>
        </Card>
      </div>
    );
  }

  if (isRoomClosed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0E281F] p-4 text-center">
        <Card glow tone="sand" className="max-w-md w-full p-7 text-center space-y-5">
          <div className="w-11 h-11 rounded-xl bg-[#FDECEC] border border-[#DC2626]/25 text-[#B91C1C] flex items-center justify-center mx-auto">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl font-semibold text-[#102B23]">
              Screening Room Closed
            </h2>
            <p className="text-xs text-[#173D30]/75 mt-1.5 leading-relaxed">
              {roomClosedMessage || 'The host has left and closed this screening room.'}
            </p>
          </div>
          <Link href="/" className="block">
            <Button
              variant="primary"
              size="md"
              className="w-full"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
            >
              Return to Lounge
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Error Screen
  if (error || !room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0E281F] p-4 text-center">
        <Card glow tone="sand" className="max-w-md w-full p-7 text-center space-y-5">
          <div className="w-11 h-11 rounded-xl bg-[#FDECEC] border border-[#DC2626]/25 text-[#B91C1C] flex items-center justify-center mx-auto">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl font-semibold text-[#102B23]">
              Screening Room Unavailable
            </h2>
            <p className="text-xs text-[#173D30]/75 mt-1.5 leading-relaxed">
              {error || 'The requested watch room could not be loaded or is no longer active.'}
            </p>
          </div>
          <Link href="/" className="block">
            <Button
              variant="primary"
              size="md"
              className="w-full"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
            >
              Return to Lounge
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const otherParticipants = presenceList.filter((p) => p.userId !== user.id);
  const totalOnline = 1 + otherParticipants.length;
  const hostName = isHost
    ? user.username
    : presenceList.find((p) => p.userId === room.hostId)?.username ||
      duoStatus.partner?.username ||
      'Host';
  const partnerLabel =
    otherParticipants.length === 0
      ? undefined
      : otherParticipants.length === 1
      ? otherParticipants[0].username
      : `${otherParticipants.length} viewers`;

  const sharedVoiceBarProps = {
    isHost,
    status: voiceCall.status,
    isInCall: voiceCall.isInCall,
    isLeaving: voiceCall.isLeaving,
    isCallFull: voiceCall.isCallFull,
    isMuted: voiceCall.isMuted,
    isAudioBlocked: voiceCall.isAudioBlocked,
    iceMode: voiceCall.iceMode,
    connectionMode: voiceCall.connectionMode,
    error: voiceCall.error,
    callEndedNotice: voiceCall.callEndedNotice,
    participants: voiceCall.participants,
    activeCallers: voiceCall.activeCallers,
    incomingCaller: voiceCall.incomingCaller,
    autoDuckEnabled: isVoiceAutoDuckEnabled,
    onToggleAutoDuck: () => setIsVoiceAutoDuckEnabled((prev) => !prev),
    onJoin: () => {
      void voiceCall.joinCall();
    },
    onLeave: () => {
      void voiceCall.leaveCall();
    },
    onToggleMute: voiceCall.toggleMute,
    onUnlockAudio: () => {
      void voiceCall.unlockRemoteAudio();
    },
    onClearError: voiceCall.clearError,
    onClearCallEndedNotice: voiceCall.clearCallEndedNotice,
  };

  return (
    <div className="w-full h-[calc(100dvh-3.5rem)] sm:h-[calc(100dvh-4rem)] max-h-[calc(100dvh-3.5rem)] sm:max-h-[calc(100dvh-4rem)] shrink-0 flex flex-col bg-[#091B15] overflow-hidden overscroll-none">
      {/* Persistent Remote Voice Audio Sink (independent of video player lifecycle) */}
      <audio ref={voiceAudioRef} autoPlay playsInline className="hidden" aria-hidden="true" />

      {/* Pinned Room Header */}
      <RoomHeader
        room={room}
        isHost={isHost}
        isCoHost={isCoHost}
        canControl={canControl}
        duoStatus={duoStatus}
        presenceList={presenceList}
        hostGraceSecondsLeft={hostGraceSecondsLeft}
        onChangeVideoClick={() => setIsChangeVideoOpen(true)}
        onOpenParticipants={() => setIsParticipantsOpen(true)}
        onCloseRoom={isHost ? closeRoom : undefined}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen(true)}
        voiceCall={{
          status: voiceCall.status,
          isInCall: voiceCall.isInCall,
          isLeaving: voiceCall.isLeaving,
          isCallFull: voiceCall.isCallFull,
          canStartCall,
          isMuted: voiceCall.isMuted,
          isLocalSpeaking: voiceCall.isLocalSpeaking,
          isPeerSpeaking: voiceCall.isPeerSpeaking,
          incomingCaller: voiceCall.incomingCaller,
          participantCount: voiceCall.participants.length,
          onJoinCall: () => {
            void voiceCall.joinCall();
          },
          onLeaveCall: () => voiceCall.leaveCall(),
          onToggleMute: voiceCall.toggleMute,
        }}
      />

      {/* Realtime Private Channel Authorization Notice */}
      {realtimeError && (
        <div className="shrink-0 bg-[#292214] border-b border-[#E9B872]/30 px-3 sm:px-6 py-2 flex items-center gap-2 text-xs text-[#F0C987]">
          <AlertTriangle className="w-4 h-4 text-[#E9B872] shrink-0" />
          <span>{realtimeError}</span>
        </div>
      )}

      {/* Mobile / Tablet (and Collapsed-Chat Desktop) Voice Status Banner */}
      <VoiceCallBar
        variant="banner"
        {...sharedVoiceBarProps}
        className={isChatOpen ? 'lg:hidden' : ''}
      />

      {/* Main Theater Split: Full-Stage Video Centerpiece + Independently Scrollable Chat Lounge */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left/Top Stage: Video Centerpiece */}
        <div className="shrink-0 lg:shrink lg:flex-1 lg:min-w-0 lg:min-h-0 flex flex-col bg-[#091B15] px-3 pt-2.5 pb-2 sm:px-5 sm:pt-3.5 sm:pb-2.5 lg:p-3">
          <div className="w-full max-w-[calc(36dvh*16/9)] sm:max-w-[calc(40dvh*16/9)] lg:max-w-none lg:flex-1 lg:min-h-0 mx-auto flex flex-col">
            {/* Screening Frame (16:9 on mobile/tablet, full available theater space on lg+) */}
            {room.videoUrl ? (
              <UniversalPlayer
                videoUrl={room.videoUrl}
                videoType={room.videoType}
                roomId={room.id}
                isHost={isHost}
                canControl={canControl}
                hostName={hostName}
                channel={channel}
                initialPlayback={{
                  position: room.currentPosition,
                  isPlaying: room.isPlaying,
                  lastSyncedAt: room.lastSyncedAt,
                }}
                onPersistSnapshot={persistPlaybackSnapshot}
                onVideoMismatch={applyRemoteVideo}
                onChangeVideoClick={() => setIsChangeVideoOpen(true)}
                isInVoiceCall={voiceCall.isInCall}
                isVoiceAutoDuckEnabled={isVoiceAutoDuckEnabled}
                isVoiceSpeaking={voiceCall.isLocalSpeaking || voiceCall.isPeerSpeaking}
                className="lg:aspect-auto lg:flex-1 lg:min-h-0"
              />
            ) : (
              <div className="relative w-full aspect-video lg:aspect-auto lg:flex-1 lg:min-h-0 bg-[#0D251C] rounded-xl border border-[#E8DDC5]/16 overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.55)] flex flex-col items-center justify-center text-center p-4 sm:p-6">
                {/* Architectural Corner Aspect Guides */}
                <span className="absolute top-3 left-3 w-3 h-3 border-t border-l border-[#E8DDC5]/30 pointer-events-none" />
                <span className="absolute top-3 right-3 w-3 h-3 border-t border-r border-[#E8DDC5]/30 pointer-events-none" />
                <span className="absolute bottom-3 left-3 w-3 h-3 border-b border-l border-[#E8DDC5]/30 pointer-events-none" />
                <span className="absolute bottom-3 right-3 w-3 h-3 border-b border-r border-[#E8DDC5]/30 pointer-events-none" />

                <div className="flex flex-col items-center max-w-md">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[#9670FF]/14 border border-[#9670FF]/55 flex items-center justify-center text-[#B397FF] mb-3 sm:mb-4">
                    <Film className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <h3 className="font-serif text-xl sm:text-3xl font-medium text-[#F7F4EC] tracking-tight">
                    Screening Room Ready
                  </h3>
                  <p className="text-xs sm:text-sm text-[#CDBF9F] mt-1.5 sm:mt-2 max-w-sm leading-relaxed">
                    {canControl
                      ? 'Choose a YouTube link, direct stream URL, or personal upload up to 50MB to start watching together.'
                      : 'Waiting for the host to load a video into the screening frame...'}
                  </p>
                  {canControl && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-4 sm:mt-5"
                      onClick={() => setIsChangeVideoOpen(true)}
                      leftIcon={<Tv className="w-3.5 h-3.5" />}
                    >
                      Choose or Upload Video
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Quiet Screening Telemetry Strip */}
            <div className="mt-2 shrink-0 flex items-center justify-between gap-3 text-[10px] sm:text-[11px] text-[#CDBF9F]/85 px-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF] shrink-0" />
                <span className="font-mono uppercase tracking-[0.12em] truncate">
                  {room.videoUrl
                    ? room.videoType === 'youtube'
                      ? 'YouTube · Synced'
                      : 'Personal Stream · Synced'
                    : 'Awaiting Source'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[#CDBF9F] min-w-0">
                <Users2 className="w-3.5 h-3.5 text-[#E8DDC5]/75 shrink-0" />
                <span className="truncate">
                  {otherParticipants.length > 0
                    ? `${totalOnline}/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} in room · Watching with ${otherParticipants
                        .map((p) => p.username)
                        .join(', ')}`
                    : `1/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} viewer in lounge`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right/Bottom Lounge: Independently Scrollable Persistent Realtime Chat */}
        {isChatOpen && (
          <ChatContainer
            roomId={room.id}
            user={user}
            partnerName={partnerLabel}
            channel={channel}
            members={members}
            presenceList={presenceList}
            initialHistory={initialChatHistory}
            onCollapse={() => setIsChatOpen(false)}
            voiceSection={
              <VoiceCallBar
                variant="sidebar"
                {...sharedVoiceBarProps}
                className="hidden lg:block"
              />
            }
          />
        )}
      </div>

      {/* Change Video Modal */}
      <ChangeVideoModal
        isOpen={isChangeVideoOpen}
        onClose={() => setIsChangeVideoOpen(false)}
        roomId={room.id}
        currentVideoUrl={room.videoUrl}
        onSelectVideo={updateVideo}
      />

      {/* Room Participants & Playback Delegation Modal */}
      <RoomParticipantsModal
        isOpen={isParticipantsOpen}
        onClose={() => setIsParticipantsOpen(false)}
        room={room}
        currentUserId={user.id}
        isHost={isHost}
        members={members}
        presenceList={presenceList}
        onUpdateRole={updateMemberRole}
        onKickMember={kickMember}
        onToggleGuestControl={toggleGuestControl}
        onToggleGuestCall={toggleGuestCall}
      />
    </div>
  );
};
