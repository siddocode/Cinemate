'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Play, Trash2, Film, Loader2 } from 'lucide-react';
import { favoriteService, FavoriteItem } from '@/lib/services/favoriteService';
import { useSession } from '@/hooks/useSession';
import { generateRoomCode } from '@/lib/utils/code';
import { Button } from '@/components/ui/Button';

interface FavoritesSectionProps {
  isExternalNavigating?: boolean;
  onStartNavigation?: () => void;
}

export const FavoritesSection: React.FC<FavoritesSectionProps> = ({
  isExternalNavigating = false,
  onStartNavigation,
}) => {
  const router = useRouter();
  const { user, isAuthenticated } = useSession();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingVideoId, setRemovingVideoId] = useState<string | null>(null);
  const [launchingVideoId, setLaunchingVideoId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user.id) {
      return;
    }

    let isMounted = true;

    favoriteService
      .getFavorites(user.id)
      .then((items) => {
        if (isMounted) {
          setFavorites(items);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setFavorites([]);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [user.id, isAuthenticated]);

  const displayedFavorites = isAuthenticated ? favorites : [];

  const isNavigating = isExternalNavigating || launchingVideoId !== null;

  const handleLaunchFavorite = (videoId: string) => {
    if (isNavigating || removingVideoId === videoId) return;
    setLaunchingVideoId(videoId);
    onStartNavigation?.();
    const code = generateRoomCode();
    router.push(`/room/${code}?v=${encodeURIComponent(videoId)}`);
  };

  const handleRemoveFavorite = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isNavigating || removingVideoId !== null) return;
    setRemovingVideoId(videoId);
    try {
      await favoriteService.removeFavorite(user.id, videoId);
      setFavorites((prev) => prev.filter((f) => f.videoId !== videoId));
    } finally {
      setRemovingVideoId((prev) => (prev === videoId ? null : prev));
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <section className="w-full max-w-5xl border-t border-[#E8DDC5]/12 pt-9 mt-12 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
        <div className="flex items-center gap-2.5">
          <Star className="w-4 h-4 text-[#E8DDC5] fill-[#E8DDC5]" />
          <h2 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-[#F7F4EC]">
            Saved Screenings
          </h2>
        </div>
        {!isLoading && (
          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#CDBF9F]">
            {displayedFavorites.length} {displayedFavorites.length === 1 ? 'title' : 'titles'}
          </span>
        )}
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="bg-[#173D30]/80 border border-[#E8DDC5]/12 rounded-2xl p-3.5 space-y-3 animate-pulse"
            >
              <div className="aspect-video rounded-xl bg-[#0E281F]" />
              <div className="h-4 w-3/4 rounded bg-[#0E281F]" />
              <div className="h-9 w-full rounded-xl bg-[#0E281F]" />
            </div>
          ))}
        </div>
      )}

      {/* Subtle Empty State */}
      {!isLoading && displayedFavorites.length === 0 && (
        <div className="border border-dashed border-[#E8DDC5]/18 bg-[#173D30]/40 rounded-2xl px-5 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0E281F] border border-[#9670FF]/40 flex items-center justify-center text-[#B397FF] shrink-0">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#F7F4EC]">
                Your screening shelf is empty
              </p>
              <p className="text-xs text-[#CDBF9F]/80 mt-0.5">
                Star any video inside a watch room to relaunch it here in one click.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-[#CDBF9F]/60">
            Ready when you are
          </span>
        </div>
      )}

      {/* Populated Favorites Grid */}
      {!isLoading && displayedFavorites.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedFavorites.map((fav) => (
            <article
              key={fav.id}
              className="bg-[#173D30]/75 border border-[#E8DDC5]/16 hover:border-[#E8DDC5]/35 rounded-2xl p-3.5 transition-colors duration-150 group flex flex-col justify-between"
            >
              <div>
                <div className="relative aspect-video rounded-xl overflow-hidden bg-[#091B15] border border-[#E8DDC5]/10 mb-3">
                  {fav.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fav.thumbnailUrl}
                      alt={fav.videoTitle}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#CDBF9F]/40">
                      <Play className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#091B15]/80 to-transparent pointer-events-none" />
                  <button
                    type="button"
                    onClick={(e) => handleRemoveFavorite(fav.videoId, e)}
                    disabled={isNavigating || removingVideoId !== null}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-[#0E281F]/90 hover:bg-[#3A1E1C] border border-[#E8DDC5]/15 text-[#CDBF9F] hover:text-[#F2B8B2] transition-colors cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
                    title="Remove from favorites"
                    aria-label={`Remove ${fav.videoTitle} from favorites`}
                  >
                    {removingVideoId === fav.videoId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <h3 className="text-sm font-medium text-[#F7F4EC] line-clamp-2 leading-snug">
                  {fav.videoTitle}
                </h3>
                {fav.roomCode && (
                  <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#CDBF9F]/70 mt-1">
                    Room {fav.roomCode}
                  </p>
                )}
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={() => handleLaunchFavorite(fav.videoId)}
                isLoading={launchingVideoId === fav.videoId}
                disabled={isNavigating || removingVideoId === fav.videoId}
                className="w-full text-xs mt-3.5 justify-center"
                leftIcon={<Play className="w-3 h-3 fill-current" />}
              >
                {launchingVideoId === fav.videoId ? 'Starting Room…' : 'Watch Together'}
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
