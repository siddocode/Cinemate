import { createBrowserClient } from '@supabase/ssr';
import { Database } from './database.types';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  if (client) return client;

  if (!isSupabaseConfigured()) {
    // Provide a dummy client or fallback that warns developers in console
    console.warn(
      '[Syncora] Supabase credentials not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.'
    );
  }

  client = createBrowserClient<Database>(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_ANON_KEY || 'placeholder-anon-key'
  );

  return client;
}

