import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export interface FavoriteItem {
  id: string;
  userId: string;
  roomCode?: string;
  videoId: string;
  videoTitle: string;
  thumbnailUrl?: string;
  createdAt: string;
}

// Local storage fallback key prefix per user
const getStorageKey = (userId: string) => `syncora_favorites_${userId}`;

class FavoriteService {
  private memoryFallback: Map<string, FavoriteItem[]> = new Map();

  async getFavorites(userId: string): Promise<FavoriteItem[]> {
    if (!userId) return [];

    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from('user_favorites')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          return data.map((d) => ({
            id: d.id,
            userId: d.user_id,
            roomCode: d.room_code || undefined,
            videoId: d.video_id,
            videoTitle: d.video_title,
            thumbnailUrl: d.thumbnail_url || undefined,
            createdAt: d.created_at,
          }));
        }
      } catch {
        // Fallback below
      }
    }

    // LocalStorage or memory fallback
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(getStorageKey(userId));
        if (stored) {
          return JSON.parse(stored);
        }
      } catch {
        // Ignore parse error
      }
    }

    return this.memoryFallback.get(userId) || [];
  }

  async addFavorite(
    userId: string,
    item: {
      roomCode?: string;
      videoId: string;
      videoTitle: string;
      thumbnailUrl?: string;
    }
  ): Promise<{ success: boolean; favorite?: FavoriteItem; error?: string }> {
    if (!userId) {
      return { success: false, error: 'User must be authenticated to save favorites.' };
    }

    const newFav: FavoriteItem = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `fav_${Date.now()}`,
      userId,
      roomCode: item.roomCode,
      videoId: item.videoId,
      videoTitle: item.videoTitle || 'Untitled Video',
      thumbnailUrl:
        item.thumbnailUrl ||
        `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`,
      createdAt: new Date().toISOString(),
    };

    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from('user_favorites')
          .insert({
            user_id: userId,
            room_code: newFav.roomCode,
            video_id: newFav.videoId,
            video_title: newFav.videoTitle,
            thumbnail_url: newFav.thumbnailUrl,
          })
          .select()
          .single();

        if (!error && data) {
          newFav.id = data.id;
          newFav.createdAt = data.created_at;
        }
      } catch {
        // Continue to local storage persistence
      }
    }

    // Persist to user-scoped storage & memory
    const existing = await this.getFavorites(userId);
    const updated = [newFav, ...existing.filter((f) => f.videoId !== item.videoId)];
    this.memoryFallback.set(userId, updated);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(updated));
      } catch {
        // Ignore quota
      }
    }

    return { success: true, favorite: newFav };
  }

  async removeFavorite(
    userId: string,
    videoId: string
  ): Promise<{ success: boolean }> {
    if (!userId || !videoId) return { success: false };

    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase
          .from('user_favorites')
          .delete()
          .eq('user_id', userId)
          .eq('video_id', videoId);
      } catch {
        // Continue
      }
    }

    const existing = await this.getFavorites(userId);
    const updated = existing.filter((f) => f.videoId !== videoId);
    this.memoryFallback.set(userId, updated);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(updated));
      } catch {
        // Ignore
      }
    }

    return { success: true };
  }

  async isFavorite(userId: string, videoId: string): Promise<boolean> {
    if (!userId || !videoId) return false;
    const favorites = await this.getFavorites(userId);
    return favorites.some((f) => f.videoId === videoId);
  }
}

export const favoriteService = new FavoriteService();
