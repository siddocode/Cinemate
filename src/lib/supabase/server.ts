import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { Database } from './database.types';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from './config';
import {
  getCachedJwks,
  getVerifiedAuthClaims,
  hasSupabaseAuthCookie,
  mapClaimsToUserIdentity,
} from './auth';
import type { UserIdentity } from '@/core/types/session.types';

if (typeof window !== 'undefined') {
  throw new Error('[Syncora] server.ts must only be imported and executed on the server.');
}

// Server-only secret key (sb_secret_...) - NEVER exposed to browser bundles
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Creates a server client with the user's cookie context.
 * Used for SSR and standard serenver component queries respecting RLS.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignored when called from Server Components
          }
        },
      },
    }
  );
}

/**
 * Creates a privileged admin client using the secret key (SUPABASE_SECRET_KEY).
 * STRICTLY for server-only administrative tasks (storage policy administration, etc.).
 * NEVER exposed to client bundles.
 */
export function getSupabaseAdminClient() {
  if (!SUPABASE_SECRET_KEY) {
    throw new Error(
      '[Syncora] SUPABASE_SECRET_KEY is not defined. Ensure SUPABASE_SECRET_KEY is set in your server environment.'
    );
  }

  return createClient<Database>(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_SECRET_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export interface ServerInitialSession {
  initialUser: UserIdentity | null;
  isServerInitialized: boolean;
}

/**
 * Resolves initial user identity on the server from verified JWT claims (cached JWKS)
 * so SSR and SessionProvider initialize immediately without a client auth waterfall
 * or `/auth/v1/user` round-trip.
 */
export async function getServerInitialSession(): Promise<ServerInitialSession> {
  try {
    const cookieStore = await cookies();
    const requestCookies = cookieStore.getAll();

    if (!hasSupabaseAuthCookie(requestCookies)) {
      return { initialUser: null, isServerInitialized: true };
    }

    if (!isSupabaseConfigured()) {
      return { initialUser: null, isServerInitialized: false };
    }

    const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll() {
          return requestCookies;
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignored when called from Server Components
          }
        },
      },
    });

    const jwks = await getCachedJwks(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const verified = await getVerifiedAuthClaims(supabase, {
      jwks,
      supabaseUrl: SUPABASE_URL,
    });
    const initialUser = mapClaimsToUserIdentity(verified?.claims);

    return {
      initialUser,
      isServerInitialized: Boolean(initialUser),
    };
  } catch {
    return { initialUser: null, isServerInitialized: false };
  }
}
