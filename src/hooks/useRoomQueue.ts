'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QueueVideoInput, RoomQueueItem } from '@/core/types/room.types';
import { queueService, mapQueueRow, mergeQueueItem, sortQueueItems } from '@/lib/services/queueService';
import { subscribeToRoomQueueChanges } from '@/lib/supabase/roomRealtimeBus';
import { useSession } from './useSession';

export function useRoomQueue(roomId?: string) {
  const { user } = useSession();
  const [items, setItems] = useState<RoomQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedRoomId, setLoadedRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!roomId) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const loaded = await queueService.getQueue(roomId);
      if (isMountedRef.current) setItems(loaded);
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Could not load the watch queue.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setLoadedRoomId(roomId);
      }
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void refresh();
    });

    const unsubscribe = subscribeToRoomQueueChanges(roomId, (change) => {
      if (change.eventType === 'DELETE') {
        const deletedId = change.oldRow?.id;
        if (deletedId) {
          setItems((prev) => prev.filter((item) => item.id !== deletedId));
        }
        return;
      }

      if (change.newRow) {
        const mapped = mapQueueRow(change.newRow);
        setItems((prev) => mergeQueueItem(prev, mapped));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId, refresh]);

  const addItem = useCallback(
    async (video: QueueVideoInput): Promise<RoomQueueItem | null> => {
      if (!roomId || !user.id) return null;
      setError(null);
      try {
        const item = await queueService.addItem(roomId, user.id, video);
        if (isMountedRef.current) {
          setItems((prev) => mergeQueueItem(prev, item));
        }
        return item;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Could not add that video.';
        if (isMountedRef.current) setError(message);
        throw err;
      }
    },
    [roomId, user.id]
  );

  const addItems = useCallback(
    async (videos: QueueVideoInput[]): Promise<RoomQueueItem[]> => {
      const added: RoomQueueItem[] = [];
      for (const video of videos) {
        const item = await addItem(video);
        if (item) added.push(item);
      }
      return added;
    },
    [addItem]
  );

  const removeItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      if (!roomId) return false;
      const snapshot = items;
      setBusyItemId(itemId);
      setError(null);
      setItems((prev) => prev.filter((item) => item.id !== itemId));

      try {
        await queueService.removeItem(itemId);
        return true;
      } catch (err: unknown) {
        if (isMountedRef.current) {
          setItems(snapshot);
          setError(err instanceof Error ? err.message : 'Could not remove that video.');
        }
        return false;
      } finally {
        if (isMountedRef.current) setBusyItemId(null);
      }
    },
    [items, roomId]
  );

  const moveItem = useCallback(
    async (itemId: string, direction: 'up' | 'down'): Promise<boolean> => {
      if (!roomId) return false;
      const index = items.findIndex((item) => item.id === itemId);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
        return false;
      }

      const snapshot = items;
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      const positioned = next.map((item, position) => ({ ...item, position }));

      setItems(positioned);
      setBusyItemId(itemId);
      setError(null);

      try {
        await queueService.reorderItems(
          roomId,
          positioned.map((item) => item.id)
        );
        return true;
      } catch (err: unknown) {
        if (isMountedRef.current) {
          setItems(snapshot);
          setError(err instanceof Error ? err.message : 'Could not reorder the queue.');
        }
        return false;
      } finally {
        if (isMountedRef.current) setBusyItemId(null);
      }
    },
    [items, roomId]
  );

  const clearQueue = useCallback(async (): Promise<boolean> => {
    if (!roomId) return false;
    const snapshot = items;
    setItems([]);
    setError(null);
    try {
      await queueService.clearQueue(roomId);
      return true;
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setItems(snapshot);
        setError(err instanceof Error ? err.message : 'Could not clear the queue.');
      }
      return false;
    }
  }, [items, roomId]);

  return {
    items: roomId ? sortQueueItems(items) : [],
    isLoading: roomId ? isLoading || loadedRoomId !== roomId : false,
    error,
    busyItemId,
    refresh,
    addItem,
    addItems,
    removeItem,
    moveItem,
    clearQueue,
    setError,
  };
}
