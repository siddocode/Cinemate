import { QueueVideoInput, RoomQueueItem } from '@/core/types/room.types';
import { Database } from '@/lib/supabase/database.types';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

type QueueRow = Database['public']['Tables']['room_queue_items']['Row'];

const devQueues = new Map<string, RoomQueueItem[]>();

export function mapQueueRow(row: QueueRow): RoomQueueItem {
  return {
    id: row.id,
    roomId: row.room_id,
    videoId: row.video_id,
    videoUrl: row.video_url,
    videoType: row.video_type,
    title: row.title,
    channelTitle: row.channel_title || undefined,
    thumbnailUrl: row.thumbnail_url || undefined,
    durationSeconds: row.duration_seconds || 0,
    position: row.position,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

export function sortQueueItems(items: RoomQueueItem[]): RoomQueueItem[] {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function mergeQueueItem(
  items: RoomQueueItem[],
  incoming: RoomQueueItem
): RoomQueueItem[] {
  const withoutDuplicate = items.filter((item) => item.id !== incoming.id);
  return sortQueueItems([...withoutDuplicate, incoming]);
}

function isMissingRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    Boolean(error.message?.includes('Could not find the function'))
  );
}

function toRpcInput(roomId: string, video: QueueVideoInput) {
  return {
    p_room_id: roomId,
    p_video_id: video.videoId?.trim() || '',
    p_video_url: video.videoUrl?.trim() || '',
    p_video_type: video.videoType,
    p_title: video.title.trim().slice(0, 300) || 'Untitled video',
    p_channel_title: video.channelTitle?.trim().slice(0, 200) || null,
    p_thumbnail_url: video.thumbnailUrl?.trim() || null,
    p_duration_seconds: Math.max(0, Math.floor(video.durationSeconds || 0)),
  };
}

export const queueService = {
  async getQueue(roomId: string): Promise<RoomQueueItem[]> {
    if (!isSupabaseConfigured()) {
      return sortQueueItems(devQueues.get(roomId) || []);
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('room_queue_items')
      .select('*')
      .eq('room_id', roomId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return sortQueueItems((data || []).map(mapQueueRow));
  },

  async addItem(
    roomId: string,
    userId: string,
    video: QueueVideoInput
  ): Promise<RoomQueueItem> {
    if (!isSupabaseConfigured()) {
      const existing = devQueues.get(roomId) || [];
      const item: RoomQueueItem = {
        id: crypto.randomUUID ? crypto.randomUUID() : `queue-${Date.now()}`,
        roomId,
        videoId: video.videoId || '',
        videoUrl: video.videoUrl || '',
        videoType: video.videoType,
        title: video.title,
        channelTitle: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
        durationSeconds: video.durationSeconds || 0,
        position: existing.length,
        addedBy: userId,
        createdAt: new Date().toISOString(),
      };
      devQueues.set(roomId, [...existing, item]);
      return item;
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('add_room_queue_item', toRpcInput(roomId, video));

    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as QueueRow;
      return mapQueueRow(row);
    }

    if (error && !isMissingRpcError(error)) {
      throw new Error(error.message);
    }

    const { data: maxRow } = await supabase
      .from('room_queue_items')
      .select('position')
      .eq('room_id', roomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const insertPayload: Database['public']['Tables']['room_queue_items']['Insert'] = {
      room_id: roomId,
      video_id: toRpcInput(roomId, video).p_video_id,
      video_url: toRpcInput(roomId, video).p_video_url,
      video_type: video.videoType,
      title: video.title.trim().slice(0, 300) || 'Untitled video',
      channel_title: video.channelTitle?.trim().slice(0, 200) || null,
      thumbnail_url: video.thumbnailUrl?.trim() || null,
      duration_seconds: Math.max(0, Math.floor(video.durationSeconds || 0)),
      position: (maxRow?.position ?? -1) + 1,
      added_by: userId,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('room_queue_items')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message || 'Could not add video to the queue.');
    }

    return mapQueueRow(inserted);
  },

  async addItems(
    roomId: string,
    userId: string,
    videos: QueueVideoInput[]
  ): Promise<RoomQueueItem[]> {
    const added: RoomQueueItem[] = [];
    for (const video of videos) {
      added.push(await queueService.addItem(roomId, userId, video));
    }
    return added;
  },

  async removeItem(itemId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      devQueues.forEach((items, roomId) => {
        devQueues.set(
          roomId,
          items.filter((item) => item.id !== itemId)
        );
      });
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('room_queue_items').delete().eq('id', itemId);
    if (error) throw new Error(error.message);
  },

  async reorderItems(roomId: string, orderedItemIds: string[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      const items = devQueues.get(roomId) || [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const reordered = orderedItemIds
        .map((id, index) => {
          const item = byId.get(id);
          return item ? { ...item, position: index } : null;
        })
        .filter((item): item is RoomQueueItem => Boolean(item));
      devQueues.set(roomId, reordered);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.rpc('reorder_room_queue', {
      p_room_id: roomId,
      p_item_ids: orderedItemIds,
    });

    if (!error) return;
    if (!isMissingRpcError(error)) throw new Error(error.message);

    const updates = orderedItemIds.map((id, index) =>
      supabase.from('room_queue_items').update({ position: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
  },

  async clearQueue(roomId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      devQueues.delete(roomId);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('room_queue_items').delete().eq('room_id', roomId);
    if (error) throw new Error(error.message);
  },
};
