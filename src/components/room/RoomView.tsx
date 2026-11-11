'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Tv,
  ArrowLeft,
  Users2,
} from 'lucide-react';
import { useRoom } from '@/hooks/useRoom';
import { useSession } from '@/hooks/useSession';
import { RoomHeader } from './RoomHeader';
import { ChangeVideoModal } from './ChangeVideoModal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { UniversalPlayer } from '@/components/player/UniversalPlayer';
import { ChatContainer } from '@/components/chat/ChatContainer';

interface RoomViewProps {
  roomCode: string;
  initialVideoId?: string;
}

export const RoomView: React.FC<RoomViewProps> = ({
  roomCode,
  initialVideoId,
}) => {
  const { user } = useSession();
  const {
    room,
    isHost,
    duoStatus,
    hostGraceSecondsLeft,
    isLoading,
    error,
    updateVideo,
    channel,
  } = useRoom(roomCode);

  const [isChangeVideoOpen, setIsChangeVideoOpen] = useState(false);
  const hasLoadedInitialVideo = useRef(false);

  // If initial video was provided in query params and room has none, update it
  useEffect(() => {
    if (room && initialVideoId && !room.videoUrl && isHost && !hasLoadedInitialVideo.current) {
      hasLoadedInitialVideo.current = true;
      updateVideo(initialVideoId);
    }
  }, [room, initialVideoId, isHost, updateVideo]);

  // Loading Screen
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#090a0f] text-neutral-300">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h3 className="text-base font-semibold text-white">Connecting to Watch Party...</h3>
        <p className="text-xs text-neutral-500 mt-1">Preparing room & synchronizing presence</p>
      </div>
    );
  }

  // Error Screen
  if (error || !room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#090a0f] p-4 text-center">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <Tv className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Room Unavailable</h3>
            <p className="text-xs text-neutral-400 mt-1">
              {error || 'The requested watch room could not be loaded.'}
            </p>
          </div>
          <Link href="/">
            <Button variant="primary" size="md" className="w-full" leftIcon={<ArrowLeft className="w-4 h-4" />}>
              Back to Home
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] bg-[#090a0f] overflow-hidden">
      {/* Dynamic Room Header */}
      <RoomHeader
        room={room}
        isHost={isHost}
        duoStatus={duoStatus}
        hostGraceSecondsLeft={hostGraceSecondsLeft}
        onChangeVideoClick={() => setIsChangeVideoOpen(true)}
      />

      {/* Main Watch Area: Side-by-Side Theater Mode on Desktop, Stacked on Mobile */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Column: Video Theater Container (70% width on Desktop) */}
        <div className="flex-1 flex flex-col bg-black/60 p-3 sm:p-4 lg:p-6 overflow-y-auto">
          <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col justify-center">
            {/* 16:9 Video Frame */}
            {room.videoUrl ? (
              <UniversalPlayer
                videoUrl={room.videoUrl}
                videoType={room.videoType}
                roomId={room.id}
                isHost={isHost}
                hostName={isHost ? user.username : (duoStatus.partner?.username || 'Host')}
                channel={channel}
              />
            ) : (
              <div className="relative w-full aspect-video bg-neutral-950 rounded-2xl border border-neutral-800/80 overflow-hidden shadow-2xl flex flex-col items-center justify-center text-center group">
                <div className="flex flex-col items-center max-w-md p-6">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 animate-pulse">
                    <Tv className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-white">No Video Loaded Yet</h3>
                  <p className="text-xs text-neutral-400 mt-2 max-w-sm">
                    {isHost
                      ? 'As host, choose a YouTube video, direct video URL, or upload a video clip up to 50MB to start watching.'
                      : 'Waiting for the host to select a video...'}
                  </p>
                  {isHost && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-4"
                      onClick={() => setIsChangeVideoOpen(true)}
                      leftIcon={<Tv className="w-4 h-4" />}
                    >
                      Choose Video
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Video Status Bar */}
            <div className="mt-4 flex items-center justify-between text-xs text-neutral-400 px-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {room.videoUrl
                    ? room.videoType === 'youtube'
                      ? 'Playing YouTube'
                      : 'Playing Personal Video'
                    : 'Duo Watch Room Ready'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-neutral-500">
                <Users2 className="w-3.5 h-3.5" />
                <span>
                  {duoStatus.isPartnerConnected
                    ? `Watching with ${duoStatus.partner?.username}`
                    : '1 viewer online'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Realtime Persistent Live Duo Chat */}
        <ChatContainer
          roomId={room.id}
          user={user}
          partnerName={duoStatus.partner?.username}
          channel={channel}
        />
      </div>

      {/* Change Video Modal */}
      <ChangeVideoModal
        isOpen={isChangeVideoOpen}
        onClose={() => setIsChangeVideoOpen(false)}
        roomId={room.id}
        currentVideoUrl={room.videoUrl}
        onSelectVideo={updateVideo}
      />
    </div>
  );
};
