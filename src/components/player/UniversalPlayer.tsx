'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Volume1,
  RotateCcw,
  Film,
  Loader2,
} from 'lucide-react';
import { IVideoPlayerAdapter, VideoSourceType } from '@/core/types/player.types';
import { YouTubePlayerAdapter } from '@/core/adapters/YouTubePlayerAdapter';
import { HTML5VideoAdapter } from '@/core/adapters/HTML5VideoAdapter';
import { useSyncEngine } from '@/hooks/useSyncEngine';
import { useSession } from '@/hooks/useSession';
import { formatTime } from '@/lib/utils/time';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils/cn';

interface InitialPlaybackSnapshot {
  position: number;
  isPlaying: boolean;
  lastSyncedAt: string;
}

interface UniversalPlayerProps {
  videoUrl: string;
  videoType: VideoSourceType;
  roomId: string;
  isHost: boolean;
  hostName: string;
  channel: RealtimeChannel | null;
  initialPlayback?: InitialPlaybackSnapshot;
  onPersistSnapshot?: (position: number, isPlaying: boolean) => void;
  onVideoMismatch?: (videoUrl: string, videoType?: VideoSourceType) => void;
  className?: string;
}

export const UniversalPlayer: React.FC<UniversalPlayerProps> = ({
  videoUrl,
  videoType,
  roomId,
  isHost,
  hostName,
  channel,
  initialPlayback,
  onPersistSnapshot,
  onVideoMismatch,
  className,
}) => {
  const { user } = useSession();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerWrapperRef = useRef<HTMLDivElement | null>(null);
  const [adapter, setAdapter] = useState<IVideoPlayerAdapter | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [viewerAlert, setViewerAlert] = useState<string | null>(null);
  const [autoplayNotice, setAutoplayNotice] = useState<'muted' | 'blocked' | null>(null);
  const [isUnblocking, setIsUnblocking] = useState(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronization engine integration
  const { isSynced, driftSeconds, requestSync } = useSyncEngine({
    adapter,
    channel,
    roomId,
    userId: user.id,
    isHost,
    videoUrl,
    videoType,
    initialPlayback,
    onPersistSnapshot,
    onVideoMismatch,
  });

  // 1. Initialize Player Adapter (YouTube vs HTML5 Video)
  useEffect(() => {
    if (!containerRef.current || !videoUrl) return;

    let isMounted = true;
    const playerAdapter: IVideoPlayerAdapter =
      videoType === 'youtube'
        ? new YouTubePlayerAdapter()
        : new HTML5VideoAdapter();

    // Bind events BEFORE initialize() so READY and playback events are never missed
    playerAdapter.on('PLAY', (state) => {
      if (!isMounted) return;
      setIsPlaying(true);
      setIsBuffering(false);
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
      setAutoplayNotice((prev) => (prev === 'blocked' ? null : prev));
    });

    playerAdapter.on('PAUSE', (state) => {
      if (!isMounted) return;
      setIsPlaying(false);
      setCurrentTime(state.currentTime);
    });

    playerAdapter.on('BUFFERING', () => {
      if (!isMounted) return;
      setIsBuffering(true);
    });

    playerAdapter.on('SEEKED', (state) => {
      if (!isMounted) return;
      setCurrentTime(state.currentTime);
    });

    playerAdapter.on('READY', (state) => {
      if (!isMounted) return;
      setDuration(state.duration);
      setCurrentTime(state.currentTime);
    });

    playerAdapter.on('AUTOPLAY_MUTED', () => {
      if (!isMounted) return;
      setIsMuted(true);
      setAutoplayNotice('muted');
    });

    playerAdapter.on('AUTOPLAY_BLOCKED', () => {
      if (!isMounted) return;
      setIsPlaying(false);
      setAutoplayNotice('blocked');
    });

    playerAdapter
      .initialize(containerRef.current, videoUrl)
      .then(() => {
        if (!isMounted) {
          playerAdapter.destroy();
          return;
        }
        setAdapter(playerAdapter);
        const initialState = playerAdapter.getPlaybackState();
        setDuration(initialState.duration);
        setCurrentTime(initialState.currentTime);
      })
      .catch((err) => {
        console.warn('[Syncora] Player initialization error:', err);
      });

    return () => {
      isMounted = false;
      playerAdapter.destroy();
      setAdapter(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setAutoplayNotice(null);
    };
  }, [videoUrl, videoType]);

  // Periodic time update ticker
  useEffect(() => {
    if (!adapter) return;

    const interval = setInterval(() => {
      const state = adapter.getPlaybackState();
      setCurrentTime(state.currentTime);
      if (state.duration > 0 && duration === 0) {
        setDuration(state.duration);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [adapter, duration]);

  // Sync fullscreen button icon when user presses Escape
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Handle Controls overlay auto-hide
  const handleMouseMove = useCallback(() => {
    setIsControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);

    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 3000);
    }
  }, [isPlaying]);

  // Controls
  const handleUserUnblockPlayback = async () => {
    if (!adapter || isUnblocking) return;
    setIsUnblocking(true);
    try {
      const restoreVol = volume > 0 ? volume : 0.8;
      setVolume(restoreVol);
      setIsMuted(false);
      adapter.setVolume(restoreVol);
      setAutoplayNotice(null);
      await adapter.play();
      requestSync();
    } finally {
      setIsUnblocking(false);
    }
  };

  const togglePlay = () => {
    if (!adapter) return;
    if (!isHost) {
      if (autoplayNotice === 'blocked') {
        void handleUserUnblockPlayback();
        return;
      }
      if (autoplayNotice === 'muted') {
        toggleMute();
        return;
      }
      triggerViewerAlert();
      return;
    }

    if (isPlaying) {
      adapter.pause();
    } else {
      adapter.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = parseFloat(e.target.value);
    if (!adapter) return;

    if (!isHost) {
      triggerViewerAlert();
      return;
    }

    setCurrentTime(target);
    adapter.seekTo(target);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    setIsMuted(vol === 0);
    if (vol > 0 && autoplayNotice === 'muted') {
      setAutoplayNotice(null);
    }
    adapter?.setVolume(vol);
  };

  const toggleMute = () => {
    if (!adapter) return;
    if (isMuted) {
      const restoreVol = volume > 0 ? volume : 0.8;
      setVolume(restoreVol);
      setIsMuted(false);
      if (autoplayNotice === 'muted') {
        setAutoplayNotice(null);
      }
      adapter.setVolume(restoreVol);
    } else {
      setIsMuted(true);
      adapter.setVolume(0);
    }
  };

  const toggleFullscreen = () => {
    if (!playerWrapperRef.current) return;

    if (!document.fullscreenElement) {
      playerWrapperRef.current.requestFullscreen().catch((err) => {
        console.warn('[Syncora] Fullscreen error:', err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const triggerViewerAlert = () => {
    setViewerAlert(`${hostName} is controlling playback. Your screen stays in sync.`);
    setTimeout(() => setViewerAlert(null), 3000);
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={playerWrapperRef}
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
      className={cn(
        'relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.65)] group select-none border border-[#E8DDC5]/16',
        className
      )}
    >
      {/* Target Mount for Video Adapter */}
      <div ref={containerRef} className="w-full h-full pointer-events-auto" />

      {/* Autoplay Notice Banner (always clickable even if controls overlay auto-hides) */}
      {autoplayNotice === 'muted' && (
        <button
          type="button"
          onClick={toggleMute}
          className="absolute top-12 sm:top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-[#EDE2CA] hover:bg-[#F7F4EC] text-[#102B23] text-xs font-semibold px-4 py-2 rounded-full shadow-lg border border-[#CDBF9F] cursor-pointer transition-colors whitespace-nowrap"
        >
          <VolumeX className="w-3.5 h-3.5 text-[#7235A8]" />
          <span>Playing muted — Click to Unmute</span>
        </button>
      )}

      {autoplayNotice === 'blocked' && (
        <button
          type="button"
          onClick={() => void handleUserUnblockPlayback()}
          disabled={isUnblocking}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex items-center gap-2.5 bg-[#7235A8] hover:bg-[#8342BE] text-[#F7F4EC] text-xs sm:text-sm font-semibold px-5 py-3 rounded-full shadow-xl border border-[#9670FF]/50 cursor-pointer transition-colors disabled:opacity-70 disabled:pointer-events-none"
        >
          {isUnblocking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
          <span>{isUnblocking ? 'Starting Playback…' : 'Click to Start Synced Playback'}</span>
        </button>
      )}

      {/* Viewer Floating Alert */}
      {viewerAlert && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-[#EDE2CA] border border-[#CDBF9F] text-[#102B23] font-medium text-xs px-4 py-2 rounded-full shadow-xl cinema-enter max-w-[90%] text-center">
          {viewerAlert}
        </div>
      )}

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#091B15]/45 pointer-events-none">
          <div className="w-10 h-10 border-2 border-[#E8DDC5]/25 border-t-[#9670FF] rounded-full animate-spin" />
        </div>
      )}

      {/* Custom Cinema Controls Overlay */}
      <div
        className={`absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-4 bg-gradient-to-t from-[#081511]/90 via-transparent to-[#081511]/45 transition-opacity duration-200 ${
          isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top Overlay Bar */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <Badge
              variant="purple"
              dot
              className="bg-[#0E281F]/90 border-[#9670FF]/50 text-[#F7F4EC] text-[10px] sm:text-[11px]"
            >
              {isHost ? 'Host Authority' : `Synced · ${hostName}`}
            </Badge>

            <Badge
              variant="default"
              className="bg-[#0E281F]/88 border-[#E8DDC5]/20 text-[#CDBF9F] text-[10px] sm:text-[11px] hidden sm:inline-flex gap-1"
            >
              <Film className="w-3 h-3 text-[#E8DDC5]" />
              {videoType === 'youtube' ? 'YouTube' : 'Personal Stream'}
            </Badge>

            {!isHost && (
              <Badge
                variant={isSynced ? 'success' : 'warning'}
                dot
                className="text-[10px] sm:text-[11px]"
              >
                {isSynced ? 'In Sync' : `Drift ${driftSeconds.toFixed(1)}s`}
              </Badge>
            )}
          </div>

          {!isHost && (
            <button
              type="button"
              onClick={requestSync}
              className="flex items-center gap-1.5 text-[11px] font-medium text-[#E8DDC5] hover:text-[#F7F4EC] bg-[#0E281F]/90 hover:bg-[#173D30] px-3 py-1 rounded-full border border-[#E8DDC5]/22 hover:border-[#9670FF]/60 transition-colors cursor-pointer shrink-0"
              title="Resync video with host"
            >
              <RotateCcw className="w-3 h-3 text-[#9670FF]" />
              <span>Resync</span>
            </button>
          )}
        </div>

        {/* Center Play/Pause Click Handler */}
        <div
          onClick={togglePlay}
          className="flex-1 flex items-center justify-center cursor-pointer"
        >
          {(!isPlaying || isControlsVisible) && autoplayNotice !== 'blocked' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              className="w-13 h-13 sm:w-16 sm:h-16 rounded-full bg-[#0E281F]/88 hover:bg-[#173D30] border border-[#E8DDC5]/35 hover:border-[#9670FF] text-[#F7F4EC] flex items-center justify-center shadow-xl transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
              ) : (
                <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-0.5" />
              )}
            </button>
          )}
        </div>

        {/* Bottom Control Strip */}
        <div className="space-y-2.5">
          {/* Seek Scrubber Bar */}
          <div className="relative group/scrubber flex items-center h-3">
            {/* Track */}
            <div className="w-full h-1 bg-[#E8DDC5]/24 rounded-full overflow-hidden group-hover/scrubber:h-1.5 transition-all">
              <div
                className="h-full bg-[#9670FF]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Interactive Range Input */}
            <input
              type="range"
              aria-label="Seek video position"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!isHost}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>

          {/* Action Buttons & Timecode Row */}
          <div className="flex items-center justify-between text-xs text-[#F7F4EC]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="p-1 rounded-md text-[#E8DDC5] hover:text-[#F7F4EC] transition-colors cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
              </button>

              <div className="font-mono text-[11px] sm:text-xs tabular-nums text-[#E8DDC5]">
                <span>{formatTime(currentTime)}</span>
                <span className="text-[#CDBF9F]/45 mx-1.5">/</span>
                <span className="text-[#CDBF9F]">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Volume Controller */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-1 text-[#E8DDC5] hover:text-[#F7F4EC] transition-colors cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-[#E87A70]" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-14 sm:w-20 h-1 bg-[#E8DDC5]/25 rounded-full accent-[#9670FF] cursor-pointer"
                />
              </div>

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="p-1 text-[#E8DDC5] hover:text-[#F7F4EC] transition-colors cursor-pointer"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? (
                  <Minimize className="w-4 h-4" />
                ) : (
                  <Maximize className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
