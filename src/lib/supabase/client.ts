import { createBrowserClient } from '@supabase/ssr';
import { Database } from './database.types';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from './config';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  if (client) return client;

  if (!isSupabaseConfigured()) {
    console.warn(
      '[Syncora] Supabase credentials not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.'
    );
  }

  client = createBrowserClient<Database>(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key'
  );

  return client;
}

/**
 * Resolves a verified user JWT access token for private Realtime channel subscriptions,
 * refreshing the session if the in-memory token is absent.
 */
export async function getAuthenticatedAccessToken(
  supabaseClient: ReturnType<typeof getSupabaseBrowserClient> = getSupabaseBrowserClient()
): Promise<string | undefined> {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (session?.access_token) {
    return session.access_token;
  }

  const { data: refreshed } = await supabaseClient.auth.refreshSession();
  return refreshed.session?.access_token ?? undefined;
}
