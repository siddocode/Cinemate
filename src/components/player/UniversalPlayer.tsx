'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Zap,
  Volume1,
  RotateCcw,
  Film,
} from 'lucide-react';
import { IVideoPlayerAdapter, VideoSourceType } from '@/core/types/player.types';
import { YouTubePlayerAdapter } from '@/core/adapters/YouTubePlayerAdapter';
import { HTML5VideoAdapter } from '@/core/adapters/HTML5VideoAdapter';
import { useSyncEngine } from '@/hooks/useSyncEngine';
import { useSession } from '@/hooks/useSession';
import { formatTime } from '@/lib/utils/time';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Badge } from '@/components/ui/Badge';

interface UniversalPlayerProps {
  videoUrl: string;
  videoType: VideoSourceType;
  roomId: string;
  isHost: boolean;
  hostName: string;
  channel: RealtimeChannel | null;
}

export const UniversalPlayer: React.FC<UniversalPlayerProps> = ({
  videoUrl,
  videoType,
  roomId,
  isHost,
  hostName,
  channel,
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

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronization engine integration
  const { isSynced, driftSeconds, requestSync } = useSyncEngine({
    adapter,
    channel,
    roomId,
    userId: user.id,
    isHost,
  });

  // 1. Initialize Player Adapter (YouTube vs HTML5 Video)
  useEffect(() => {
    if (!containerRef.current || !videoUrl) return;

    let isMounted = true;
    const playerAdapter: IVideoPlayerAdapter =
      videoType === 'youtube'
        ? new YouTubePlayerAdapter()
        : new HTML5VideoAdapter();

    playerAdapter
      .initialize(containerRef.current, videoUrl)
      .then(() => {
        if (!isMounted) {
          playerAdapter.destroy();
          return;
        }

        setAdapter(playerAdapter);

        // Bind events
        playerAdapter.on('PLAY', (state) => {
          setIsPlaying(true);
          setIsBuffering(false);
          setCurrentTime(state.currentTime);
          setDuration(state.duration);
        });

        playerAdapter.on('PAUSE', (state) => {
          setIsPlaying(false);
          setCurrentTime(state.currentTime);
        });

        playerAdapter.on('BUFFERING', () => {
          setIsBuffering(true);
        });

        playerAdapter.on('SEEKED', (state) => {
          setCurrentTime(state.currentTime);
        });

        playerAdapter.on('READY', (state) => {
          setDuration(state.duration);
          setCurrentTime(state.currentTime);
        });
      })
      .catch((err) => {
        console.warn('[Syncora] Player initialization error:', err);
      });

    return () => {
      isMounted = false;
      playerAdapter.destroy();
      setAdapter(null);
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
  const togglePlay = () => {
    if (!adapter) return;
    if (!isHost) {
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
    adapter?.setVolume(vol);
  };

  const toggleMute = () => {
    if (!adapter) return;
    if (isMuted) {
      const restoreVol = volume > 0 ? volume : 0.8;
      setVolume(restoreVol);
      setIsMuted(false);
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
    setViewerAlert(`${hostName} is controlling playback. Your video stays in sync!`);
    setTimeout(() => setViewerAlert(null), 3000);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={playerWrapperRef}
      onMouseMove={handleMouseMove}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl group select-none border border-neutral-800"
    >
      {/* Target Mount for Video Adapter */}
      <div ref={containerRef} className="w-full h-full pointer-events-auto" />

      {/* Viewer Floating Alert */}
      {viewerAlert && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-neutral-900/90 border border-neutral-700 text-white text-xs px-4 py-2 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95">
          {viewerAlert}
        </div>
      )}

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Custom Cinema Controls Overlay */}
      <div
        className={`absolute inset-0 z-20 flex flex-col justify-between p-4 bg-gradient-to-t from-black/80 via-transparent to-black/40 transition-opacity duration-300 ${
          isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top Overlay Bar */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Badge variant="purple" className="text-[11px] font-semibold">
              <Zap className="w-3 h-3 text-indigo-400" />
              {isHost ? 'Host Authority' : `Synced with ${hostName}`}
            </Badge>

            <Badge variant="default" className="text-[11px] hidden sm:inline-flex gap-1">
              <Film className="w-3 h-3 text-neutral-400" />
              {videoType === 'youtube' ? 'YouTube' : 'Personal Video'}
            </Badge>

            {!isHost && (
              <Badge
                variant={isSynced ? 'success' : 'warning'}
                dot
                className="text-[11px]"
              >
                {isSynced ? 'In Sync' : `Drift: ${driftSeconds.toFixed(1)}s`}
              </Badge>
            )}
          </div>

          {!isHost && (
            <button
              onClick={requestSync}
              className="flex items-center gap-1 text-[11px] text-neutral-300 hover:text-white bg-black/40 hover:bg-black/60 px-2.5 py-1 rounded-lg border border-neutral-700/60 transition-colors cursor-pointer"
              title="Resync video with host"
            >
              <RotateCcw className="w-3 h-3 text-indigo-400" />
              <span>Resync</span>
            </button>
          )}
        </div>

        {/* Big Center Play/Pause Click Handler */}
        <div
          onClick={togglePlay}
          className="flex-1 flex items-center justify-center cursor-pointer"
        >
          {(!isPlaying || isControlsVisible) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="w-16 h-16 rounded-full bg-indigo-600/90 hover:bg-indigo-600 text-white flex items-center justify-center shadow-2xl transition-transform hover:scale-110 active:scale-95"
            >
              {isPlaying ? (
                <Pause className="w-8 h-8 fill-white" />
              ) : (
                <Play className="w-8 h-8 fill-white ml-1" />
              )}
            </button>
          )}
        </div>

        {/* Bottom Control Strip */}
        <div className="space-y-2">
          {/* Seek Scrubber Bar */}
          <div className="relative group/scrubber flex items-center">
            {/* Background track */}
            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden group-hover/scrubber:h-2.5 transition-all">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Interactive Range Input */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!isHost}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>

          {/* Action Buttons & Time Row */}
          <div className="flex items-center justify-between text-xs text-neutral-200">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="p-1 rounded-lg hover:text-white transition-colors cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
              </button>

              <div className="font-mono text-xs text-neutral-300">
                <span>{formatTime(currentTime)}</span>
                <span className="text-neutral-500 mx-1">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Volume Controller */}
              <div className="flex items-center gap-1.5 group/volume">
                <button
                  onClick={toggleMute}
                  className="p-1 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-neutral-700 rounded-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                className="p-1 text-neutral-300 hover:text-white transition-colors cursor-pointer"
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
