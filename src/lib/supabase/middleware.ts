import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { Database } from './database.types';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;

  // Skip Next.js internal static assets and favicon
  if (
    pathname.startsWith('/_next') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return supabaseResponse;
  }

  // Allow cron or internal webhook api routes to pass without browser auth redirection
  if (pathname.startsWith('/api/cron')) {
    return supabaseResponse;
  }

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
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Authenticate user via Supabase Auth server (validates & refreshes session cookie)
  let user = null;
  if (
    SUPABASE_URL &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_URL.includes('placeholder')
  ) {
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      user = null;
    }
  }

  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/auth');

  const isCallbackRoute = pathname === '/auth/callback';
  const isApiRoute = pathname.startsWith('/api/');
  const isAuthenticated = Boolean(user && !user.is_anonymous);

  // 1a. Unauthenticated API calls receive JSON 401 rather than an HTML login redirect
  if (!isAuthenticated && isApiRoute) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  // 1b. Unauthenticated users trying to access protected pages -> redirect to /login
  if (!isAuthenticated && !isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    if (pathname !== '/') {
      redirectUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(redirectUrl);
  }

  // 2. Authenticated users visiting login/register/auth -> redirect to destination or home
  if (isAuthenticated && isAuthRoute && !isCallbackRoute) {
    const redirectParam = request.nextUrl.searchParams.get('redirect');
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = redirectParam && redirectParam.startsWith('/') ? redirectParam : '/';
    redirectUrl.searchParams.delete('redirect');
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
