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
  UserPlus,
  Play,
  Users,
  PhoneCall,
  Plus,
  Trash2,
  Sliders,
  Copy,
  Check,
} from 'lucide-react';
import { useRoom } from '@/hooks/useRoom';
import { useSession } from '@/hooks/useSession';
import { useCall } from '@/hooks/useCall';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { RoomHeader } from './RoomHeader';
import { ChangeVideoModal } from './ChangeVideoModal';
import { RoomParticipantsModal } from './RoomParticipantsModal';
import { RoomQueuePanel } from './RoomQueuePanel';
import { YouTubeQueueModal } from './YouTubeQueueModal';
import { RoomLoadingState } from './RoomLoadingState';
import { VoiceCallBar } from '@/components/call/VoiceCallBar';
import { CallActionsToolbar } from '@/components/call/CallActionsToolbar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { UniversalPlayer } from '@/components/player/UniversalPlayer';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { useRoomQueue } from '@/hooks/useRoomQueue';
import { RoomQueueItem } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { consumePendingQueue } from '@/lib/utils/pendingQueue';
import { formatTime } from '@/lib/utils/time';
import { cn } from '@/lib/utils/cn';

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
  const { viewportHeight, isKeyboardOpen } = useVisualViewport();
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
  const [mobileTab, setMobileTab] = useState<'chat' | 'queue' | 'participants'>('chat');
  const [isVoiceAutoDuckEnabled, setIsVoiceAutoDuckEnabled] = useState(true);
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [nowPlayingTitle, setNowPlayingTitle] = useState<string | null>(null);

  // Temporary notifications
  const [roomJoinNotice, setRoomJoinNotice] = useState<{ username: string; timestamp: number } | null>(null);
  const [callJoinNotice, setCallJoinNotice] = useState<{ username: string; timestamp: number } | null>(null);

  const prevPresenceUserIdsRef = useRef<Set<string>>(new Set());
  const recentRoomJoinNoticesRef = useRef<Map<string, number>>(new Map());
  const isFirstPresenceSyncRef = useRef(true);

  const prevCallUserIdsRef = useRef<Set<string>>(new Set());
  const recentCallJoinNoticesRef = useRef<Map<string, number>>(new Map());
  const isFirstCallSyncRef = useRef(true);

  const hasLoadedInitialVideo = useRef(false);
  const seededQueueRef = useRef(false);
  const openedUploadRef = useRef(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const isAnyDrawerOpen =
    isChangeVideoOpen || isParticipantsOpen || isQueueOpen || isYouTubeQueueOpen;

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

  const [isTogglingControl, setIsTogglingControl] = useState(false);
  const [isTogglingCall, setIsTogglingCall] = useState(false);
  const [mobileCopyCopied, setMobileCopyCopied] = useState(false);

  const handleToggleControl = useCallback(async () => {
    if (!isHost || isTogglingControl || !room) return;
    setIsTogglingControl(true);
    try {
      await toggleGuestControl(!room.allowGuestControl);
    } finally {
      setIsTogglingControl(false);
    }
  }, [isHost, isTogglingControl, room, toggleGuestControl]);

  const handleToggleCall = useCallback(async () => {
    if (!isHost || isTogglingCall || !room) return;
    setIsTogglingCall(true);
    try {
      await toggleGuestCall(!room.allowGuestCall);
    } finally {
      setIsTogglingCall(false);
    }
  }, [isHost, isTogglingCall, room, toggleGuestCall]);

  const handleMobileCopyLink = useCallback(async () => {
    if (!room?.code) return;
    try {
      const url = `${window.location.origin}/room/${room.code}`;
      await navigator.clipboard.writeText(url);
      setMobileCopyCopied(true);
      setTimeout(() => setMobileCopyCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, [room]);

  // Track room member joins for prominent banner notification below header (deduplicated)
  useEffect(() => {
    if (!presenceList || presenceList.length === 0) return;

    const currentIds = new Set(presenceList.map((p) => p.userId));

    if (isFirstPresenceSyncRef.current) {
      isFirstPresenceSyncRef.current = false;
      prevPresenceUserIdsRef.current = currentIds;
      return;
    }

    const now = Date.now();
    const newJoiners = presenceList.filter(
      (p) => p.userId !== user.id && !prevPresenceUserIdsRef.current.has(p.userId)
    );

    prevPresenceUserIdsRef.current = currentIds;

    for (const joiner of newJoiners) {
      const lastNotified = recentRoomJoinNoticesRef.current.get(joiner.userId) || 0;
      if (now - lastNotified > 15000) {
        recentRoomJoinNoticesRef.current.set(joiner.userId, now);
        setRoomJoinNotice({
          username: joiner.username || 'A viewer',
          timestamp: now,
        });
        break;
      }
    }
  }, [presenceList, user.id]);

  // Auto-dismiss room join notice after 5 seconds
  useEffect(() => {
    if (!roomJoinNotice) return;
    const timer = setTimeout(() => {
      setRoomJoinNotice(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [roomJoinNotice]);

  // Track call joins inside the call interface (clearly distinguished from room joins)
  useEffect(() => {
    if (!voiceCall.participants || voiceCall.participants.length === 0) {
      prevCallUserIdsRef.current = new Set();
      return;
    }

    const currentIds = new Set(voiceCall.participants.map((p) => p.userId));

    if (isFirstCallSyncRef.current) {
      isFirstCallSyncRef.current = false;
      prevCallUserIdsRef.current = currentIds;
      return;
    }

    const now = Date.now();
    const newCallers = voiceCall.participants.filter(
      (p) => !p.isLocal && !prevCallUserIdsRef.current.has(p.userId)
    );

    prevCallUserIdsRef.current = currentIds;

    for (const caller of newCallers) {
      const lastNotified = recentCallJoinNoticesRef.current.get(caller.userId) || 0;
      if (now - lastNotified > 15000) {
        recentCallJoinNoticesRef.current.set(caller.userId, now);
        setCallJoinNotice({
          username: caller.username || 'A caller',
          timestamp: now,
        });
        break;
      }
    }
  }, [voiceCall.participants]);

  // Auto-dismiss call join notice after 4 seconds
  useEffect(() => {
    if (!callJoinNotice) return;
    const timer = setTimeout(() => {
      setCallJoinNotice(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [callJoinNotice]);

  // If initial video was provided in query params and room has none, update it
  useEffect(() => {
    if (room && initialVideoId && !room.videoUrl && isHost && !hasLoadedInitialVideo.current) {
      hasLoadedInitialVideo.current = true;
      void updateVideo(initialVideoId, initialVideoType);
    }
  }, [room, initialVideoId, initialVideoType, isHost, updateVideo]);

  // Seed the shared queue with the line-up selected on /browse (host only).
  useEffect(() => {
    if (!room || !isHost || !seedQueue || seededQueueRef.current || isQueueLoading) {
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
    if (!room || !openUpload || !canControl || openedUploadRef.current || isLoading) {
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
    async (
      videos: {
        videoId: string;
        title: string;
        channelTitle: string;
        thumbnailUrl: string;
        durationSeconds: number;
      }[]
    ) => {
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

  const totalMembersCount = presenceList.length || members.length || 1;

  return (
    <div
      style={
        isKeyboardOpen && viewportHeight
          ? {
              height: `${viewportHeight}px`,
              maxHeight: `${viewportHeight}px`,
            }
          : undefined
      }
      className="w-full h-[calc(100dvh-3.5rem)] sm:h-[calc(100dvh-4rem)] max-h-[calc(100dvh-3.5rem)] sm:max-h-[calc(100dvh-4rem)] shrink-0 flex flex-col bg-[#091B15] overflow-hidden overscroll-none"
    >
      {/* Persistent Remote Voice Audio Sink (independent of video player lifecycle) */}
      <audio ref={voiceAudioRef} autoPlay playsInline className="hidden" aria-hidden="true" />

      {/* Pinned Room Header (Clean, responsive groups, no chat button, accessible room info) */}
      <RoomHeader
        room={room}
        isHost={isHost}
        isCoHost={isCoHost}
        canControl={canControl}
        duoStatus={duoStatus}
        presenceList={presenceList}
        hostGraceSecondsLeft={hostGraceSecondsLeft}
        onChangeVideoClick={() => setIsChangeVideoOpen(true)}
        onOpenParticipants={() => {
          if (window.innerWidth < 1024) {
            setMobileTab('participants');
          } else {
            setIsParticipantsOpen(true);
          }
        }}
        onCloseRoom={isHost ? closeRoom : undefined}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        queueCount={queueItems.length}
        onOpenQueue={() => {
          if (window.innerWidth < 1024) {
            setMobileTab('queue');
          } else {
            setIsQueueOpen(true);
          }
        }}
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

      {/* Prominent Temporary Notification when someone joins the room (below header) */}
      {roomJoinNotice && (
        <div className="shrink-0 mx-3 my-1.5 px-3.5 py-2 rounded-xl bg-[#133227]/95 border border-[#7AD3A8]/35 shadow-lg flex items-center justify-between gap-3 text-xs animate-cinemaFadeUp z-20">
          <div className="flex items-center gap-2 min-w-0">
            <UserPlus className="w-4 h-4 text-[#9670FF] shrink-0" />
            <span className="text-[#F7F4EC] truncate">
              <strong className="font-semibold text-[#9670FF]">{roomJoinNotice.username}</strong>{' '}
              joined the room
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!voiceCall.isInCall && (
              <button
                type="button"
                onClick={() => void voiceCall.joinCall()}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7235A8]/50 hover:bg-[#7235A8] border border-[#9670FF]/50 text-xs font-semibold text-[#F7F4EC] transition-all cursor-pointer active:scale-95"
              >
                <PhoneCall className="w-3.5 h-3.5 text-[#B397FF]" />
                <span>Join Call</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setRoomJoinNotice(null)}
              className="p-1 text-[#CDBF9F] hover:text-[#F7F4EC] cursor-pointer"
              aria-label="Dismiss room join notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

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

      {/* Main Theater: Video Centerpiece + Dedicated Call Actions Toolbar + Tabs + Content */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left/Top Stage: Video Centerpiece & Controls */}
        <div
          className={`shrink-0 lg:shrink lg:flex-1 lg:min-w-0 lg:min-h-0 flex flex-col bg-[#091B15] transition-[margin] duration-280 cubic-bezier(0.32,0.72,0,1) ${
            isChatOpen
              ? 'px-3 pt-2 pb-1 sm:px-5 sm:pt-3 sm:pb-2 lg:p-3'
              : 'flex-1 min-h-0 p-3 sm:p-5 lg:p-3 justify-center'
          } ${isAnyDrawerOpen ? 'lg:mr-[32rem] xl:mr-[36rem]' : ''}`}
        >
          <div
            className={`w-full mx-auto flex flex-col ${
              isChatOpen
                ? 'max-w-[calc(26dvh*16/9)] sm:max-w-[calc(34dvh*16/9)] lg:max-w-none lg:flex-1 lg:min-h-0'
                : 'max-w-none flex-1 min-h-0 justify-center'
            }`}
          >
            {/* Screening Frame (16:9 on mobile, scales when keyboard opens) */}
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
                className={cn(
                  isChatOpen ? 'lg:aspect-auto lg:flex-1 lg:min-h-0' : 'aspect-video lg:aspect-auto flex-1 min-h-0 max-h-[82dvh]',
                  isKeyboardOpen && 'max-h-[130px] sm:max-h-[160px]'
                )}
              />
            ) : (
              <div className="relative w-full aspect-video lg:aspect-auto lg:flex-1 lg:min-h-0 bg-[#0D251C] rounded-xl border border-[#E8DDC5]/16 overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.55)] flex flex-col items-center justify-center text-center p-4 sm:p-6">
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

            {/* Dedicated Responsive Call Actions Toolbar (Mobile-first, prevents overlapping & accidental taps) */}
            <div className="lg:hidden shrink-0 mt-1">
              <CallActionsToolbar
                isHost={isHost}
                status={voiceCall.status}
                isInCall={voiceCall.isInCall}
                isLeaving={voiceCall.isLeaving}
                isCallFull={voiceCall.isCallFull}
                canStartCall={canStartCall}
                isMuted={voiceCall.isMuted}
                isLocalSpeaking={voiceCall.isLocalSpeaking}
                isPeerSpeaking={voiceCall.isPeerSpeaking}
                incomingCaller={voiceCall.incomingCaller}
                participants={voiceCall.participants}
                callJoinNotice={callJoinNotice}
                canControl={canControl}
                onJoinCall={() => {
                  void voiceCall.joinCall();
                }}
                onLeaveCall={() => voiceCall.leaveCall()}
                onToggleMute={voiceCall.toggleMute}
                onOpenParticipants={() => setMobileTab('participants')}
                onChangeVideo={() => openChangeVideo('youtube')}
              />
            </div>

            {/* Segmented Navigation Tabs on Mobile matching the luxury design */}
            <div className="lg:hidden shrink-0 border-b border-[#E8DDC5]/14 mt-1 flex items-center justify-around text-xs font-medium">
              {/* Tab 1: YouTube / Media */}
              <button
                type="button"
                onClick={() => setMobileTab('chat')}
                className={cn(
                  'flex-1 py-1.5 flex items-center justify-center gap-1.5 transition-colors relative cursor-pointer',
                  mobileTab === 'chat'
                    ? 'text-[#F7F4EC] font-semibold'
                    : 'text-[#CDBF9F]/75 hover:text-[#E8DDC5]'
                )}
                aria-label="View Chat"
              >
                <Play className="w-3.5 h-3.5 text-[#9670FF] fill-[#9670FF]" />
                <span>{room.videoType === 'youtube' ? 'YouTube' : 'Media'}</span>
                {mobileTab === 'chat' && (
                  <span className="absolute bottom-0 inset-x-4 h-0.5 bg-[#9670FF] rounded-full shadow-[0_0_8px_#9670FF]" />
                )}
              </button>

              {/* Tab 2: Queue */}
              <button
                type="button"
                onClick={() => setMobileTab('queue')}
                className={cn(
                  'flex-1 py-1.5 flex items-center justify-center gap-1.5 transition-colors relative cursor-pointer',
                  mobileTab === 'queue'
                    ? 'text-[#F7F4EC] font-semibold'
                    : 'text-[#CDBF9F]/75 hover:text-[#E8DDC5]'
                )}
                aria-label="View Queue"
              >
                <ListVideo className="w-3.5 h-3.5 text-[#9670FF]" />
                <span>Queue · {queueItems.length}</span>
                {mobileTab === 'queue' && (
                  <span className="absolute bottom-0 inset-x-4 h-0.5 bg-[#9670FF] rounded-full shadow-[0_0_8px_#9670FF]" />
                )}
              </button>

              {/* Tab 3: Participants */}
              <button
                type="button"
                onClick={() => setMobileTab('participants')}
                className={cn(
                  'flex-1 py-1.5 flex items-center justify-center gap-1.5 transition-colors relative cursor-pointer',
                  mobileTab === 'participants'
                    ? 'text-[#F7F4EC] font-semibold'
                    : 'text-[#CDBF9F]/75 hover:text-[#E8DDC5]'
                )}
                aria-label="View Participants"
              >
                <Users className="w-3.5 h-3.5 text-[#9670FF]" />
                <span>Participants · {totalMembersCount}</span>
                {mobileTab === 'participants' && (
                  <span className="absolute bottom-0 inset-x-4 h-0.5 bg-[#9670FF] rounded-full shadow-[0_0_8px_#9670FF]" />
                )}
              </button>
            </div>

            {/* Desktop Telemetry Strip (hidden on mobile where tabs provide clean access) */}
            <div className="hidden lg:flex mt-2 shrink-0 items-center justify-between gap-3 text-xs text-[#CDBF9F]/85 px-1">
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

              {/* Streamlined screening telemetry (Joiners and Upload / URL consolidated in RoomHeader to eliminate duplicates) */}
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
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[#7AD3A8]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7AD3A8] animate-pulse" />
                    <span>Voice Active ({voiceCall.participants.length})</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right/Bottom Lounge: Mobile Tab View (Chat / Queue / Participants) or Desktop Persistent Lounge */}
        <div
          className={cn(
            'flex-1 min-h-0 flex flex-col overflow-hidden',
            'lg:flex-none lg:w-[350px] xl:w-[380px] lg:h-full',
            !isChatOpen && 'lg:hidden'
          )}
        >
          {/* Mobile Tab 1 / Desktop: Chat takes all remaining vertical space on mobile; fixed sidebar on desktop */}
          <div
            className={cn(
              'h-full flex flex-col min-h-0 flex-1 overflow-hidden',
              mobileTab !== 'chat' && 'hidden lg:flex'
            )}
          >
            <ChatContainer
              roomId={room.id}
              user={user}
              partnerName={partnerLabel}
              channel={channel}
              members={members}
              presenceList={presenceList}
              initialHistory={initialChatHistory}
              isChatOpen={isChatOpen}
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

          {/* Mobile Tab 2: Inline Watch Queue */}
          {mobileTab === 'queue' && (
            <div className="lg:hidden flex-1 min-h-0 flex flex-col bg-[#0B1E17] overflow-hidden p-3 space-y-3">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-xs font-mono uppercase tracking-wider text-[#CDBF9F]">
                  Watch Queue ({queueItems.length})
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsYouTubeQueueOpen(true)}
                  className="h-7 px-3 text-xs rounded-full"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add Videos
                </Button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2 pr-0.5">
                {queueItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6 text-[#CDBF9F]/70">
                    <ListVideo className="w-8 h-8 text-[#9670FF]/40 mb-2" />
                    <p className="text-sm font-medium text-[#F7F4EC]">Queue is empty</p>
                    <p className="text-xs mt-1 max-w-xs">
                      Search YouTube and add videos to keep your party running seamlessly.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsYouTubeQueueOpen(true)}
                      className="mt-3 rounded-full"
                      leftIcon={<Plus className="w-3.5 h-3.5 text-[#9670FF]" />}
                    >
                      Find Videos to Add
                    </Button>
                  </div>
                ) : (
                  queueItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-[#132A21] border border-[#E8DDC5]/12 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="font-mono text-[11px] text-[#CDBF9F]/60 w-4 text-center shrink-0">
                          {index + 1}
                        </span>
                        {item.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="w-12 h-8 rounded object-cover shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[#F7F4EC] truncate">{item.title}</p>
                          <p className="text-[11px] text-[#CDBF9F]/70 truncate mt-0.5">
                            {item.channelTitle || 'YouTube'} · {formatTime(item.durationSeconds)}
                          </p>
                        </div>
                      </div>

                      {canControl && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => void playQueueItem(item)}
                            className="p-1.5 rounded-lg bg-[#9670FF]/20 text-[#B397FF] hover:bg-[#9670FF]/35 transition-colors cursor-pointer"
                            title="Play now"
                            aria-label={`Play ${item.title}`}
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeQueueItem(item.id)}
                            className="p-1.5 rounded-lg text-[#E87A70]/70 hover:text-[#E87A70] hover:bg-[#331B1A] transition-colors cursor-pointer"
                            title="Remove"
                            aria-label={`Remove ${item.title}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Mobile Tab 3: Inline Participants & Permissions */}
          {mobileTab === 'participants' && (
            <div className="lg:hidden flex-1 min-h-0 flex flex-col bg-[#0B1E17] overflow-hidden p-3 space-y-3">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-xs font-mono uppercase tracking-wider text-[#CDBF9F]">
                  Members &amp; Permissions
                </span>
                <span className="text-xs font-mono text-[#7AD3A8]">
                  {presenceList.length || members.length}/{SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} Online
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3 pr-0.5">
                {/* Host Authority & Delegation Permissions Controls */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-[#CDBF9F]/70">
                      Room Permissions
                    </span>
                    {isHost && (
                      <span className="text-[10px] font-mono text-[#9670FF] font-semibold bg-[#9670FF]/12 px-2 py-0.5 rounded-full border border-[#9670FF]/30">
                        Host Controls
                      </span>
                    )}
                  </div>

                  {/* Shared Playback Controls Switch */}
                  <div className="p-3 rounded-xl bg-[#132A21] border border-[#E8DDC5]/14 shadow-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-[#9670FF]/15 border border-[#9670FF]/40 text-[#B397FF] flex items-center justify-center shrink-0">
                          <Sliders className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-[#F7F4EC] truncate">
                            Shared Playback Controls
                          </h4>
                          <p className="text-[11px] text-[#CDBF9F] leading-tight mt-0.5">
                            {room.allowGuestControl
                              ? 'All members can control video'
                              : 'Host and Co-Hosts only'}
                          </p>
                        </div>
                      </div>

                      {isHost ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleControl()}
                          disabled={isTogglingControl}
                          className={cn(
                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50',
                            room.allowGuestControl ? 'bg-[#9670FF]' : 'bg-[#E8DDC5]/25'
                          )}
                          role="switch"
                          aria-checked={Boolean(room.allowGuestControl)}
                          title="Toggle playback permissions"
                        >
                          <span
                            className={cn(
                              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#F7F4EC] shadow-md ring-0 transition duration-200 ease-in-out',
                              room.allowGuestControl ? 'translate-x-5' : 'translate-x-0'
                            )}
                          />
                        </button>
                      ) : (
                        <Badge
                          variant={room.allowGuestControl ? 'success' : 'default'}
                          className="text-[10px] shrink-0"
                        >
                          {room.allowGuestControl ? 'Enabled' : 'Host Only'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Voice Call Initiation Permission Switch */}
                  <div className="p-3 rounded-xl bg-[#132A21] border border-[#E8DDC5]/14 shadow-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-[#9670FF]/15 border border-[#9670FF]/40 text-[#B397FF] flex items-center justify-center shrink-0">
                          <PhoneCall className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-[#F7F4EC] truncate">
                            Voice Call Initiation
                          </h4>
                          <p className="text-[11px] text-[#CDBF9F] leading-tight mt-0.5">
                            {room.allowGuestCall
                              ? 'All members can start calls'
                              : 'Host and Co-Hosts only'}
                          </p>
                        </div>
                      </div>

                      {isHost ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleCall()}
                          disabled={isTogglingCall}
                          className={cn(
                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50',
                            room.allowGuestCall ? 'bg-[#9670FF]' : 'bg-[#E8DDC5]/25'
                          )}
                          role="switch"
                          aria-checked={Boolean(room.allowGuestCall)}
                          title="Toggle voice call permissions"
                        >
                          <span
                            className={cn(
                              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#F7F4EC] shadow-md ring-0 transition duration-200 ease-in-out',
                              room.allowGuestCall ? 'translate-x-5' : 'translate-x-0'
                            )}
                          />
                        </button>
                      ) : (
                        <Badge
                          variant={room.allowGuestCall ? 'success' : 'default'}
                          className="text-[10px] shrink-0"
                        >
                          {room.allowGuestCall ? 'Enabled' : 'Host Only'}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Room Code & Invite Link Pill */}
                <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#0E281F] border border-[#E8DDC5]/14 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[#F7F4EC] font-semibold text-xs tracking-wider">
                      {room.code}
                    </span>
                    <span className="text-[#CDBF9F]/70 text-[11px] truncate">
                      · Invite code
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleMobileCopyLink()}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#173D30] border border-[#E8DDC5]/18 text-[11px] font-semibold text-[#E8DDC5] hover:text-[#F7F4EC] hover:border-[#9670FF]/50 transition-colors cursor-pointer shrink-0"
                  >
                    {mobileCopyCopied ? (
                      <>
                        <Check className="w-3 h-3 text-[#7AD3A8]" />
                        <span className="text-[#7AD3A8]">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-[#CDBF9F]" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Member List Header */}
                <div className="pt-1">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-[#CDBF9F]/70 px-0.5">
                    Participants ({presenceList.length || members.length})
                  </span>
                </div>

                {/* Participant Cards */}
                {(presenceList.length > 0 ? presenceList : members).map((participant) => {
                  const isCurrent = participant.userId === user.id;
                  const memberRole =
                    members.find((m) => m.userId === participant.userId)?.role ||
                    (participant.userId === room.hostId ? 'host' : 'viewer');
                  const isParticipantHost = memberRole === 'host';
                  const isParticipantCoHost = memberRole === 'co-host';
                  const callerMatch = voiceCall.participants.find(
                    (p) => p.userId === participant.userId
                  );

                  return (
                    <div
                      key={participant.userId}
                      className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-[#132A21] border border-[#E8DDC5]/12 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#1E4D3C] text-[#E8DDC5] font-bold flex items-center justify-center uppercase shrink-0">
                          {(participant.username || 'U').charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-[#F7F4EC] truncate max-w-[120px]">
                              {participant.username}
                            </span>
                            {isCurrent && (
                              <span className="text-[#CDBF9F]/65 text-[11px]">(You)</span>
                            )}
                            <Badge
                              variant={
                                isParticipantHost
                                  ? 'purple'
                                  : isParticipantCoHost
                                  ? 'success'
                                  : 'default'
                              }
                              className="text-[10px] py-0 px-1.5"
                            >
                              {isParticipantHost
                                ? 'Host'
                                : isParticipantCoHost
                                ? 'Co-Host'
                                : 'Viewer'}
                            </Badge>
                          </div>
                          {callerMatch && (
                            <p className="text-[11px] text-[#7AD3A8] flex items-center gap-1 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#7AD3A8] animate-pulse" />
                              <span>On Voice Call</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Host action controls */}
                      {isHost && !isCurrent && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              void updateMemberRole(
                                participant.userId,
                                isParticipantCoHost ? 'viewer' : 'co-host'
                              )
                            }
                            className="px-2 py-1 rounded-md bg-[#173D30] border border-[#E8DDC5]/15 text-[#CDBF9F] hover:text-[#F7F4EC] transition-colors cursor-pointer text-[11px]"
                          >
                            {isParticipantCoHost ? 'Demote' : 'Make Co-Host'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void kickMember(participant.userId)}
                            className="px-2 py-1 rounded-md bg-[#331B1A] border border-[#E87A70]/30 text-[#F2B8B2] hover:bg-[#4B2623] transition-colors cursor-pointer text-[11px]"
                          >
                            Kick
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Mobile Chat Reopen Pill when Chat is Minimized on desktop */}
      {!isChatOpen && (
        <button
          type="button"
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-4 right-4 z-30 hidden lg:flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#173D30] border border-[#9670FF]/60 text-[#F7F4EC] shadow-[0_8px_24px_rgba(0,0,0,0.6)] hover:bg-[#1E4B3C] active:scale-95 transition-all text-xs font-semibold cursor-pointer"
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

      {/* Room Queue Panel Slide Drawer */}
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

      {/* YouTube Queue Add Modal */}
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
