/**
 * Shared YouTube Data API domain types.
 * These types are safe to import from both server routes and client components.
 */

export interface YouTubeVideoSummary {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number;
  isLive: boolean;
  embeddable: boolean;
  privacyStatus: string;
  madeForKids: boolean;
}

export type YouTubeApiErrorCode =
  | 'YOUTUBE_NOT_CONFIGURED'
  | 'YOUTUBE_QUOTA_EXCEEDED'
  | 'YOUTUBE_RATE_LIMITED'
  | 'YOUTUBE_INVALID_REQUEST'
  | 'YOUTUBE_UPSTREAM_ERROR'
  | 'YOUTUBE_NOT_FOUND'
  | 'YOUTUBE_PRIVATE'
  | 'YOUTUBE_EMBED_DISABLED';

export interface YouTubeSearchResult {
  items: YouTubeVideoSummary[];
  nextPageToken?: string;
  totalResults?: number;
  cached?: boolean;
}

export interface YouTubeApiErrorBody {
  code: YouTubeApiErrorCode;
  message: string;
}

export interface YouTubeVideoLookupResult {
  items: YouTubeVideoSummary[];
  rejected: Array<{
    videoId: string;
    code: YouTubeApiErrorCode;
    message: string;
  }>;
}
