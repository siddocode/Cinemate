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

const { roomService, parseRoomSessionPayload } = jiti(
  path.join(process.cwd(), 'src/lib/services/roomService.ts')
);

describe('Optimization 2 — Atomic Room Creation & Joining RPCs', () => {
  it('1. Migration 011 and full_setup.sql define secure, concurrency-safe create_room_session and join_room_session RPCs', () => {
    const migration011 = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/011_atomic_room_session_rpcs.sql'),
      'utf-8'
    );
    const fullSetup = fs.readFileSync(
      path.join(process.cwd(), 'supabase/full_setup.sql'),
      'utf-8'
    );

    for (const sql of [migration011, fullSetup]) {
      assert.match(sql, /CREATE OR REPLACE FUNCTION public\._finalize_room_session\(/);
      assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_room_session\(/);
      assert.match(sql, /CREATE OR REPLACE FUNCTION public\.join_room_session\(/);
      assert.match(sql, /pg_advisory_xact_lock\(/);
      assert.match(sql, /HINT = 'ROOM_FULL'/);
      assert.match(sql, /kicked_user_ids/);
      assert.match(sql, /WHEN unique_violation THEN/);
      assert.match(sql, /p_video_url/);
      assert.match(sql, /p_video_type/);
      assert.match(
        sql,
        /REVOKE EXECUTE ON FUNCTION public\._finalize_room_session\([\s\S]*?\) FROM PUBLIC, anon, authenticated/
      );
      assert.match(
        sql,
        /REVOKE EXECUTE ON FUNCTION public\.create_room_session\([\s\S]*?\) FROM PUBLIC, anon/
      );
      assert.match(
        sql,
        /REVOKE EXECUTE ON FUNCTION public\.join_room_session\([\s\S]*?\) FROM PUBLIC, anon/
      );
      assert.match(sql, /NOTIFY pgrst,\s*'reload schema'/i);
    }
  });

  it('2. parseRoomSessionPayload maps atomic RPC JSONB response and handles missing room cleanly', () => {
    const missing = parseRoomSessionPayload({ room: null, role: 'viewer', members: [] });
    assert.equal(missing.room, null);
    assert.equal(missing.notFound, true);
    assert.deepEqual(missing.members, []);

    const parsed = parseRoomSessionPayload({
      room: {
        id: 'room-uuid-1',
        code: 'SYNC-9001',
        title: 'Movie Night',
        host_id: 'user-host',
        video_type: 'youtube',
        video_url: 'dQw4w9WgXcQ',
        current_position: 0,
        is_playing: false,
        last_synced_at: '2026-11-12T10:00:00.000Z',
        is_private: true,
        allow_guest_control: false,
        allow_guest_call: false,
        kicked_user_ids: [],
        created_at: '2026-11-12T10:00:00.000Z',
        updated_at: '2026-11-12T10:00:00.000Z',
      },
      role: 'host',
      created: true,
      members: [
        {
          id: 'mem-1',
          room_id: 'room-uuid-1',
          user_id: 'user-host',
          username: 'Sid',
          role: 'host',
          joined_at: '2026-11-12T10:00:00.000Z',
          last_seen_at: '2026-11-12T10:00:00.000Z',
        },
      ],
    });

    assert.equal(parsed.room?.id, 'room-uuid-1');
    assert.equal(parsed.room?.videoUrl, 'dQw4w9WgXcQ');
    assert.equal(parsed.role, 'host');
    assert.equal(parsed.created, true);
    assert.equal(parsed.members.length, 1);
    assert.equal(parsed.members[0].username, 'Sid');
  });

  it('3. createRoomSession & joinRoomSession return room + members in one call, include initial video, and enforce 4-member cap', async () => {
    const code = `SYNC-${Math.floor(1000 + Math.random() * 9000)}`;
    const host = { id: 'u-host', username: 'Sid', isGuest: false };

    const created = await roomService.createRoomSession({
      code,
      title: 'Atomic Screening',
      host,
      videoUrl: 'abc123XYZ',
      videoType: 'youtube',
    });

    assert.ok(created.room);
    assert.equal(created.room.videoUrl, 'abc123XYZ');
    assert.equal(created.role, 'host');
    assert.equal(created.members.length, 1);
    assert.equal(created.members[0].userId, 'u-host');

    const missing = await roomService.joinRoomSession({
      code: 'SYNC-NOPE99',
      user: { id: 'u-2', username: 'Mira', isGuest: false },
    });
    assert.equal(missing.room, null);
    assert.equal(missing.notFound, true);

    for (const [idx, uid] of ['u-2', 'u-3', 'u-4'].entries()) {
      const joined = await roomService.joinRoomSession({
        code,
        user: { id: uid, username: `Viewer${idx + 2}`, isGuest: false },
      });
      assert.ok(joined.room);
      assert.equal(joined.role, 'viewer');
      assert.equal(joined.members.length, idx + 2);
    }

    // 5th participant must be rejected by capacity cap
    const full = await roomService.joinRoomSession({
      code,
      user: { id: 'u-5', username: 'Overflow', isGuest: false },
    });
    assert.match(full.error || '', /maximum capacity/i);
  });

  it('4. useRoom and RoomView eliminate redundant init calls and pass initialVideoId into createRoomSession', () => {
    const useRoomCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useRoom.ts'),
      'utf-8'
    );
    const roomViewCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );
    const roomServiceCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/services/roomService.ts'),
      'utf-8'
    );

    assert.match(useRoomCode, /roomService\.createRoomSession\(/);
    assert.match(useRoomCode, /roomService\.joinRoomSession\(/);
    assert.doesNotMatch(useRoomCode, /roomService\.getOrCreateRoom\(/);
    assert.doesNotMatch(useRoomCode, /roomService\.getRoomByCode\(/);
    assert.doesNotMatch(useRoomCode, /roomService\.joinRoom\(/);

    assert.match(
      roomViewCode,
      /useRoom\(roomCode,\s*initialTitle,\s*allowCreate,\s*initialVideoId,\s*initialVideoType\)/
    );
    assert.doesNotMatch(roomServiceCode, /ensureProfile\(/);
  });
});

