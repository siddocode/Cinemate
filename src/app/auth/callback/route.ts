import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabase/config';
import { Database } from '@/lib/supabase/database.types';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    let response = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient<Database>(
      SUPABASE_URL || 'https://placeholder.supabase.co',
      SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key',
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            response = NextResponse.redirect(`${origin}${next}`);
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return response;
    }
  }

  // Return to login with error parameter if code exchange fails or is missing
  return NextResponse.redirect(
    `${origin}/login?error=Invalid+or+expired+verification+link`
  );
}
