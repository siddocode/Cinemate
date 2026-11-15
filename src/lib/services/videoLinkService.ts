export type ResolvedVideoKind = 'direct' | 'tweet' | 'unverified';

export interface ResolvedVideoLink {
  url: string;
  kind: ResolvedVideoKind;
  thumbnailUrl: string | null;
  tweetId: string | null;
}

export class VideoLinkError extends Error {
  readonly code: string;

  constructor(message: string, code = 'VIDEO_LINK_RESOLVE_FAILED') {
    super(message);
    this.name = 'VideoLinkError';
    this.code = code;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asKind(value: unknown): ResolvedVideoKind {
  return value === 'direct' || value === 'tweet' || value === 'unverified'
    ? value
    : 'unverified';
}

export async function resolvePlayableVideoUrl(rawUrl: string): Promise<ResolvedVideoLink> {
  let response: Response;

  try {
    response = await fetch(`/api/video/resolve?url=${encodeURIComponent(rawUrl)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new VideoLinkError(
      'Could not reach the link checker. Check your connection and try again.',
      'NETWORK_ERROR'
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON error responses fall back to the generic message below.
  }

  const url = asString(payload.url);

  if (!response.ok || !url) {
    throw new VideoLinkError(
      asString(payload.message) ||
        'That link could not be loaded. Paste a direct video file link or use YouTube.',
      asString(payload.error) || 'VIDEO_LINK_RESOLVE_FAILED'
    );
  }

  return {
    url,
    kind: asKind(payload.kind),
    thumbnailUrl: asString(payload.thumbnailUrl),
    tweetId: asString(payload.tweetId),
  };
}
