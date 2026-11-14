'use client';

import React, { useCallback, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Tv,
  ArrowLeft,
  Film,
  AlertTriangle,
  UserX,
  Volume2,
  X,
  ListVideo,
  MessageSquare,
} from 'lucide-react';
import { useRoom } from '@/hooks/useRoom';
import { useSession } from '@/hooks/useSession';
import { useCall } from '@/hooks/useCall';
import { RoomHeader } from './RoomHeader';
import { ChangeVideoModal } from './ChangeVideoModal';
import { RoomParticipantsModal } from './RoomParticipantsModal';
import { RoomQueuePanel } from './RoomQueuePanel';
import { YouTubeQueueModal } from './YouTubeQueueModal';
import { RoomLoadingState } from './RoomLoadingState';
import { VoiceCallBar } from '@/components/call/VoiceCallBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { UniversalPlayer } from '@/components/player/UniversalPlayer';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { useRoomQueue } from '@/hooks/useRoomQueue';
import { RoomQueueItem } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { consumePendingQueue } from '@/lib/utils/pendingQueue';

interface RoomViewProps {
  roomCode: string;
  initialVideoId?: string;
  initialTitle?: string;
  allowCreate?: boolean;
  initialVideoType?: VideoSourceType;
  seedQueue?: boolean;
  openUpload?: boolean;
}

export const RoomView: React.FC<RoomViewProps> = ({
  roomCode,
  initialVideoId,
  initialTitle,
  allowCreate = false,
  initialVideoType = 'youtube',
  seedQueue = false,
  openUpload = false,
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
  } = useRoom(roomCode, initialTitle, allowCreate, initialVideoId, initialVideoType);

  const {
    items: queueItems,
    isLoading: isQueueLoading,
    error: queueError,
    busyItemId: queueBusyItemId,
    addItems: addQueueItems,
    removeItem: removeQueueItem,
    moveItem: moveQueueItem,
    reorder: reorderQueueItem,
  } = useRoomQueue(room?.id);

  const [isChangeVideoOpen, setIsChangeVideoOpen] = useState(false);
  const [changeVideoInitialTab, setChangeVideoInitialTab] = useState<VideoSourceType>('youtube');
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isYouTubeQueueOpen, setIsYouTubeQueueOpen] = useState(false);
  const isAnyDrawerOpen =
    isChangeVideoOpen || isParticipantsOpen || isQueueOpen || isYouTubeQueueOpen;
  const [isVoiceAutoDuckEnabled, setIsVoiceAutoDuckEnabled] = useState(true);
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [nowPlayingTitle, setNowPlayingTitle] = useState<string | null>(null);
  const hasLoadedInitialVideo = useRef(false);
  const seededQueueRef = useRef(false);
  const openedUploadRef = useRef(false);
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

  const openChangeVideo = useCallback((tab: VideoSourceType = 'youtube') => {
    setChangeVideoInitialTab(tab);
    setIsChangeVideoOpen(true);
  }, []);

  // If initial video was provided in query params and room has none, update it
  useEffect(() => {
    if (room && initialVideoId && !room.videoUrl && isHost && !hasLoadedInitialVideo.current) {
      hasLoadedInitialVideo.current = true;
      void updateVideo(initialVideoId, initialVideoType);
    }
  }, [room, initialVideoId, initialVideoType, isHost, updateVideo]);

  // Seed the shared queue with the line-up selected on /browse (host only).
  useEffect(() => {
    if (
      !room ||
      !isHost ||
      !seedQueue ||
      seededQueueRef.current ||
      isQueueLoading
    ) {
      return;
    }

    seededQueueRef.current = true;
    const pending = consumePendingQueue(room.code);
    const remaining = pending.filter((item) => {
      const source = item.videoId || item.videoUrl || '';
      return source && source !== room.videoUrl;
    });

    if (remaining.length > 0) {
      void addQueueItems(remaining).catch((err) => {
        console.warn('[Syncora] Could not seed the shared queue:', err);
      });
    }
  }, [room, isHost, seedQueue, isQueueLoading, addQueueItems]);

  // Open the upload tab directly when arriving from the Local Upload source card.
  useEffect(() => {
    if (
      !room ||
      !openUpload ||
      !canControl ||
      openedUploadRef.current ||
      isLoading
    ) {
      return;
    }
    openedUploadRef.current = true;
    openChangeVideo('upload');
  }, [room, openUpload, canControl, isLoading, openChangeVideo]);

  const playQueueItem = useCallback(
    async (item: RoomQueueItem) => {
      if (!canControl) return;
      setNowPlayingTitle(item.title);
      setAutoPlayNext(true);
      await updateVideo(item.videoUrl || item.videoId, item.videoType);
      await removeQueueItem(item.id);
    },
    [canControl, updateVideo, removeQueueItem]
  );

  const handleQueueAdd = useCallback(
    async (videos: { videoId: string; title: string; channelTitle: string; thumbnailUrl: string; durationSeconds: number }[]) => {
      await addQueueItems(
        videos.map((video) => ({
          videoId: video.videoId,
          videoType: 'youtube' as const,
          title: video.title,
          channelTitle: video.channelTitle,
          thumbnailUrl: video.thumbnailUrl,
          durationSeconds: video.durationSeconds,
        }))
      );
    },
    [addQueueItems]
  );

  const handleVideoEnded = useCallback(() => {
    if (!canControl) return;
    const next = queueItems[0];
    if (next) {
      void playQueueItem(next);
    }
  }, [canControl, queueItems, playQueueItem]);

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
              <p className="text-[13px] text-[#173D30]/85 mt-1.5 leading-relaxed">
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
            <p className="text-[13px] text-[#173D30]/85 mt-1.5 leading-relaxed">
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
            <p className="text-[13px] text-[#173D30]/85 mt-1.5 leading-relaxed">
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
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        queueCount={queueItems.length}
        onOpenQueue={() => setIsQueueOpen(true)}
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

      {/* Mobile Non-Intrusive Audio Unlock / Critical Error Banner */}
      <div className="lg:hidden shrink-0">
        {voiceCall.isAudioBlocked && (
          <button
            type="button"
            onClick={() => void voiceCall.unlockRemoteAudio()}
            className="w-full bg-[#9670FF]/25 border-b border-[#9670FF]/50 px-3 py-2 text-xs text-[#F7F4EC] flex items-center justify-center gap-2 cursor-pointer font-medium"
          >
            <Volume2 className="w-4 h-4 text-[#B397FF] shrink-0" />
            <span>Tap to enable partner audio</span>
          </button>
        )}
        {voiceCall.error && (
          <div className="bg-[#331B1A] border-b border-[#E87A70]/40 px-3 py-2 text-xs text-[#F2B8B2] flex items-center justify-between gap-2">
            <span className="truncate">{voiceCall.error.message}</span>
            <button
              type="button"
              onClick={voiceCall.clearError}
              className="p-1 text-[#F2B8B2] hover:text-[#F7F4EC] cursor-pointer shrink-0"
              aria-label="Dismiss voice error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Desktop (Collapsed-Chat) Voice Status Banner */}
      {!isChatOpen && (
        <VoiceCallBar
          variant="banner"
          {...sharedVoiceBarProps}
          className="hidden lg:block"
        />
      )}

      {/* Main Theater Split: Full-Stage Video Centerpiece + Independently Scrollable Chat Lounge */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left/Top Stage: Video Centerpiece (smoothly shrinks when right drawer expands) */}
        <div
          className={`shrink-0 lg:shrink lg:flex-1 lg:min-w-0 lg:min-h-0 flex flex-col bg-[#091B15] transition-all duration-300 ease-out ${
            isChatOpen
              ? 'px-3 pt-2 pb-1.5 sm:px-5 sm:pt-3.5 sm:pb-2.5 lg:p-3'
              : 'flex-1 min-h-0 p-3 sm:p-5 lg:p-3 justify-center'
          } ${isAnyDrawerOpen ? 'lg:mr-[32rem] xl:mr-[36rem]' : ''}`}
        >
          <div
            className={`w-full mx-auto flex flex-col ${
              isChatOpen
                ? 'max-w-[calc(30dvh*16/9)] sm:max-w-[calc(38dvh*16/9)] lg:max-w-none lg:flex-1 lg:min-h-0'
                : 'max-w-none flex-1 min-h-0 justify-center'
            }`}
          >
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
                onChangeVideoClick={() => openChangeVideo('youtube')}
                autoPlayOnLoad={autoPlayNext}
                onAutoPlayHandled={() => setAutoPlayNext(false)}
                onEnded={handleVideoEnded}
                isInVoiceCall={voiceCall.isInCall}
                isVoiceAutoDuckEnabled={isVoiceAutoDuckEnabled}
                isVoiceSpeaking={voiceCall.isLocalSpeaking || voiceCall.isPeerSpeaking}
                className={isChatOpen ? 'lg:aspect-auto lg:flex-1 lg:min-h-0' : 'aspect-video lg:aspect-auto flex-1 min-h-0 max-h-[82dvh]'}
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
                      onClick={() => openChangeVideo('youtube')}
                      leftIcon={<Tv className="w-4 h-4" />}
                    >
                      Choose or Upload Video
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Streamlined screening telemetry (Joiners and Upload / URL consolidated in RoomHeader to eliminate duplicates) */}
            <div className="mt-1.5 sm:mt-2 shrink-0 flex items-center justify-between gap-3 text-xs text-[#CDBF9F]/85 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7AD3A8] shrink-0" />
                <span className="font-mono uppercase tracking-[0.12em] text-[#CDBF9F] truncate">
                  {room.videoUrl
                    ? room.videoType === 'youtube'
                      ? 'YouTube · Synced'
                      : 'Personal Stream · Synced'
                    : 'Awaiting Source'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsQueueOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DDC5]/18 bg-[#102B23]/80 px-2.5 py-1 text-xs font-semibold text-[#CDBF9F] hover:border-[#9670FF]/50 hover:text-[#F7F4EC] transition-colors cursor-pointer"
                  aria-label="Open shared watch queue"
                >
                  <ListVideo className="w-3.5 h-3.5 text-[#9670FF]" />
                  <span>Queue</span>
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-[#9670FF]/90 px-1 font-mono text-[11px] font-bold text-[#0B1E18]">
                    {queueItems.length}
                  </span>
                </button>

                {voiceCall.isInCall && (
                  <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-[#7AD3A8]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7AD3A8] animate-pulse" />
                    <span>Voice Active ({voiceCall.participants.length})</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right/Bottom Lounge: Independently Scrollable Persistent Realtime Chat */}
        {isChatOpen && (
          <div className={`h-full flex ${isAnyDrawerOpen ? 'lg:hidden' : ''}`}>
            <ChatContainer
              roomId={room.id}
              user={user}
              partnerName={partnerLabel}
              channel={channel}
              members={members}
              presenceList={presenceList}
              initialHistory={initialChatHistory}
              isChatOpen={isChatOpen && !isAnyDrawerOpen}
              onCollapse={() => setIsChatOpen(false)}
              voiceSection={
                <VoiceCallBar
                  variant="sidebar"
                  {...sharedVoiceBarProps}
                  className="hidden lg:block"
                />
              }
            />
          </div>
        )}
      </div>

      {/* Floating Mobile Chat Reopen Pill when Chat is Minimized */}
      {!isChatOpen && (
        <button
          type="button"
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-4 right-4 z-30 lg:hidden flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#173D30] border border-[#9670FF]/60 text-[#F7F4EC] shadow-[0_8px_24px_rgba(0,0,0,0.6)] hover:bg-[#1E4B3C] active:scale-95 transition-all text-xs font-semibold cursor-pointer"
          aria-label="Open chat"
        >
          <MessageSquare className="w-4 h-4 text-[#9670FF]" />
          <span>Chat</span>
        </button>
      )}

      {/* Change Video Modal */}
      <ChangeVideoModal
        isOpen={isChangeVideoOpen}
        onClose={() => setIsChangeVideoOpen(false)}
        roomId={room.id}
        currentVideoUrl={room.videoUrl}
        onSelectVideo={updateVideo}
        initialTab={changeVideoInitialTab}
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

      <RoomQueuePanel
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        items={queueItems}
        currentVideoUrl={room.videoUrl}
        currentVideoType={room.videoType}
        nowPlayingTitle={nowPlayingTitle}
        canControl={canControl}
        currentUserId={user.id}
        members={members}
        isLoading={isQueueLoading}
        error={queueError}
        busyItemId={queueBusyItemId}
        onPlay={(item) => void playQueueItem(item)}
        onRemove={(item) => void removeQueueItem(item.id)}
        onMove={(item, direction) => void moveQueueItem(item.id, direction)}
        onReorder={(fromIndex, toIndex) => void reorderQueueItem(fromIndex, toIndex)}
        onAddVideosToQueue={handleQueueAdd}
        onAddVideos={() => {
          setIsQueueOpen(false);
          setIsYouTubeQueueOpen(true);
        }}
      />

      <YouTubeQueueModal
        isOpen={isYouTubeQueueOpen}
        onClose={() => setIsYouTubeQueueOpen(false)}
        onAdd={handleQueueAdd}
        onBackToQueue={() => {
          setIsYouTubeQueueOpen(false);
          setIsQueueOpen(true);
        }}
      />
    </div>
  );
};
