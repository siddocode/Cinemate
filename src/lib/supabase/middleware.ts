import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { Database } from './database.types';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';
import {
  getCachedJwks,
  getVerifiedAuthClaims,
  hasSupabaseAuthCookie,
  isAuthenticatedClaims,
} from './auth';

export interface UpdateSessionOptions {
  supabaseUrl?: string;
  publishableKey?: string;
  fetchImpl?: typeof fetch;
}

export async function updateSession(
  request: NextRequest,
  options?: UpdateSessionOptions
) {
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

  // Allow cron routes and OAuth/PKCE callback exchange to run without middleware auth gating
  if (pathname.startsWith('/api/cron') || pathname === '/auth/callback') {
    return supabaseResponse;
  }

  const supabaseUrl = options?.supabaseUrl ?? SUPABASE_URL;
  const publishableKey = options?.publishableKey ?? SUPABASE_PUBLISHABLE_KEY;
  const isConfigured =
    Boolean(supabaseUrl) &&
    Boolean(publishableKey) &&
    !supabaseUrl.includes('placeholder');

  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/auth');

  const isApiRoute = pathname.startsWith('/api/');

  // Fast-path: no Supabase auth session cookie on request -> unauthenticated without client/crypto work
  const hasAuthCookie = hasSupabaseAuthCookie(request.cookies.getAll());
  let isAuthenticated = false;

  if (isConfigured && hasAuthCookie) {
    const supabase = createServerClient<Database>(supabaseUrl, publishableKey, {
      ...(options?.fetchImpl ? { global: { fetch: options.fetchImpl } } : {}),
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
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
            supabaseResponse.cookies.set(name, value, cookieOptions)
          );
        },
      },
    });

    // Verify JWT claims locally via cached JWKS WebCrypto (refreshing expiring sessions as needed)
    try {
      const jwks = await getCachedJwks(supabaseUrl, publishableKey, options?.fetchImpl);
      const verified = await getVerifiedAuthClaims(supabase, {
        jwks,
        supabaseUrl,
      });
      isAuthenticated = isAuthenticatedClaims(verified?.claims);
    } catch {
      isAuthenticated = false;
    }
  }

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
  if (isAuthenticated && isAuthRoute) {
    const redirectParam = request.nextUrl.searchParams.get('redirect');
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = redirectParam && redirectParam.startsWith('/') ? redirectParam : '/';
    redirectUrl.searchParams.delete('redirect');
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
