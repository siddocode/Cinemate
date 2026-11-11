import { CALL_CONSTANTS } from '@/lib/constants/sync.constants';

if (typeof window !== 'undefined') {
  throw new Error('[Syncora] turnService must only be imported and executed on the server.');
}

export interface SanitizedIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface CallIceServersResult {
  iceServers: SanitizedIceServer[];
  mode: 'turn' | 'stun-only';
  ttlSeconds: number;
  isProductionReady: boolean;
  issuedAt: string;
  warning?: string;
}

export interface TurnServiceDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const DEFAULT_STUN_URLS = [
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
];

const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

function parseStunUrls(raw?: string): string[] {
  if (!raw || !raw.trim()) {
    return DEFAULT_STUN_URLS;
  }

  const parsed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('stun:') && !entry.includes(':53'));

  return parsed.length > 0 ? parsed : DEFAULT_STUN_URLS;
}

function resolveTurnTtlSeconds(raw?: string): number {
  if (!raw) return CALL_CONSTANTS.DEFAULT_TURN_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return CALL_CONSTANTS.DEFAULT_TURN_TTL_SECONDS;
  return Math.max(300, Math.min(parsed, 86_400));
}

function sanitizeIceServerList(rawList: unknown): SanitizedIceServer[] {
  if (!Array.isArray(rawList)) return [];

  const sanitized: SanitizedIceServer[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as {
      urls?: unknown;
      username?: unknown;
      credential?: unknown;
    };

    const rawUrls = Array.isArray(candidate.urls)
      ? candidate.urls
      : typeof candidate.urls === 'string'
      ? [candidate.urls]
      : [];

    const validUrls = rawUrls
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter(
        (u) =>
          (u.startsWith('stun:') || u.startsWith('turn:') || u.startsWith('turns:')) &&
          !/:53(?:\?|$)/.test(u)
      );

    if (validUrls.length === 0) continue;

    const entry: SanitizedIceServer = { urls: validUrls };
    if (typeof candidate.username === 'string' && candidate.username.length > 0) {
      entry.username = candidate.username;
    }
    if (typeof candidate.credential === 'string' && candidate.credential.length > 0) {
      entry.credential = candidate.credential;
    }

    sanitized.push(entry);
  }

  return sanitized;
}

/**
 * Generates short-lived WebRTC ICE servers for an authorized caller.
 * - Development fallback: when Cloudflare credentials are omitted (or TURN_PROVIDER=stun-only),
 *   returns STUN-only servers with `isProductionReady: false`.
 * - Production mode: generates scoped, short-lived Cloudflare TURN credentials server-side.
 */
export async function generateCallIceServers(
  deps: TurnServiceDeps = {}
): Promise<CallIceServersResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const providerOverride = (env.TURN_PROVIDER || '').trim().toLowerCase();
  const keyId = (env.CLOUDFLARE_TURN_KEY_ID || '').trim();
  const apiToken = (env.CLOUDFLARE_TURN_API_TOKEN || '').trim();
  const stunUrls = parseStunUrls(env.STUN_URLS);
  const issuedAt = new Date().toISOString();

  const shouldUseStunOnly =
    providerOverride === 'stun-only' || !keyId || !apiToken;

  if (shouldUseStunOnly) {
    return {
      iceServers: [{ urls: stunUrls }],
      mode: 'stun-only',
      ttlSeconds: 0,
      isProductionReady: false,
      issuedAt,
      warning:
        'STUN-only development mode active. Configure CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN for production NAT/mobile relay.',
    };
  }

  if (providerOverride && providerOverride !== 'cloudflare') {
    throw new Error(`Unsupported TURN_PROVIDER "${providerOverride}". Expected "cloudflare" or "stun-only".`);
  }

  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error('Invalid CLOUDFLARE_TURN_KEY_ID format.');
  }

  const ttlSeconds = resolveTurnTtlSeconds(env.TURN_CREDENTIAL_TTL_SECONDS);
  const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(
    keyId
  )}/credentials/generate-ice-servers`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: ttlSeconds }),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Cloudflare TURN credential request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { iceServers?: unknown };
  const iceServers = sanitizeIceServerList(payload?.iceServers);

  const hasTurnServer = iceServers.some((srv) =>
    srv.urls.some((u) => u.startsWith('turn:') || u.startsWith('turns:'))
  );

  if (!hasTurnServer) {
    throw new Error('Cloudflare TURN response did not include any valid TURN/TURNS servers.');
  }

  return {
    iceServers,
    mode: 'turn',
    ttlSeconds,
    isProductionReady: true,
    issuedAt,
  };
}

