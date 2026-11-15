const TWEET_HOSTS = new Set([
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'm.twitter.com',
  'x.com',
  'www.x.com',
  'mobile.x.com',
]);

const TCO_HOSTS = new Set(['t.co', 'www.t.co']);

// Direct media paths the browser can hand to a <video> element without sniffing.
const DIRECT_MEDIA_PATH_RE = /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)(?:[?#]|$)/i;

// Platforms whose links are app/web pages, never a playable media file.
const PAGE_ONLY_HOSTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\.)instagram\.com$/, label: 'Instagram' },
  { pattern: /(^|\.)tiktok\.com$/, label: 'TikTok' },
  { pattern: /(^|\.)(facebook\.com|fb\.watch)$/, label: 'Facebook' },
  { pattern: /(^|\.)vimeo\.com$/, label: 'Vimeo' },
  { pattern: /(^|\.)twitch\.tv$/, label: 'Twitch' },
  { pattern: /(^|\.)(dailymotion\.com|dai\.ly)$/, label: 'Dailymotion' },
  { pattern: /(^|\.)(reddit\.com|redd\.it)$/, label: 'Reddit' },
  { pattern: /(^|\.)pinterest\.[a-z.]+$/, label: 'Pinterest' },
  { pattern: /(^|\.)(threads\.net|linkedin\.com|snapchat\.com)$/, label: 'That platform' },
  { pattern: /(^|\.)(spotify\.com|soundcloud\.com)$/, label: 'That audio platform' },
  {
    pattern: /(^|\.)(netflix\.com|primevideo\.com|disneyplus\.com|hulu\.com|max\.com)$/,
    label: 'That streaming service',
  },
  {
    pattern: /(^|\.)(rumble\.com|bitchute\.com|odysee\.com|kick\.com)$/,
    label: 'That video platform',
  },
];

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function parseHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

export function extractTweetId(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  if (!TWEET_HOSTS.has(normalizeHostname(url.hostname))) return null;

  const match = url.pathname.match(/\/status(?:es)?\/(\d{1,25})(?:\/|$)/i);
  return match ? match[1] : null;
}

export function isTweetLink(input: string): boolean {
  const url = parseHttpUrl(input);
  if (!url) return false;
  const host = normalizeHostname(url.hostname);
  return TWEET_HOSTS.has(host) || TCO_HOSTS.has(host);
}

export function isTcoLink(input: string): boolean {
  const url = parseHttpUrl(input);
  if (!url) return false;
  return TCO_HOSTS.has(normalizeHostname(url.hostname));
}

export function looksLikeDirectMediaUrl(input: string): boolean {
  const url = parseHttpUrl(input);
  if (!url) return false;
  return DIRECT_MEDIA_PATH_RE.test(url.pathname);
}

/**
 * Returns a friendly message when a host only serves web pages for videos
 * (Instagram, TikTok, Facebook, ...), or null for anything else.
 */
export function describeUnsupportedPlatform(hostname: string): string | null {
  const host = normalizeHostname(hostname);

  for (const { pattern, label } of PAGE_ONLY_HOSTS) {
    if (pattern.test(host)) {
      return `${label} links point to a web page, not a video file, so they cannot be played in the room. Paste a direct .mp4/.webm link, or use YouTube or a Twitter/X post.`;
    }
  }

  return null;
}

/**
 * Blocks loopback, link-local, and RFC1918 addresses so the resolver never
 * becomes an SSRF proxy for internal services.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname).replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }

  if (host === '0.0.0.0' || host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  // Any remaining colon means an IPv6 literal. Block conservatively.
  return host.includes(':');
}
