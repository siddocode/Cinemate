import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
const { AudioLevelMonitor } = jiti(
  path.join(process.cwd(), 'src/core/call/AudioLevelMonitor.ts')
);

describe('Phase 10.5 — Middleware, AudioLevelMonitor & End-to-End Integration Checks', () => {
  it('1. updateSession middleware returns JSON 401 for unauthenticated /api/* requests while keeping /room/* redirects', async () => {
    const apiReq = new NextRequest(
      'http://localhost:3000/api/rooms/11111111-1111-4111-8111-111111111111/call/ice-servers',
      { method: 'POST' }
    );
    const apiRes = await updateSession(apiReq);
    assert.equal(apiRes.status, 401);
    const apiBody = await apiRes.json();
    assert.equal(apiBody.error, 'Authentication required.');

    const pageReq = new NextRequest('http://localhost:3000/room/SYNC-4821', {
      method: 'GET',
    });
    const pageRes = await updateSession(pageReq);
    assert.equal(pageRes.status, 307);
    assert.match(pageRes.headers.get('location') || '', /\/login\?redirect=%2Froom%2FSYNC-4821/);

    const cronReq = new NextRequest('http://localhost:3000/api/cron/cleanup', {
      method: 'GET',
    });
    const cronRes = await updateSession(cronReq);
    assert.equal(cronRes.status, 200);
  });

  it('2. AudioLevelMonitor detects speaking energy, respects mute state, and cleans up AudioContext on destroy', async () => {
    const events = [];
    let currentEnergy = 0;
    let closedCount = 0;
    let disconnectedCount = 0;

    class MockAudioContext {
      constructor() {
        this.state = 'running';
      }
      async resume() {
        this.state = 'running';
      }
      createMediaStreamSource() {
        return {
          connect() {},
          disconnect() {
            disconnectedCount += 1;
          },
        };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          smoothingTimeConstant: 0.6,
          frequencyBinCount: 4,
          disconnect() {
            disconnectedCount += 1;
          },
          getByteFrequencyData(arr) {
            arr.fill(currentEnergy);
          },
        };
      }
      async close() {
        closedCount += 1;
      }
    }

    const prevWindow = globalThis.window;
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const monitor = new AudioLevelMonitor((key, speaking) => {
        events.push({ key, speaking });
      });

      const fakeTrack = { enabled: true };
      const fakeStream = {
        getAudioTracks: () => [fakeTrack],
      };

      monitor.trackStream('local', fakeStream, false);

      // Simulate active speech above threshold (18)
      currentEnergy = 45;
      await new Promise((r) => setTimeout(r, 150));
      assert.ok(
        events.some((e) => e.key === 'local' && e.speaking === true),
        'Expected speaking=true when audio energy exceeds threshold'
      );

      // Muting immediately clears speaking indicator
      monitor.setMuted('local', true);
      assert.deepEqual(events[events.length - 1], { key: 'local', speaking: false });

      monitor.destroy();
      assert.ok(disconnectedCount >= 2, 'Expected Web Audio nodes to disconnect on destroy');
      assert.equal(closedCount, 1, 'Expected AudioContext.close() on destroy');
    } finally {
      globalThis.window = prevWindow;
    }
  });

  it('3. Interactive actions enforce pending spinners and lock concurrent/conflicting UI actions', () => {
    const modalCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ui/Modal.tsx'),
      'utf-8'
    );
    const authFormCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/auth/AuthFormContent.tsx'),
      'utf-8'
    );
    const authModalCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/auth/AuthModal.tsx'),
      'utf-8'
    );
    const changeVideoCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/ChangeVideoModal.tsx'),
      'utf-8'
    );
    const navbarCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/common/Navbar.tsx'),
      'utf-8'
    );
    const homeCode = fs.readFileSync(
      path.join(process.cwd(), 'src/app/page.tsx'),
      'utf-8'
    );
    const useCallCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useCall.ts'),
      'utf-8'
    );
    const voiceBarCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/call/VoiceCallBar.tsx'),
      'utf-8'
    );
    const roomHeaderCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomHeader.tsx'),
      'utf-8'
    );

    assert.match(modalCode, /preventClose\?:\s*boolean/);
    assert.match(authModalCode, /preventClose=\{isAuthenticating\}/);
    assert.match(authFormCode, /disabled=\{isLoading\}/);
    assert.match(changeVideoCode, /preventClose=\{isUploading\}/);
    assert.match(navbarCode, /isLoading=\{isSigningOut\}/);
    assert.match(navbarCode, /preventClose=\{isSavingName\}/);
    assert.match(homeCode, /isLobbyBusy/);
    assert.match(useCallCode, /isLeavingRef\.current/);
    assert.match(voiceBarCode, /isLoading=\{isLeaving\}/);
    assert.match(roomHeaderCode, /isLeavingRoom/);
  });
});

