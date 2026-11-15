import {
  extractTweetId,
  isPrivateHostname,
  isTcoLink,
  parseHttpUrl,
} from '@/lib/utils/socialVideo';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type TweetVideoErrorCode =
  | 'TWEET_INVALID_LINK'
  | 'TWEET_NOT_FOUND'
  | 'TWEET_NO_VIDEO'
  | 'TWEET_UNREACHABLE';

export class TweetVideoError extends Error {
  readonly code: TweetVideoErrorCode;
  readonly status: number;

  constructor(code: TweetVideoErrorCode, message: string, status = 422) {
    super(message);
    this.name = 'TweetVideoError';
    this.code = code;
    this.status = status;
  }
}

export interface TweetVideoResult {
  tweetId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  source: 'syndication' | 'page';
}

interface VideoVariant {
  bitrate?: number;
  contentType?: string;
  url?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildSyndicationToken(tweetId: string): string {
  const numeric = Number(tweetId);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return ((numeric / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export function pickBestMp4Variant(variants: VideoVariant[]): string | null {
  const mp4s = variants.filter((variant) => {
    if (!variant.url) return false;
    if (variant.contentType) return /video\/mp4/i.test(variant.contentType);
    return /\.mp4(?:[?#]|$)/i.test(variant.url);
  });

  if (mp4s.length === 0) return null;

  const sorted = [...mp4s].sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  return sorted[sorted.length - 1].url ?? null;
}

export function extractVideoFromTweetPageHtml(
  html: string
): { videoUrl: string; thumbnailUrl: string | null } | null {
  if (!html) return null;

  const normalized = html
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');

  const variants: VideoVariant[] = [];
  const variantRe =
    /"bitrate"\s*:\s*(\d+)[^{}]{0,400}?"url"\s*:\s*"(https:\/\/video\.twimg\.com\/[^"]+?\.mp4[^"]*)"/gi;

  for (const match of normalized.matchAll(variantRe)) {
    variants.push({
      bitrate: Number(match[1]),
      contentType: 'video/mp4',
      url: match[2],
    });
  }

  if (variants.length === 0) {
    const genericRe =
      /https:\/\/video\.twimg\.com\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?/gi;
    for (const match of normalized.matchAll(genericRe)) {
      variants.push({ url: match[0] });
    }
  }

  const videoUrl = pickBestMp4Variant(variants);
  if (!videoUrl) return null;

  return { videoUrl, thumbnailUrl: extractTweetThumbnail(normalized) };
}

function extractTweetThumbnail(html: string): string | null {
  const ogImage = html.match(
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogImage?.[1]) return ogImage[1].replace(/&amp;/g, '&');

  const thumb = html.match(
    /https:\/\/pbs\.twimg\.com\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|media)\/[^\s"'<>\\]+/i
  );
  return thumb ? thumb[0] : null;
}

export function extractVideoFromSyndication(
  payload: unknown
): { videoUrl: string; thumbnailUrl: string | null } | null {
  const root = asRecord(payload);
  if (!root) return null;

  const candidates: Record<string, unknown>[] = [];
  const mediaDetails = root.mediaDetails;
  if (Array.isArray(mediaDetails)) {
    for (const detail of mediaDetails) {
      const record = asRecord(detail);
      if (record) candidates.push(record);
    }
  }

  const video = asRecord(root.video);
  if (video) candidates.push(video);

  for (const candidate of candidates) {
    const info = asRecord(candidate.video_info) ?? candidate;
    const rawVariants = Array.isArray(info.variants) ? info.variants : [];
    const variants: VideoVariant[] = [];

    for (const rawVariant of rawVariants) {
      const variant = asRecord(rawVariant);
      if (!variant) continue;
      variants.push({
        bitrate: asNumber(variant.bitrate),
        contentType:
          asString(variant.content_type) ?? asString(variant.contentType) ?? asString(variant.type) ?? undefined,
        url: asString(variant.url) ?? asString(variant.src) ?? undefined,
      });
    }

    const videoUrl = pickBestMp4Variant(variants);
    if (videoUrl) {
      const thumbnailUrl =
        asString(candidate.poster) ??
        asString(candidate.poster_url) ??
        asString(candidate.thumbnail_url);
      return { videoUrl, thumbnailUrl };
    }
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTcoTarget(input: string): Promise<string | null> {
  let current = input.trim();

  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    if (!isTcoLink(current)) return current;

    const url = parseHttpUrl(current);
    if (!url || isPrivateHostname(url.hostname)) return null;

    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': BROWSER_USER_AGENT },
      },
      5_000
    );
    void response.body?.cancel().catch(() => undefined);

    const location = response.headers.get('location');
    if (!location) return null;
    current = new URL(location, url).toString();
  }

  return null;
}

export async function resolveTweetVideo(input: string): Promise<TweetVideoResult> {
  const trimmed = input.trim();
  let tweetId = extractTweetId(trimmed);

  if (!tweetId && isTcoLink(trimmed)) {
    const target = await resolveTcoTarget(trimmed).catch(() => null);
    tweetId = target ? extractTweetId(target) : null;
  }

  if (!tweetId) {
    throw new TweetVideoError(
      'TWEET_INVALID_LINK',
      'That link is not a Twitter/X post. Paste a link to a specific post (/status/) or a direct video file link.'
    );
  }

  const token = buildSyndicationToken(tweetId);
  if (token) {
    try {
      const response = await fetchWithTimeout(
        `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}&lang=en`,
        {
          headers: {
            'user-agent': BROWSER_USER_AGENT,
            accept: 'application/json',
          },
        },
        6_000
      );

      if (response.ok) {
        const payload: unknown = await response.json();
        const found = extractVideoFromSyndication(payload);
        if (found) {
          return { tweetId, ...found, source: 'syndication' };
        }
      }
    } catch {
      // Fall through to scraping the public page.
    }
  }

  const pageCandidates = [
    `https://x.com/i/status/${tweetId}`,
    `https://twitter.com/i/status/${tweetId}`,
  ];
  let sawNotFound = false;

  for (const pageUrl of pageCandidates) {
    try {
      const response = await fetchWithTimeout(pageUrl, {
        headers: {
          'user-agent': BROWSER_USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      if (response.status === 404 || response.status === 410) {
        sawNotFound = true;
        continue;
      }
      if (!response.ok) continue;

      const html = await response.text();
      const found = extractVideoFromTweetPageHtml(html);
      if (found) {
        return { tweetId, ...found, source: 'page' };
      }
    } catch {
      continue;
    }
  }

  if (sawNotFound) {
    throw new TweetVideoError(
      'TWEET_NOT_FOUND',
      'That post could not be found. It may have been deleted or made private.'
    );
  }

  throw new TweetVideoError(
    'TWEET_NO_VIDEO',
    'No playable video was found in that post. It may be text-only, image-only, age-restricted, or private.'
  );
}
