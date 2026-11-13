import { NextRequest, NextResponse } from 'next/server';
import { extractYouTubeId } from '@/lib/utils/youtube';
import {
  lookupYouTubeVideo,
  lookupYouTubeVideos,
  YouTubeApiError,
} from '@/lib/services/youtubeService';
import { checkYouTubeRateLimit } from '@/lib/services/youtubeRateLimit';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, max-age=300',
} as const;

function getRequestKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'anonymous';
}

export async function GET(request: NextRequest) {
  const rate = checkYouTubeRateLimit(`videos:${getRequestKey(request)}`);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'YOUTUBE_RATE_LIMITED',
        message: 'Too many YouTube lookups. Please wait a moment and try again.',
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

  const rawInput =
    request.nextUrl.searchParams.get('url') ||
    request.nextUrl.searchParams.get('id') ||
    '';
  const rawIds = request.nextUrl.searchParams.get('ids') || '';

  try {
    if (rawIds) {
      const ids = rawIds
        .split(',')
        .map((id) => extractYouTubeId(id.trim()))
        .filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        return NextResponse.json(
          {
            error: 'YOUTUBE_INVALID_REQUEST',
            message: 'No valid YouTube video IDs were provided.',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      const result = await lookupYouTubeVideos(ids);
      return NextResponse.json(result, { headers: NO_STORE_HEADERS });
    }

    const videoId = extractYouTubeId(rawInput);
    if (!videoId) {
      return NextResponse.json(
        {
          error: 'YOUTUBE_INVALID_REQUEST',
          message: 'Paste a valid YouTube watch, shorts, live, or youtu.be link.',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const video = await lookupYouTubeVideo(videoId);
    return NextResponse.json({ item: video, items: [video] }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof YouTubeApiError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status, headers: NO_STORE_HEADERS }
      );
    }

    console.warn('[Syncora] Unexpected YouTube lookup error:', error);
    return NextResponse.json(
      {
        error: 'YOUTUBE_UPSTREAM_ERROR',
        message: 'YouTube lookup is temporarily unavailable. Please try again shortly.',
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
