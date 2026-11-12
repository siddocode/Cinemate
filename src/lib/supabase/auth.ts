import type { JWK, JwtHeader, JwtPayload, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { UserIdentity } from '@/core/types/session.types';

/** Match GoTrueClient's 10-minute JWKS TTL across ephemeral server/middleware client instances. */
export const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_JWKS_CACHE_ENTRIES = 8;

export interface JwksResponse {
  keys: JWK[];
}

interface JwksCacheEntry {
  jwks: JwksResponse;
  expiresAt: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();
const inFlightJwksFetches = new Map<string, Promise<JwksResponse | undefined>>();

function normalizeSupabaseUrl(supabaseUrl: string): string {
  return supabaseUrl.trim().replace(/\/+$/, '');
}

/**
 * Checks whether the incoming cookie set contains a Supabase Auth session cookie
 * (including chunked `@supabase/ssr` cookies like `sb-<ref>-auth-token.0`),
 * excluding PKCE code verifiers.
 */
export function hasSupabaseAuthCookie(
  cookies: ReadonlyArray<{ name: string; value?: string }>
): boolean {
  return cookies.some(
    (cookie) =>
      cookie.name.startsWith('sb-') &&
      cookie.name.includes('-auth-token') &&
      !cookie.name.includes('code-verifier') &&
      Boolean(cookie.value)
  );
}

/**
 * Verifies that decoded/verified JWT claims belong to a non-anonymous authenticated user.
 */
export function isAuthenticatedClaims(
  claims: JwtPayload | null | undefined
): claims is JwtPayload & { sub: string } {
  if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return false;
  }

  if (claims.is_anonymous === true) {
    return false;
  }

  if (claims.role && claims.role !== 'authenticated') {
    return false;
  }

  return true;
}

/**
 * Maps verified Supabase JWT claims directly to Syncora's UserIdentity
 * without issuing an extra network request to `/auth/v1/user`.
 */
export function mapClaimsToUserIdentity(
  claims: JwtPayload | null | undefined
): UserIdentity | null {
  if (!isAuthenticatedClaims(claims)) {
    return null;
  }

  const email =
    typeof claims.email === 'string' && claims.email.length > 0
      ? claims.email
      : undefined;
  const rawMetaUsername = claims.user_metadata?.username;
  const metaUsername =
    typeof rawMetaUsername === 'string' ? rawMetaUsername.trim() : '';
  const username =
    metaUsername ||
    (email && email.includes('@') ? email.split('@')[0] : '') ||
    'User';

  return {
    id: claims.sub,
    username,
    email,
    isGuest: false,
  };
}

/**
 * Clears the cached JWKS set (all entries or for a specific Supabase URL).
 */
export function invalidateCachedJwks(supabaseUrl?: string): void {
  if (!supabaseUrl) {
    jwksCache.clear();
    return;
  }
  jwksCache.delete(normalizeSupabaseUrl(supabaseUrl));
}

/**
 * Fetches and caches the project's public JWKS (`/.well-known/jwks.json`) at module scope
 * so per-request `createServerClient()` instances verify asymmetric JWTs locally with
 * WebCrypto without repeating JWKS or `/auth/v1/user` HTTP requests.
 */
export async function getCachedJwks(
  supabaseUrl: string,
  publishableKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<JwksResponse | undefined> {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl);
  if (!baseUrl || !publishableKey || baseUrl.includes('placeholder')) {
    return undefined;
  }

  const now = Date.now();
  const cached = jwksCache.get(baseUrl);
  if (cached && cached.expiresAt > now) {
    return cached.jwks;
  }

  const existingInFlight = inFlightJwksFetches.get(baseUrl);
  if (existingInFlight) {
    return existingInFlight;
  }

  const fetchPromise = (async (): Promise<JwksResponse | undefined> => {
    try {
      const response = await fetchImpl(`${baseUrl}/auth/v1/.well-known/jwks.json`, {
        method: 'GET',
        headers: {
          apikey: publishableKey,
          Accept: 'application/json',
        },
        ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? { signal: AbortSignal.timeout(4000) }
          : {}),
      });

      if (!response.ok) {
        return undefined;
      }

      const payload = (await response.json()) as { keys?: unknown } | null;
      if (!payload || !Array.isArray(payload.keys)) {
        return undefined;
      }

      const jwks: JwksResponse = { keys: payload.keys as JWK[] };

      if (jwksCache.size >= MAX_JWKS_CACHE_ENTRIES && !jwksCache.has(baseUrl)) {
        const oldestKey = jwksCache.keys().next().value;
        if (oldestKey) {
          jwksCache.delete(oldestKey);
        }
      }

      jwksCache.set(baseUrl, {
        jwks,
        expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
      });

      return jwks;
    } catch {
      return undefined;
    } finally {
      inFlightJwksFetches.delete(baseUrl);
    }
  })();

  inFlightJwksFetches.set(baseUrl, fetchPromise);
  return fetchPromise;
}

/**
 * Cryptographically verifies the current request's JWT claims via `supabase.auth.getClaims()`
 * (using cached JWKS for asymmetric tokens, automatic session refresh when needed, and safe
 * fallback to Auth server verification on symmetric `HS*` projects).
 */
export async function getVerifiedAuthClaims(
  supabase: Pick<SupabaseClient<Database>, 'auth'>,
  options?: {
    jwks?: JwksResponse;
    supabaseUrl?: string;
  }
): Promise<{ claims: JwtPayload; header: JwtHeader } | null> {
  const { data, error } = await supabase.auth.getClaims(
    undefined,
    options?.jwks ? { jwks: options.jwks } : undefined
  );

  if (error || !data?.claims) {
    return null;
  }

  // If key rotation introduced a new `kid` not yet in our cached JWKS, drop cache so next hit refreshes it.
  if (
    options?.supabaseUrl &&
    options.jwks &&
    options.jwks.keys.length > 0 &&
    data.header?.kid &&
    !options.jwks.keys.some((key) => key.kid === data.header.kid)
  ) {
    invalidateCachedJwks(options.supabaseUrl);
  }

  return {
    claims: data.claims,
    header: data.header,
  };
}

