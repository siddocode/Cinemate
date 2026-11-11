/**
 * Supabase client configuration and runtime status checks.
 * Uses the new Supabase publishable key format (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / sb_publishable_...)
 * with backward compatibility for legacy anon keys.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

// Backward compatibility alias
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

export function isSupabaseConfigured(): boolean {
  return (
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_PUBLISHABLE_KEY) &&
    !SUPABASE_URL.includes('your-project-id') &&
    !SUPABASE_PUBLISHABLE_KEY.includes('your-publishable-key') &&
    !SUPABASE_PUBLISHABLE_KEY.includes('your-anon-key')
  );
}

export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}
