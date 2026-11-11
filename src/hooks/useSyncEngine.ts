'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { IVideoPlayerAdapter } from '@/core/types/player.types';
import { SyncEngine } from '@/core/sync/SyncEngine';
import { RealtimeChannel } from '@supabase/supabase-js';

interface UseSyncEngineProps {
  adapter: IVideoPlayerAdapter | null;
  channel: RealtimeChannel | null;
  roomId: string;
  userId: string;
  isHost: boolean;
}

export function useSyncEngine({
  adapter,
  channel,
  roomId,
  userId,
  isHost,
}: UseSyncEngineProps) {
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const [driftSeconds, setDriftSeconds] = useState<number>(0);
  const [isSynced, setIsSynced] = useState<boolean>(true);

  // Initialize and update SyncEngine
  useEffect(() => {
    if (!adapter || !roomId) return;

    const engine = new SyncEngine({
      adapter,
      channel,
      roomId,
      userId,
      isHost,
      onDriftUpdated: (drift, synced) => {
        setDriftSeconds(drift);
        setIsSynced(synced);
      },
    });

    syncEngineRef.current = engine;

    return () => {
      engine.destroy();
      syncEngineRef.current = null;
    };
  }, [adapter, roomId, userId, channel, isHost]);

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
