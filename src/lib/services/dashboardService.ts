import { roomService } from './roomService';
import { favoriteService, FavoriteItem } from './favoriteService';
import { UserRoomSummary } from '@/core/types/room.types';

export interface DashboardData {
  recentRooms: UserRoomSummary[];
  favorites: FavoriteItem[];
}

/**
 * Fetches independent dashboard data shelves concurrently using Promise.all
 * so Recent Rooms and Saved Favorites load in parallel without serial waterfalls.
 */
export async function fetchDashboardData(userId: string): Promise<DashboardData> {
  if (!userId) {
    return { recentRooms: [], favorites: [] };
  }

  const [recentRooms, favorites] = await Promise.all([
    roomService.getUserRooms(userId),
    favoriteService.getFavorites(userId),
  ]);

  return {
    recentRooms: recentRooms.filter((room) => room.hostId === userId),
    favorites,
  };
}

