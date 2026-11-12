import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.join(process.cwd(), 'src'),
  },
});

const { generateCallIceServers } = jiti(
  path.join(process.cwd(), 'src/lib/services/turnService.ts')
);

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('Phase 10.2 — Two-Person Voice Call Authorization & TURN Service', () => {
  it('1. STUN-only dev fallback activates when Cloudflare TURN env vars are omitted', async () => {
    const res = await generateCallIceServers({
      env: {},
    });

    assert.equal(res.mode, 'stun-only');
    assert.equal(res.isProductionReady, false);
    assert.equal(res.ttlSeconds, 0);
    assert.ok(Array.isArray(res.iceServers) && res.iceServers.length === 1);
    assert.ok(res.iceServers[0].urls.includes('stun:stun.cloudflare.com:3478'));
    assert.match(res.warning || '', /STUN-only/i);
  });

  it('2. TURN_PROVIDER=stun-only forces STUN-only and filters invalid/port-53 STUN URLs', async () => {
    const res = await generateCallIceServers({
      env: {
        TURN_PROVIDER: 'stun-only',
        CLOUDFLARE_TURN_KEY_ID: 'cf_key_12345678',
        CLOUDFLARE_TURN_API_TOKEN: 'cf_secret_token_do_not_use',
        STUN_URLS: 'stun:custom.example.org:3478, stun:bad.example.org:53, https://not-stun',
      },
    });

    assert.equal(res.mode, 'stun-only');
    assert.equal(res.isProductionReady, false);
    assert.deepEqual(res.iceServers, [{ urls: ['stun:custom.example.org:3478'] }]);
  });

  it('3. Cloudflare TURN generates scoped short-lived credentials with clamped TTL and port-53 filtering', async () => {
    let capturedUrl = '';
    let capturedInit = null;

    const fakeFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:53?transport=udp',
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turns:turn.cloudflare.com:443?transport=tcp',
              ],
              username: 'ephemeral-user',
              credential: 'ephemeral-cred',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await generateCallIceServers({
      env: {
        CLOUDFLARE_TURN_KEY_ID: 'turn_key_abc12345',
        CLOUDFLARE_TURN_API_TOKEN: 'super_secret_cf_token',
        TURN_CREDENTIAL_TTL_SECONDS: '120', // below 300 -> clamped to 300
      },
      fetchImpl: fakeFetch,
    });

    assert.equal(
      capturedUrl,
      'https://rtc.live.cloudflare.com/v1/turn/keys/turn_key_abc12345/credentials/generate-ice-servers'
    );
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers.Authorization, 'Bearer super_secret_cf_token');
    assert.deepEqual(JSON.parse(capturedInit.body), { ttl: 300 });

    assert.equal(res.mode, 'turn');
    assert.equal(res.isProductionReady, true);
    assert.equal(res.ttlSeconds, 300);
    assert.equal(res.iceServers.length, 2);
    assert.deepEqual(res.iceServers[0], { urls: ['stun:stun.cloudflare.com:3478'] });
    assert.deepEqual(res.iceServers[1], {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'ephemeral-user',
      credential: 'ephemeral-cred',
    });
  });

  it('4. Rejects malformed Cloudflare TURN key IDs and avoids leaking secrets on upstream failure', async () => {
    await assert.rejects(
      () =>
        generateCallIceServers({
          env: {
            CLOUDFLARE_TURN_KEY_ID: '../evil/path',
            CLOUDFLARE_TURN_API_TOKEN: 'cf_secret_token_123456',
          },
        }),
      /Invalid CLOUDFLARE_TURN_KEY_ID/
    );

    const secret = 'cf_secret_token_never_leak_me';
    await assert.rejects(
      async () => {
        await generateCallIceServers({
          env: {
            CLOUDFLARE_TURN_KEY_ID: 'turn_key_abc12345',
            CLOUDFLARE_TURN_API_TOKEN: secret,
          },
          fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
        });
      },
      (err) => {
        assert.ok(!err.message.includes(secret), 'Error must not contain TURN API token');
        assert.match(err.message, /status 401/);
        return true;
      }
    );
  });

  it('5. Client source directories and gitignore protect server secrets and local env/CLI config', () => {
    const clientDirs = ['src/components', 'src/hooks', 'src/core', 'src/context'];
    const clientFiles = clientDirs.flatMap((dir) => walkFiles(path.join(process.cwd(), dir)));

    assert.ok(clientFiles.length > 0, 'Expected client files to audit');

    for (const filePath of clientFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(
        !content.includes('CLOUDFLARE_TURN_'),
        `Client file ${filePath} must never reference CLOUDFLARE_TURN_*`
      );
      assert.ok(
        !content.includes('SUPABASE_SECRET_KEY') && !content.includes('SUPABASE_SERVICE_ROLE_KEY'),
        `Client file ${filePath} must never reference server Supabase secret keys`
      );
      assert.ok(
        !content.includes('CRON_SECRET'),
        `Client file ${filePath} must never reference CRON_SECRET`
      );
      assert.ok(
        !content.includes('turnService') && !content.includes('@/lib/supabase/server'),
        `Client file ${filePath} must never import server-only services`
      );
    }

    const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8');
    assert.ok(
      !envExample.includes('NEXT_PUBLIC_CLOUDFLARE_TURN') &&
        !envExample.includes('NEXT_PUBLIC_SUPABASE_SECRET') &&
        !envExample.includes('NEXT_PUBLIC_CRON_SECRET'),
      '.env.example must never prefix server secrets with NEXT_PUBLIC_'
    );
    assert.match(envExample, /CRON_SECRET/, '.env.example must document CRON_SECRET');

    const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf-8');
    assert.match(gitignore, /^\.env\*/m, '.gitignore must exclude .env* files');
    assert.match(gitignore, /^!\.env\.example/m, '.gitignore must preserve .env.example');
    assert.match(gitignore, /\/supabase\/config\.toml/, '.gitignore must exclude local supabase/config.toml');
    assert.match(gitignore, /\/supabase\/\.temp\//, '.gitignore must exclude supabase/.temp/');

    const serverTs = fs.readFileSync(path.join(process.cwd(), 'src/lib/supabase/server.ts'), 'utf-8');
    assert.match(serverTs, /typeof window !== 'undefined'/, 'server.ts must enforce server-only runtime guard');

    const cronRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/cron/cleanup/route.ts'), 'utf-8');
    assert.match(cronRoute, /NODE_ENV === 'production'/, 'cron cleanup route must fail closed in production if CRON_SECRET is unset');
  });

  it('6. Call API routes and middleware enforce auth, room membership, active call slot, rate limit, and no-store', () => {
    const iceRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/rooms/[id]/call/ice-servers/route.ts'),
      'utf-8'
    );
    const leaveRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/rooms/[id]/call/leave/route.ts'),
      'utf-8'
    );
    const middlewareCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/supabase/middleware.ts'),
      'utf-8'
    );

    assert.match(iceRoute, /auth\.getUser\(\)/);
    assert.match(iceRoute, /user\.is_anonymous/);
    assert.match(iceRoute, /room_members/);
    assert.match(iceRoute, /room_call_participants/);
    assert.match(iceRoute, /check_and_record_call_credential_request/);
    assert.match(iceRoute, /no-store/);

    assert.match(leaveRoute, /auth\.getUser\(\)/);
    assert.match(leaveRoute, /leave_room_call/);

    assert.match(middlewareCode, /pathname\.startsWith\('\/api\/'\)/);
    assert.match(middlewareCode, /status:\s*401/);
  });

  it('7. Migration 006/008 and full_setup.sql enforce call cap, anti-spoofing Realtime RLS, and zero media/SDP storage', () => {
    const mig006 = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/006_voice_call_authorization.sql'),
      'utf-8'
    );
    const mig008 = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/008_four_way_voice_mesh.sql'),
      'utf-8'
    );
    const fullSetup = fs.readFileSync(
      path.join(process.cwd(), 'supabase/full_setup.sql'),
      'utf-8'
    );

    for (const sql of [mig006, fullSetup]) {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.room_call_participants/);
      assert.match(sql, /syncora:room_call:/);
      assert.match(sql, /syncora_call_members_can_receive/);
      assert.match(sql, /syncora_call_members_can_send/);
      assert.match(sql, /v_uid = v_sender_id/);
      assert.match(sql, /is_room_call_participant\(v_room_id, v_uid\)/);
      assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.join_room_call\(UUID\) FROM PUBLIC, anon/);
      assert.match(sql, /REVOKE ALL ON TABLE public\.call_credential_requests FROM PUBLIC, anon, authenticated/);
    }

    assert.match(mig006, /v_max CONSTANT INTEGER := 2/);
    for (const sql of [mig008, fullSetup]) {
      assert.match(sql, /v_max CONSTANT INTEGER := 4/);
      assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.join_room_call\(UUID\) FROM PUBLIC, anon/);
    }
  });
});

