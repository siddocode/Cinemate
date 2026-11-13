import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeYouTubeSearchQuery,
  searchYouTubeVideos,
  YouTubeApiError,
} from '@/lib/services/youtubeService';
import { checkYouTubeRateLimit } from '@/lib/services/youtubeRateLimit';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, max-age=60',
} as const;

function getRequestKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'anonymous';
}

export async function GET(request: NextRequest) {
  const rate = checkYouTubeRateLimit(`search:${getRequestKey(request)}`);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'YOUTUBE_RATE_LIMITED',
        message: 'Too many YouTube searches. Please wait a moment and try again.',
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

  const query = normalizeYouTubeSearchQuery(request.nextUrl.searchParams.get('q'));
  const pageToken = request.nextUrl.searchParams.get('pageToken') || undefined;
  const maxResultsRaw = Number(request.nextUrl.searchParams.get('maxResults') || 12);

  try {
    const result = await searchYouTubeVideos({
      query,
      pageToken,
      maxResults: Number.isFinite(maxResultsRaw) ? maxResultsRaw : 12,
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof YouTubeApiError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status, headers: NO_STORE_HEADERS }
      );
    }

    console.warn('[Syncora] Unexpected YouTube search error:', error);
    return NextResponse.json(
      {
        error: 'YOUTUBE_UPSTREAM_ERROR',
        message: 'YouTube search is temporarily unavailable. Please try again shortly.',
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
