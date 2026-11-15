import { NextRequest, NextResponse } from 'next/server';
import { extractYouTubeId } from '@/lib/utils/youtube';
import {
  describeUnsupportedPlatform,
  isPrivateHostname,
  isTweetLink,
  looksLikeDirectMediaUrl,
  parseHttpUrl,
} from '@/lib/utils/socialVideo';
import { resolveTweetVideo, TweetVideoError } from '@/lib/services/twitterVideoService';
import { checkYouTubeRateLimit } from '@/lib/services/youtubeRateLimit';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;
const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' } as const;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function getRequestKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'anonymous';
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status, headers: NO_STORE_HEADERS });
}

async function fetchFollowingSafeRedirects(
  rawUrl: string,
  method: 'GET' | 'HEAD'
): Promise<Response | null> {
  let current = rawUrl;

  for (let hop = 0; hop <= 3; hop += 1) {
    const parsed = parseHttpUrl(current);
    if (!parsed || isPrivateHostname(parsed.hostname)) return null;

    const headers: Record<string, string> = { 'user-agent': BROWSER_USER_AGENT };
    if (method === 'GET') headers.range = 'bytes=0-1';

    const response = await fetch(parsed.toString(), {
      method,
      redirect: 'manual',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });

    if (method === 'GET') void response.body?.cancel().catch(() => undefined);

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) return response;
      current = new URL(location, parsed).toString();
      continue;
    }

    return response;
  }

  return null;
}

function classifyContentType(contentType: string | null): 'media' | 'html' | null {
  if (!contentType) return null;

  const normalized = contentType.split(';')[0].trim().toLowerCase();
  if (normalized === 'text/html' || normalized === 'application/xhtml+xml') return 'html';
  if (
    normalized.startsWith('video/') ||
    normalized.startsWith('audio/') ||
    normalized === 'application/vnd.apple.mpegurl' ||
    normalized === 'application/x-mpegurl' ||
    normalized === 'application/dash+xml'
  ) {
    return 'media';
  }
  return null;
}

async function probeContentType(url: string): Promise<'media' | 'html' | null> {
  try {
    let response = await fetchFollowingSafeRedirects(url, 'HEAD');

    if (!response || [400, 403, 405, 501].includes(response.status)) {
      response = await fetchFollowingSafeRedirects(url, 'GET');
    }

    if (!response || !response.ok) return null;
    return classifyContentType(response.headers.get('content-type'));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const rate = checkYouTubeRateLimit(`video-resolve:${getRequestKey(request)}`);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'VIDEO_RESOLVE_RATE_LIMITED',
        message: 'Too many link checks. Please wait a moment and try again.',
      },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          'Retry-After': String(rate.retryAfterSeconds),
        },
      }
    );
  }

  const rawUrl = (request.nextUrl.searchParams.get('url') || '').trim();
  const parsed = parseHttpUrl(rawUrl);

  if (!parsed) {
    return jsonError('INVALID_URL', 'Paste a valid link beginning with https://', 400);
  }

  if (isPrivateHostname(parsed.hostname)) {
    return jsonError(
      'PRIVATE_ADDRESS',
      'That link points to a private or local address and cannot be loaded.',
      400
    );
  }

  if (isTweetLink(rawUrl)) {
    try {
      const result = await resolveTweetVideo(rawUrl);
      return NextResponse.json(
        {
          kind: 'tweet',
          url: result.videoUrl,
          thumbnailUrl: result.thumbnailUrl,
          tweetId: result.tweetId,
        },
        { headers: CACHE_HEADERS }
      );
    } catch (error) {
      if (error instanceof TweetVideoError) {
        return jsonError(error.code, error.message, error.status);
      }
      console.warn('[Syncora] Unexpected tweet video resolution error:', error);
      return jsonError(
        'TWEET_UNREACHABLE',
        'Twitter/X could not be reached right now. Please try again in a moment.',
        502
      );
    }
  }

  if (extractYouTubeId(rawUrl)) {
    return jsonError(
      'YOUTUBE_LINK',
      'That is a YouTube link. Load it from the YouTube tab instead.',
      422
    );
  }

  if (looksLikeDirectMediaUrl(rawUrl)) {
    return NextResponse.json(
      { kind: 'direct', url: parsed.toString() },
      { headers: CACHE_HEADERS }
    );
  }

  const unsupportedPlatform = describeUnsupportedPlatform(parsed.hostname);
  if (unsupportedPlatform) {
    return jsonError('UNSUPPORTED_PLATFORM', unsupportedPlatform, 422);
  }

  const contentType = await probeContentType(parsed.toString());

  if (contentType === 'html') {
    return jsonError(
      'NOT_A_VIDEO_FILE',
      'That link opens a web page, not a video file. Paste a direct .mp4/.webm link, or a Twitter/X post link.',
      422
    );
  }

  return NextResponse.json(
    { kind: contentType === 'media' ? 'direct' : 'unverified', url: parsed.toString() },
    { headers: CACHE_HEADERS }
  );
}
