import {
  YouTubeApiErrorCode,
  YouTubeSearchResult,
  YouTubeVideoLookupResult,
  YouTubeVideoSummary,
} from '@/core/types/youtube.types';

if (typeof window !== 'undefined') {
  throw new Error('[Syncora] youtubeService must only be imported and executed on the server.');
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_TTL_MS = 5 * 60 * 1000;
const VIDEO_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const searchCache = new Map<string, CacheEntry<YouTubeSearchResult>>();
const videoCache = new Map<string, CacheEntry<YouTubeVideoSummary>>();

interface CachedValue<T> {
  value: T;
  cached: boolean;
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): CachedValue<T> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return { value: entry.value, cached: true };
}

function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number
): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export class YouTubeApiError extends Error {
  code: YouTubeApiErrorCode;
  status: number;

  constructor(code: YouTubeApiErrorCode, message: string, status = 500) {
    super(message);
    this.name = 'YouTubeApiError';
    this.code = code;
    this.status = status;
  }
}

interface YouTubeApiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
}

interface YouTubeVideoItem {
  id?: string;
  snippet?: YouTubeSearchItem['snippet'];
  contentDetails?: { duration?: string };
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
    madeForKids?: boolean;
  };
}

interface YouTubeSearchApiResponse extends YouTubeApiErrorResponse {
  items?: YouTubeSearchItem[];
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
}

interface YouTubeVideosApiResponse extends YouTubeApiErrorResponse {
  items?: YouTubeVideoItem[];
}

function getApiKey(): string {
  return process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '';
}

export function isYouTubeConfigured(): boolean {
  return Boolean(getApiKey());
}

export function normalizeYouTubeSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function parseIso8601Duration(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  );
  if (!match) return 0;

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Math.round(Number(match[4] || 0));
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function isPlayableYouTubeVideo(video: YouTubeVideoSummary): boolean {
  return (
    video.embeddable &&
    video.privacyStatus !== 'private' &&
    video.durationSeconds > 0 &&
    !video.isLive
  );
}

function mapError(
  status: number,
  body: YouTubeApiErrorResponse | null
): YouTubeApiError {
  const reason = body?.error?.errors?.[0]?.reason || '';
  const detail = body?.error?.message || body?.error?.errors?.[0]?.message || '';

  if (
    status === 403 &&
    (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')
  ) {
    return new YouTubeApiError(
      'YOUTUBE_QUOTA_EXCEEDED',
      'YouTube search quota is exhausted for today. You can still paste a YouTube link below.',
      429
    );
  }

  if (
    reason === 'keyInvalid' ||
    reason === 'API_KEY_SERVICE_BLOCKED' ||
    reason === 'accessNotConfigured' ||
    reason === 'forbidden'
  ) {
    return new YouTubeApiError(
      'YOUTUBE_NOT_CONFIGURED',
      'YouTube browsing is not configured on this server. Paste a YouTube link instead.',
      503
    );
  }

  if (status === 429) {
    return new YouTubeApiError(
      'YOUTUBE_RATE_LIMITED',
      'YouTube is rate limiting search requests. Please wait a moment and try again.',
      429
    );
  }

  if (status >= 400 && status < 500) {
    return new YouTubeApiError(
      'YOUTUBE_INVALID_REQUEST',
      detail || 'The YouTube search request was invalid.',
      400
    );
  }

  return new YouTubeApiError(
    'YOUTUBE_UPSTREAM_ERROR',
    detail || 'YouTube is temporarily unavailable. Please try again shortly.',
    502
  );
}

async function youtubeFetch<T extends YouTubeApiErrorResponse>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new YouTubeApiError(
      'YOUTUBE_NOT_CONFIGURED',
      'YouTube browsing is not configured on this server. Paste a YouTube link instead.',
      503
    );
  }

  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  url.searchParams.set('key', apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new YouTubeApiError(
      'YOUTUBE_UPSTREAM_ERROR',
      'Could not reach YouTube. Check your connection and try again.',
      502
    );
  }

  if (!response.ok) {
    let body: YouTubeApiErrorResponse | null = null;
    try {
      body = (await response.json()) as YouTubeApiErrorResponse;
    } catch {
      body = null;
    }
    throw mapError(response.status, body);
  }

  return (await response.json()) as T;
}

function pickThumbnail(
  thumbnails: Record<string, { url?: string } | undefined> | undefined
): string {
  if (!thumbnails) return '';
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ''
  );
}

function mapVideoItem(item: YouTubeVideoItem): YouTubeVideoSummary | null {
  if (!item.id || !item.snippet) return null;
  const snippet = item.snippet;
  const liveContent = snippet.liveBroadcastContent || 'none';

  return {
    videoId: item.id,
    title: snippet.title || 'Untitled video',
    description: snippet.description || '',
    channelId: snippet.channelId || '',
    channelTitle: snippet.channelTitle || 'YouTube creator',
    thumbnailUrl: pickThumbnail(snippet.thumbnails),
    publishedAt: snippet.publishedAt || '',
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration),
    isLive: liveContent === 'live' || liveContent === 'upcoming',
    embeddable: item.status?.embeddable ?? true,
    privacyStatus: item.status?.privacyStatus || 'public',
    madeForKids: item.status?.madeForKids ?? false,
  };
}

async function fetchVideoDetails(videoIds: string[]): Promise<Map<string, YouTubeVideoSummary>> {
  const uniqueIds = Array.from(new Set(videoIds.filter(Boolean))).slice(0, 50);
  const result = new Map<string, YouTubeVideoSummary>();
  const missing: string[] = [];

  uniqueIds.forEach((id) => {
    const cached = readCache(videoCache, id);
    if (cached) {
      result.set(id, cached.value);
    } else {
      missing.push(id);
    }
  });

  if (missing.length === 0) {
    return result;
  }

  const response = await youtubeFetch<YouTubeVideosApiResponse>('videos', {
    part: 'snippet,contentDetails,status',
    id: missing.join(','),
    maxResults: String(missing.length),
  });

  (response.items || []).forEach((item) => {
    const mapped = mapVideoItem(item);
    if (!mapped) return;
    result.set(mapped.videoId, mapped);
    writeCache(videoCache, mapped.videoId, mapped, VIDEO_TTL_MS);
  });

  return result;
}

export async function searchYouTubeVideos(params: {
  query: string;
  pageToken?: string;
  maxResults?: number;
}): Promise<YouTubeSearchResult> {
  const query = normalizeYouTubeSearchQuery(params.query);
  if (!query) {
    throw new YouTubeApiError(
      'YOUTUBE_INVALID_REQUEST',
      'Type something to search YouTube.',
      400
    );
  }

  const maxResults = Math.min(24, Math.max(1, params.maxResults || 12));
  const cacheKey = `${query.toLowerCase()}::${params.pageToken || ''}::${maxResults}`;
  const cached = readCache(searchCache, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const response = await youtubeFetch<YouTubeSearchApiResponse>('search', {
    part: 'snippet',
    type: 'video',
    q: query,
    maxResults: String(maxResults),
    order: 'relevance',
    safeSearch: 'moderate',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    pageToken: params.pageToken || '',
  });

  const ids = (response.items || [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));

  const details = await fetchVideoDetails(ids);
  const items = ids
    .map((id) => details.get(id))
    .filter((video): video is YouTubeVideoSummary => Boolean(video))
    .filter(isPlayableYouTubeVideo);

  const value: YouTubeSearchResult = {
    items,
    nextPageToken: response.nextPageToken,
    totalResults: response.pageInfo?.totalResults,
  };

  writeCache(searchCache, cacheKey, value, SEARCH_TTL_MS);

  return value;
}

export async function lookupYouTubeVideo(videoId: string): Promise<YouTubeVideoSummary> {
  const details = await fetchVideoDetails([videoId]);
  const video = details.get(videoId);

  if (!video) {
    throw new YouTubeApiError(
      'YOUTUBE_NOT_FOUND',
      'That video could not be found. It may have been removed or made private.',
      404
    );
  }

  if (video.privacyStatus === 'private') {
    throw new YouTubeApiError(
      'YOUTUBE_PRIVATE',
      'That video is private and cannot be watched together.',
      422
    );
  }

  if (!video.embeddable) {
    throw new YouTubeApiError(
      'YOUTUBE_EMBED_DISABLED',
      'The video owner does not allow this video to be embedded. Try another video.',
      422
    );
  }

  if (video.isLive) {
    throw new YouTubeApiError(
      'YOUTUBE_INVALID_REQUEST',
      'Live streams are not supported in the shared queue yet. Pick an on-demand video.',
      422
    );
  }

  return video;
}

export async function lookupYouTubeVideos(
  videoIds: string[]
): Promise<YouTubeVideoLookupResult> {
  const uniqueIds = Array.from(new Set(videoIds.filter(Boolean))).slice(0, 20);
  const details = await fetchVideoDetails(uniqueIds);
  const items: YouTubeVideoSummary[] = [];
  const rejected: YouTubeVideoLookupResult['rejected'] = [];

  uniqueIds.forEach((videoId) => {
    const video = details.get(videoId);
    if (!video) {
      rejected.push({
        videoId,
        code: 'YOUTUBE_NOT_FOUND',
        message: 'That video could not be found.',
      });
      return;
    }
    if (video.privacyStatus === 'private') {
      rejected.push({
        videoId,
        code: 'YOUTUBE_PRIVATE',
        message: 'That video is private.',
      });
      return;
    }
    if (!video.embeddable) {
      rejected.push({
        videoId,
        code: 'YOUTUBE_EMBED_DISABLED',
        message: 'The video owner does not allow embedding.',
      });
      return;
    }
    items.push(video);
  });

  return { items, rejected };
}
