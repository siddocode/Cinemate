'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { IVideoPlayerAdapter, VideoSourceType } from '@/core/types/player.types';
import { SyncEngine } from '@/core/sync/SyncEngine';
import { RealtimeChannel } from '@supabase/supabase-js';

interface InitialPlaybackSnapshot {
  position: number;
  isPlaying: boolean;
  lastSyncedAt: string;
}

interface UseSyncEngineProps {
  adapter: IVideoPlayerAdapter | null;
  channel: RealtimeChannel | null;
  roomId: string;
  userId: string;
  isHost: boolean;
  videoUrl?: string;
  videoType?: VideoSourceType;
  initialPlayback?: InitialPlaybackSnapshot;
  onPersistSnapshot?: (position: number, isPlaying: boolean) => void;
  onVideoMismatch?: (videoUrl: string, videoType?: VideoSourceType) => void;
}

export function useSyncEngine({
  adapter,
  channel,
  roomId,
  userId,
  isHost,
  videoUrl,
  videoType,
  initialPlayback,
  onPersistSnapshot,
  onVideoMismatch,
}: UseSyncEngineProps) {
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const [driftSeconds, setDriftSeconds] = useState<number>(0);
  const [isSynced, setIsSynced] = useState<boolean>(true);

  const initialPlaybackRef = useRef(initialPlayback);
  const onPersistSnapshotRef = useRef(onPersistSnapshot);
  const onVideoMismatchRef = useRef(onVideoMismatch);

  useEffect(() => {
    initialPlaybackRef.current = initialPlayback;
  }, [initialPlayback]);

  useEffect(() => {
    onPersistSnapshotRef.current = onPersistSnapshot;
  }, [onPersistSnapshot]);

  useEffect(() => {
    onVideoMismatchRef.current = onVideoMismatch;
  }, [onVideoMismatch]);

  // Initialize and update SyncEngine
  useEffect(() => {
    if (!adapter || !roomId) return;

    const engine = new SyncEngine({
      adapter,
      channel,
      roomId,
      userId,
      isHost,
      videoUrl,
      videoType,
      initialPlayback: initialPlaybackRef.current,
      onDriftUpdated: (drift, synced) => {
        setDriftSeconds(drift);
        setIsSynced(synced);
      },
      onPersistSnapshot: (pos, playing) => {
        onPersistSnapshotRef.current?.(pos, playing);
      },
      onVideoMismatch: (newUrl, newType) => {
        onVideoMismatchRef.current?.(newUrl, newType);
      },
    });

    syncEngineRef.current = engine;

    return () => {
      engine.destroy();
      syncEngineRef.current = null;
    };
  }, [adapter, roomId, userId, channel, isHost, videoUrl, videoType]);

  // Tab visibility change auto-resync
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isHost && syncEngineRef.current) {
        syncEngineRef.current.requestInitialSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost]);

  const requestSync = useCallback(() => {
    syncEngineRef.current?.requestInitialSync();
  }, []);

  return {
    driftSeconds,
    isSynced,
    requestSync,
  };
}
