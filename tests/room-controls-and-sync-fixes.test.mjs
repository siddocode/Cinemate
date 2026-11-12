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

const { SyncEngine } = jiti(path.join(process.cwd(), 'src/core/sync/SyncEngine.ts'));

function createMockAdapter(initialState = { currentTime: 0, duration: 120, isPlaying: false, playbackRate: 1.0, bufferedTime: 0, isBuffering: false }) {
  const listeners = new Map();
  let state = { ...initialState };
  const calls = [];

  return {
    calls,
    getState: () => state,
    emit(event, overrideState) {
      if (overrideState) state = { ...state, ...overrideState };
      const handlers = listeners.get(event);
      if (handlers) {
        handlers.forEach((fn) => fn({ ...state }));
      }
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    async initialize() {},
    async play() {
      calls.push('play');
      state.isPlaying = true;
    },
    async pause() {
      calls.push('pause');
      state.isPlaying = false;
    },
    async seekTo(sec) {
      calls.push(`seek:${sec}`);
      state.currentTime = sec;
    },
    setPlaybackRate(rate) {
      calls.push(`rate:${rate}`);
      state.playbackRate = rate;
    },
    setVolume() {},
    getPlaybackState() {
      return { ...state };
    },
    async loadVideo() {},
    destroy() {
      listeners.clear();
    },
  };
}

function createMockChannel() {
  const broadcastHandlers = new Map();
  const sentMessages = [];

  return {
    sentMessages,
    on(type, filter, handler) {
      if (type === 'broadcast' && filter?.event) {
        if (!broadcastHandlers.has(filter.event)) {
          broadcastHandlers.set(filter.event, []);
        }
        broadcastHandlers.get(filter.event).push(handler);
      }
      return this;
    },
    async send(msg) {
      sentMessages.push(msg);
      return 'ok';
    },
    triggerBroadcast(event, payload) {
      const handlers = broadcastHandlers.get(event) || [];
      handlers.forEach((h) => h({ payload }));
    },
  };
}

describe('Room Controls, Autoplay Fix, Kick & Cleanup', () => {
  it('1. SyncEngine keeps joiner paused on initial load and blocks rogue autoplay while host is paused', async () => {
    const adapter = createMockAdapter({
      currentTime: 0,
      duration: 120,
      isPlaying: false,
      playbackRate: 1.0,
      bufferedTime: 0,
      isBuffering: false,
    });
    const channel = createMockChannel();

    const engine = new SyncEngine({
      adapter,
      channel,
      roomId: 'room-1',
      userId: 'viewer-1',
      isHost: false,
      canControl: false,
      initialPlayback: {
        position: 0,
        isPlaying: false,
        lastSyncedAt: new Date().toISOString(),
      },
    });

    // Should enforce pause on init when host is paused
    assert.ok(adapter.calls.includes('pause'), 'Viewer should enforce pause on join when host is paused');

    // Simulate rogue browser/iframe autoplay firing PLAY while host is paused
    adapter.calls.length = 0;
    adapter.emit('PLAY', { isPlaying: true });
    assert.ok(adapter.calls.includes('pause'), 'Rogue PLAY on viewer while host is paused must trigger immediate pause');
    assert.equal(
      channel.sentMessages.filter((m) => m.event === 'SYNC_STATE').length,
      0,
      'Viewer without control must not broadcast SYNC_STATE'
    );

    // Simulate incoming HEARTBEAT from paused host even if viewer localState.isPlaying was false
    adapter.calls.length = 0;
    channel.triggerBroadcast('SYNC_STATE', {
      version: 1,
      roomId: 'room-1',
      senderId: 'host-1',
      action: 'HEARTBEAT',
      position: 0,
      isPlaying: false,
      playbackRate: 1.0,
      sentAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(
      adapter.calls.includes('pause'),
      'Paused host HEARTBEAT must enforce pause() regardless of localState.isPlaying'
    );

    // Now host starts playing -> viewer syncs and plays
    adapter.calls.length = 0;
    channel.triggerBroadcast('SYNC_STATE', {
      version: 1,
      roomId: 'room-1',
      senderId: 'host-1',
      action: 'PLAY',
      position: 12,
      isPlaying: true,
      playbackRate: 1.0,
      sentAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(adapter.calls.includes('play'), 'Viewer should play once host sends PLAY');

    engine.destroy();
  });

  it('2. SyncEngine allows delegated controllers (co-host / shared control) to broadcast play/pause/seek', () => {
    const adapter = createMockAdapter();
    const channel = createMockChannel();
    const persisted = [];

    const engine = new SyncEngine({
      adapter,
      channel,
      roomId: 'room-1',
      userId: 'guest-1',
      isHost: false,
      canControl: false,
      onPersistSnapshot: (pos, playing) => persisted.push({ pos, playing }),
    });

    // Initially cannot control -> PLAY does not broadcast
    adapter.emit('PLAY', { currentTime: 10, isPlaying: true });
    assert.equal(channel.sentMessages.filter((m) => m.event === 'SYNC_STATE').length, 0);

    // Host grants control -> updateCanControl(true)
    engine.updateCanControl(true);
    adapter.emit('PLAY', { currentTime: 15, isPlaying: true });
    adapter.emit('SEEKED', { currentTime: 42, isPlaying: true });
    adapter.emit('PAUSE', { currentTime: 42, isPlaying: false });

    const syncEvents = channel.sentMessages
      .filter((m) => m.event === 'SYNC_STATE')
      .map((m) => m.payload.action);
    assert.deepEqual(syncEvents, ['PLAY', 'SEEK', 'PAUSE']);
    assert.equal(persisted.length, 3);

    engine.destroy();
  });

  it('3. Player adapters prevent unintended autoplay on ready and cueVideoById when paused', () => {
    const ytAdapterCode = fs.readFileSync(
      path.join(process.cwd(), 'src/core/adapters/YouTubePlayerAdapter.ts'),
      'utf-8'
    );
    const html5AdapterCode = fs.readFileSync(
      path.join(process.cwd(), 'src/core/adapters/HTML5VideoAdapter.ts'),
      'utf-8'
    );

    assert.match(
      ytAdapterCode,
      /if \(!this\.wantPlaying\)[\s\S]*?playerInstance\.pauseVideo\(\)/,
      'YouTubePlayerAdapter must explicitly pauseVideo onReady when !wantPlaying'
    );
    assert.match(
      ytAdapterCode,
      /cueVideoById\(cleanId, 0\)/,
      'YouTubePlayerAdapter.loadVideo must use cueVideoById when !wantPlaying'
    );
    assert.match(
      html5AdapterCode,
      /video\.autoplay\s*=\s*false/,
      'HTML5VideoAdapter must explicitly set video.autoplay = false'
    );
  });

  it('4. SQL migration 007 and full_setup.sql implement guest control permissions, kick protection, and host-settings guard', () => {
    const migration007 = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/007_room_permissions_and_kick.sql'),
      'utf-8'
    );
    const fullSetup = fs.readFileSync(
      path.join(process.cwd(), 'supabase/full_setup.sql'),
      'utf-8'
    );

    for (const sql of [migration007, fullSetup]) {
      assert.match(sql, /ALTER TABLE public\.rooms[\s\S]*?ADD COLUMN IF NOT EXISTS allow_guest_control/i);
      assert.match(sql, /allow_guest_control\s+BOOLEAN\s+DEFAULT\s+false/i);
      assert.match(sql, /kicked_user_ids\s+UUID\[\]/i);
      assert.match(sql, /enforce_kicked_member_viewer_only/);
      assert.match(sql, /NOT \(auth\.uid\(\) = ANY\(COALESCE\(kicked_user_ids/);
      assert.match(sql, /guard_room_settings_update/);
      assert.match(sql, /NOTIFY pgrst,\s*'reload schema'/i);
    }
  });

  it('5. Room UI, useRoom, UniversalPlayer, roomService, and cleanup route wire kick, permissions, co-host seek, and storage cleanup', () => {
    const useRoomCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useRoom.ts'),
      'utf-8'
    );
    const roomViewCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );
    const playerCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/player/UniversalPlayer.tsx'),
      'utf-8'
    );
    const roomServiceCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/services/roomService.ts'),
      'utf-8'
    );
    const changeModalCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/ChangeVideoModal.tsx'),
      'utf-8'
    );
    const cleanupRouteCode = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/rooms/[id]/video/route.ts'),
      'utf-8'
    );

    const roomHeaderCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomHeader.tsx'),
      'utf-8'
    );

    assert.match(useRoomCode, /event:\s*'KICK_MEMBER'/);
    assert.match(useRoomCode, /event:\s*'ROLE_CHANGE'/);
    assert.match(useRoomCode, /event:\s*'ROOM_SETTINGS_CHANGE'/);
    assert.match(useRoomCode, /event:\s*'ROOM_CLOSED'/);
    assert.match(useRoomCode, /table:\s*'room_members'/);
    assert.match(useRoomCode, /isRestrictedViewer/);
    assert.match(useRoomCode, /closeRoom/);
    assert.match(useRoomCode, /cleanupRoomVideos/);
    assert.doesNotMatch(
      useRoomCode,
      /transferHost/,
      'useRoom must close room rather than auto-failing over host authority to another participant'
    );

    assert.match(roomHeaderCode, /onCloseRoom/);
    assert.doesNotMatch(roomHeaderCode, /until failover/);

    assert.match(playerCode, /disabled=\{!hasControl\}/);
    assert.match(roomServiceCode, /existingRole/);

    assert.match(roomViewCode, /RoomParticipantsModal/);
    assert.match(roomViewCode, /if \(isKicked\)/);
    assert.match(roomViewCode, /if \(isRoomClosed\)/);

    assert.match(changeModalCode, /storageService\.cleanupRoomVideos\(roomId\)/);
    assert.match(cleanupRouteCode, /storage_usage_metrics/);
    assert.match(cleanupRouteCode, /\.from\('videos'\)\s*\.remove/);
  });
});

