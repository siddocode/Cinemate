import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const { createJiti } = require('jiti');

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.join(process.cwd(), 'src'),
  },
});

const { updateSession } = jiti(
  path.join(process.cwd(), 'src/lib/supabase/middleware.ts')
);
const {
  hasSupabaseAuthCookie,
  isAuthenticatedClaims,
  invalidateCachedJwks,
} = jiti(path.join(process.cwd(), 'src/lib/supabase/auth.ts'));

const TEST_SUPABASE_URL = 'https://testproj.supabase.co';
const TEST_PUBLISHABLE_KEY = 'sb_publishable_test_key';
const COOKIE_NAME = 'sb-testproj-auth-token';

function toBase64Url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function generateSigningMaterial(kid) {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicJwk: {
      ...publicJwk,
      kid,
      alg: 'ES256',
      use: 'sig',
      key_ops: ['verify'],
    },
  };
}

async function signEs256Jwt(privateKey, header, payload) {
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf-8');
  const signatureBuffer = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signingInput
  );
  return `${encodedHeader}.${encodedPayload}.${toBase64Url(new Uint8Array(signatureBuffer))}`;
}

function buildSessionCookieValue(accessToken, expiresAtSec) {
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: Math.max(60, expiresAtSec - Math.floor(Date.now() / 1000)),
    expires_at: expiresAtSec,
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'viewer@syncora.test',
      role: 'authenticated',
      is_anonymous: false,
    },
  });
}

function makeRequest(urlPath, cookieValue) {
  const headers = new Headers();
  if (cookieValue !== undefined) {
    headers.set('cookie', `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}`);
  }
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: 'GET',
    headers,
  });
}

function createAuthMockFetch(getKeys) {
  const counts = {
    jwks: 0,
    user: 0,
    tokenRefresh: 0,
    other: 0,
  };

  const fetchImpl = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/auth/v1/.well-known/jwks.json')) {
      counts.jwks += 1;
      return new Response(JSON.stringify({ keys: getKeys() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/auth/v1/user')) {
      counts.user += 1;
      return new Response(JSON.stringify({ message: 'invalid JWT', error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/auth/v1/token')) {
      counts.tokenRefresh += 1;
      return new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    counts.other += 1;
    return new Response(JSON.stringify({ error: 'unexpected request' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl, counts };
}

describe('Optimization 3 — Faster Authentication (Verified JWT Claims Middleware)', () => {
  beforeEach(() => {
    invalidateCachedJwks();
  });

  it('1. Verifies ES256 JWTs locally via cached JWKS with zero /auth/v1/user requests and 1 JWKS fetch', async () => {
    const { privateKey, publicJwk } = await generateSigningMaterial('kid-primary');
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await signEs256Jwt(
      privateKey,
      { alg: 'ES256', typ: 'JWT', kid: 'kid-primary' },
      {
        sub: '11111111-1111-4111-8111-111111111111',
        email: 'viewer@syncora.test',
        role: 'authenticated',
        aud: 'authenticated',
        is_anonymous: false,
        iat: nowSec,
        exp: nowSec + 3600,
      }
    );
    const cookieVal = buildSessionCookieValue(jwt, nowSec + 3600);
    const { fetchImpl, counts } = createAuthMockFetch(() => [publicJwk]);

    for (let i = 0; i < 20; i += 1) {
      const res = await updateSession(makeRequest('/room/SYNC-4821', cookieVal), {
        supabaseUrl: TEST_SUPABASE_URL,
        publishableKey: TEST_PUBLISHABLE_KEY,
        fetchImpl,
      });
      assert.equal(res.status, 200);
    }

    // Authenticated user visiting /login redirects to requested destination cleanly
    const loginRedirect = await updateSession(
      makeRequest('/login?redirect=%2Froom%2FSYNC-4821', cookieVal),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        publishableKey: TEST_PUBLISHABLE_KEY,
        fetchImpl,
      }
    );
    assert.equal(loginRedirect.status, 307);
    assert.match(loginRedirect.headers.get('location') || '', /\/room\/SYNC-4821$/);

    assert.equal(counts.user, 0, 'Middleware must not call /auth/v1/user for valid asymmetric JWTs');
    assert.equal(counts.jwks, 1, 'JWKS should be fetched once and reused from module cache');
    assert.equal(counts.tokenRefresh, 0);
  });

  it('2. Cryptographically rejects forged signatures, unsigned alg:none tokens, expired tokens, and anonymous tokens', async () => {
    const { privateKey: trustedKey, publicJwk } = await generateSigningMaterial('kid-primary');
    const { privateKey: attackerKey } = await generateSigningMaterial('kid-primary');
    const nowSec = Math.floor(Date.now() / 1000);
    const { fetchImpl, counts } = createAuthMockFetch(() => [publicJwk]);

    // (a) Forged signature with attacker key claiming same kid
    const forgedJwt = await signEs256Jwt(
      attackerKey,
      { alg: 'ES256', typ: 'JWT', kid: 'kid-primary' },
      {
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        is_anonymous: false,
        iat: nowSec,
        exp: nowSec + 3600,
      }
    );
    const forgedPageRes = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(forgedJwt, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(forgedPageRes.status, 307);
    assert.match(forgedPageRes.headers.get('location') || '', /\/login\?redirect=%2Froom%2FSYNC-4821/);

    const forgedApiRes = await updateSession(
      makeRequest(
        '/api/rooms/11111111-1111-4111-8111-111111111111/call/leave',
        buildSessionCookieValue(forgedJwt, nowSec + 3600)
      ),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(forgedApiRes.status, 401);

    // (c) Expired token with invalid refresh grant
    const expiredJwt = await signEs256Jwt(
      trustedKey,
      { alg: 'ES256', typ: 'JWT', kid: 'kid-primary' },
      {
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        is_anonymous: false,
        iat: nowSec - 7200,
        exp: nowSec - 120,
      }
    );
    const expiredRes = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(expiredJwt, nowSec - 120)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(expiredRes.status, 307);

    // (d) Validly signed anonymous session must remain blocked from protected routes
    const anonJwt = await signEs256Jwt(
      trustedKey,
      { alg: 'ES256', typ: 'JWT', kid: 'kid-primary' },
      {
        sub: '22222222-2222-4222-8222-222222222222',
        role: 'authenticated',
        is_anonymous: true,
        iat: nowSec,
        exp: nowSec + 3600,
      }
    );
    const anonRes = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(anonJwt, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(anonRes.status, 307);

    assert.equal(isAuthenticatedClaims({ sub: 'abc', role: 'anon', is_anonymous: false }), false);
    // Forged ES256, expired ES256, and anonymous ES256 must never trigger /auth/v1/user
    assert.equal(counts.user, 0);

    // (e) Unsigned alg:none token falls back safely and is rejected with 401 -> 307 redirect
    const algNoneToken = `${toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${toBase64Url(
      JSON.stringify({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        exp: nowSec + 3600,
      })
    )}.`;
    const algNoneRes = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(algNoneToken, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(algNoneRes.status, 307);
  });

  it('3. Skips auth verification and network calls completely when auth cookie is absent or route is callback/cron', async () => {
    const { fetchImpl, counts } = createAuthMockFetch(() => []);

    const loginRes = await updateSession(makeRequest('/login'), {
      supabaseUrl: TEST_SUPABASE_URL,
      publishableKey: TEST_PUBLISHABLE_KEY,
      fetchImpl,
    });
    assert.equal(loginRes.status, 200);

    const callbackRes = await updateSession(makeRequest('/auth/callback?code=pkce-code'), {
      supabaseUrl: TEST_SUPABASE_URL,
      publishableKey: TEST_PUBLISHABLE_KEY,
      fetchImpl,
    });
    assert.equal(callbackRes.status, 200);

    // Request carrying only PKCE code-verifier cookie must not trigger session verification
    const verifierReq = new NextRequest('http://localhost:3000/room/SYNC-4821', {
      method: 'GET',
      headers: { cookie: 'sb-testproj-auth-token-code-verifier=verifier123' },
    });
    const verifierRes = await updateSession(verifierReq, {
      supabaseUrl: TEST_SUPABASE_URL,
      publishableKey: TEST_PUBLISHABLE_KEY,
      fetchImpl,
    });
    assert.equal(verifierRes.status, 307);

    assert.equal(hasSupabaseAuthCookie([{ name: 'sb-testproj-auth-token-code-verifier', value: 'v' }]), false);
    assert.equal(hasSupabaseAuthCookie([{ name: 'sb-testproj-auth-token.0', value: 'chunk' }]), true);
    assert.equal(counts.jwks + counts.user + counts.tokenRefresh + counts.other, 0);
  });

  it('4. Handles JWKS key rotation seamlessly when a token presents a new kid', async () => {
    const key1 = await generateSigningMaterial('kid-1');
    const key2 = await generateSigningMaterial('kid-2');
    const nowSec = Math.floor(Date.now() / 1000);

    let activeKeys = [key1.publicJwk];
    const { fetchImpl, counts } = createAuthMockFetch(() => activeKeys);

    const jwt1 = await signEs256Jwt(
      key1.privateKey,
      { alg: 'ES256', typ: 'JWT', kid: 'kid-1' },
      { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', is_anonymous: false, exp: nowSec + 3600 }
    );
    const res1 = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(jwt1, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(res1.status, 200);
    assert.equal(counts.jwks, 1);

    // Rotate signing key on auth server
    activeKeys = [key1.publicJwk, key2.publicJwk];
    const jwt2 = await signEs256Jwt(
      key2.privateKey,
      { alg: 'ES256', typ: 'JWT', kid: 'kid-2' },
      { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', is_anonymous: false, exp: nowSec + 3600 }
    );
    const res2 = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(jwt2, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(res2.status, 200);
    // Stale cache was invalidated upon seeing rotated kid-2; next call refreshes once then stays cached
    const res3 = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(jwt2, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(res3.status, 200);
    const res4 = await updateSession(
      makeRequest('/room/SYNC-4821', buildSessionCookieValue(jwt2, nowSec + 3600)),
      { supabaseUrl: TEST_SUPABASE_URL, publishableKey: TEST_PUBLISHABLE_KEY, fetchImpl }
    );
    assert.equal(res4.status, 200);

    assert.equal(counts.user, 0);
    assert.equal(counts.jwks, 3);
  });

  it('5. Middleware uses verified JWT claims while privileged/admin API routes retain getUser() server checks', () => {
    const middlewareCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/supabase/middleware.ts'),
      'utf-8'
    );
    const deleteRoomRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/rooms/[id]/route.ts'),
      'utf-8'
    );
    const deleteVideoRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/rooms/[id]/video/route.ts'),
      'utf-8'
    );
    const iceServersRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/rooms/[id]/call/ice-servers/route.ts'),
      'utf-8'
    );

    assert.doesNotMatch(middlewareCode, /\.auth\.getUser\(/);
    assert.match(middlewareCode, /getVerifiedAuthClaims\(/);
    assert.match(middlewareCode, /getCachedJwks\(/);
    assert.match(deleteRoomRoute, /\.auth\.getUser\(/);
    assert.match(deleteVideoRoute, /\.auth\.getUser\(/);
    assert.match(iceServersRoute, /\.auth\.getUser\(/);
  });
});
