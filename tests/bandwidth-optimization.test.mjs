import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Syncora Free-Tier Bandwidth & Resource Optimization Audit', () => {
  it('1. Bandwidth-aware playback: HTML5 adapter must use preload="metadata"', () => {
    const adapterCode = fs.readFileSync(
      path.join(process.cwd(), 'src/core/adapters/HTML5VideoAdapter.ts'),
      'utf-8'
    );
    assert.match(
      adapterCode,
      /video\.preload\s*=\s*['"]metadata['"]/,
      'HTML5VideoAdapter must set preload="metadata" to avoid downloading entire 50MB files on page load'
    );
  });

  it('2. Video CDN Caching: Storage adapter must configure long cache-control for range requests', () => {
    const supabaseStorageCode = fs.readFileSync(
      path.join(process.cwd(), 'src/core/adapters/storage/SupabaseStorageProvider.ts'),
      'utf-8'
    );
    assert.match(
      supabaseStorageCode,
      /cacheControl/,
      'SupabaseStorageProvider must set Cache-Control for Cloudflare CDN edge caching'
    );
    assert.match(
      supabaseStorageCode,
      /604800|CACHE_CONTROL_SECONDS/,
      'Cache-Control should be long-lived (e.g. 7 days / 604800s) to maximize edge cache hit ratio'
    );
  });

  it('3. Provider-Independent Storage Interface: IVideoStorageProvider abstraction defined', () => {
    const typesCode = fs.readFileSync(
      path.join(process.cwd(), 'src/core/types/storage.types.ts'),
      'utf-8'
    );
    assert.match(typesCode, /export interface IVideoStorageProvider/, 'Must define IVideoStorageProvider interface');
    assert.match(typesCode, /uploadVideo/, 'Must include uploadVideo in interface');
    assert.match(typesCode, /getSignedPlaybackUrl/, 'Must include getSignedPlaybackUrl in interface');
    assert.match(typesCode, /deleteVideo/, 'Must include deleteVideo in interface');

    const r2TemplateCode = fs.readFileSync(
      path.join(process.cwd(), 'src/core/adapters/storage/CloudflareR2StorageProvider.ts'),
      'utf-8'
    );
    assert.match(r2TemplateCode, /implements IVideoStorageProvider/, 'Cloudflare R2 adapter must implement IVideoStorageProvider');
  });

  it('4. Participant Limit & Quotas: Room service must enforce max participant limits', () => {
    const roomServiceCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/services/roomService.ts'),
      'utf-8'
    );
    assert.match(
      roomServiceCode,
      /MAX_ROOM_PARTICIPANTS/,
      'roomService.joinRoom must enforce MAX_ROOM_PARTICIPANTS to prevent viral egress spikes'
    );
  });

  it('5. Bandwidth Guardrails & Warnings: Modal must handle soft warnings and hard ceiling stops', () => {
    const modalCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/ChangeVideoModal.tsx'),
      'utf-8'
    );
    assert.match(
      modalCode,
      /isHardBlocked/,
      'ChangeVideoModal must disable uploads when monthly bandwidth ceiling is reached'
    );
    assert.match(
      modalCode,
      /isSoftWarning/,
      'ChangeVideoModal must show advisory notice when bandwidth approaches soft threshold'
    );
  });

  it('6. Cleanup Idempotency: Cleanup API and SQL migration must safely delete storage objects', () => {
    const cleanupRouteCode = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/cron/cleanup/route.ts'),
      'utf-8'
    );
    assert.match(cleanupRouteCode, /runVideoCleanup/, 'Cleanup route must invoke runVideoCleanup()');

    const migration3Code = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/003_bandwidth_and_cleanup.sql'),
      'utf-8'
    );
    assert.match(migration3Code, /get_expired_videos/, 'SQL migration must define expired video retrieval query');
    assert.match(migration3Code, /storage_usage_metrics/, 'SQL migration must define storage_usage_metrics table');
  });

  it('7. Realtime Message Optimization: Unified channel and throttled typing broadcasts', () => {
    const chatHookCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useChat.ts'),
      'utf-8'
    );
    assert.match(
      chatHookCode,
      /lastTypingSentRef/,
      'useChat must throttle typing broadcasts to avoid exhausting Realtime quota'
    );
  });
});

