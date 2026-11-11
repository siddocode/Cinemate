import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { Database } from './database.types';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';

if (typeof window !== 'undefined') {
  throw new Error('[Syncora] server.ts must only be imported and executed on the server.');
}

// Server-only secret key (sb_secret_...) - NEVER exposed to browser bundles
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Creates a server client with the user's cookie context.
 * Used for SSR and standard server component queries respecting RLS.
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
