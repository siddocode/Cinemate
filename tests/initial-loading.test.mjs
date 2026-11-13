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

const { mapClaimsToUserIdentity } = jiti(
  path.join(process.cwd(), 'src/lib/supabase/auth.ts')
);
const { fetchDashboardData } = jiti(
  path.join(process.cwd(), 'src/lib/services/dashboardService.ts')
);
const { roomService } = jiti(
  path.join(process.cwd(), 'src/lib/services/roomService.ts')
);
const { favoriteService } = jiti(
  path.join(process.cwd(), 'src/lib/services/favoriteService.ts')
);

describe('Optimization 4 — Faster Initial Loading', () => {
  it('1. mapClaimsToUserIdentity resolves authenticated JWT claims into UserIdentity cleanly', () => {
    const withUsername = mapClaimsToUserIdentity({
      sub: 'user-1',
      email: 'alice@example.com',
      role: 'authenticated',
      is_anonymous: false,
      user_metadata: { username: 'AliceCinema' },
    });
    assert.deepEqual(withUsername, {
      id: 'user-1',
      username: 'AliceCinema',
      email: 'alice@example.com',
      isGuest: false,
    });

    const emailFallback = mapClaimsToUserIdentity({
      sub: 'user-2',
      email: 'bob@syncora.app',
      role: 'authenticated',
      is_anonymous: false,
    });
    assert.deepEqual(emailFallback, {
      id: 'user-2',
      username: 'bob',
      email: 'bob@syncora.app',
      isGuest: false,
    });

    assert.equal(
      mapClaimsToUserIdentity({ sub: 'anon-1', role: 'authenticated', is_anonymous: true }),
      null
    );
    assert.equal(
      mapClaimsToUserIdentity({ sub: 'anon-2', role: 'anon', is_anonymous: false }),
      null
    );
    assert.equal(mapClaimsToUserIdentity(null), null);
  });

  it('2. fetchDashboardData executes recent rooms and favorites queries concurrently via Promise.all', async () => {
    const origGetUserRooms = roomService.getUserRooms;
    const origGetFavorites = favoriteService.getFavorites;

    const events = [];
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    roomService.getUserRooms = async (userId) => {
      events.push('rooms:start');
      await delay(40);
      events.push('rooms:end');
      return [
        {
          id: 'room-1',
          code: 'SYNC-1111',
          title: 'Hosted Room',
          hostId: userId,
          videoType: 'youtube',
          videoUrl: 'dQw4w9WgXcQ',
          currentPosition: 0,
          isPlaying: false,
          lastSyncedAt: new Date().toISOString(),
          isPrivate: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userRole: 'host',
          joinedAt: new Date().toISOString(),
        },
        {
          id: 'room-2',
          code: 'SYNC-2222',
          title: 'Other Host Room',
          hostId: 'other-user',
          videoType: 'youtube',
          videoUrl: '',
          currentPosition: 0,
          isPlaying: false,
          lastSyncedAt: new Date().toISOString(),
          isPrivate: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userRole: 'viewer',
          joinedAt: new Date().toISOString(),
        },
      ];
    };

    favoriteService.getFavorites = async (userId) => {
      events.push('favorites:start');
      await delay(40);
      events.push('favorites:end');
      return [
        {
          id: 'fav-1',
          userId,
          videoId: 'dQw4w9WgXcQ',
          videoTitle: 'Favorite Video',
          createdAt: new Date().toISOString(),
        },
      ];
    };

    try {
      const start = performance.now();
      const result = await fetchDashboardData('user-self');
      const elapsedMs = performance.now() - start;

      // Both must start before either ends (true concurrent execution)
      assert.equal(events[0], 'rooms:start');
      assert.equal(events[1], 'favorites:start');
      assert.ok(elapsedMs < 75, `Expected concurrent execution <75ms, got ${elapsedMs.toFixed(1)}ms`);

      // Only user-hosted rooms are kept
      assert.equal(result.recentRooms.length, 1);
      assert.equal(result.recentRooms[0].id, 'room-1');
      assert.equal(result.favorites.length, 1);
      assert.equal(result.favorites[0].videoId, 'dQw4w9WgXcQ');

      // Empty userId fast-path
      events.length = 0;
      const empty = await fetchDashboardData('');
      assert.deepEqual(empty, { recentRooms: [], favorites: [] });
      assert.equal(events.length, 0);
    } finally {
      roomService.getUserRooms = origGetUserRooms;
      favoriteService.getFavorites = origGetFavorites;
    }
  });

  it('3. RootLayout seeds SessionProvider from server verified claims without /auth/v1/user calls', () => {
    const layoutCode = fs.readFileSync(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf-8'
    );
    const serverCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/supabase/server.ts'),
      'utf-8'
    );
    const sessionCode = fs.readFileSync(
      path.join(process.cwd(), 'src/context/SessionContext.tsx'),
      'utf-8'
    );

    assert.match(layoutCode, /export default async function RootLayout/);
    assert.match(layoutCode, /getServerInitialSession\(\)/);
    assert.match(layoutCode, /initialUser=\{initialUser\}/);
    assert.match(layoutCode, /isServerInitialized=\{isServerInitialized\}/);

    const serverInitSlice = serverCode.slice(serverCode.indexOf('getServerInitialSession'));
    assert.match(serverInitSlice, /hasSupabaseAuthCookie\(/);
    assert.match(serverInitSlice, /getVerifiedAuthClaims\(/);
    assert.doesNotMatch(serverInitSlice, /\.auth\.getUser\(/);

    assert.match(sessionCode, /isServerInitialized/);
    assert.match(sessionCode, /useCallback\(\(\) => seedUser/);
  });

  it('4. Dashboard & Room initialization remove client waterfalls and parallelize Realtime auth + chat history', () => {
    const homeCode = fs.readFileSync(
      path.join(process.cwd(), 'src/app/page.tsx'),
      'utf-8'
    );
    const roomPageCode = fs.readFileSync(
      path.join(process.cwd(), 'src/app/room/[code]/page.tsx'),
      'utf-8'
    );
    const useRoomCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useRoom.ts'),
      'utf-8'
    );
    const useChatCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useChat.ts'),
      'utf-8'
    );
    const chatContainerCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/chat/ChatContainer.tsx'),
      'utf-8'
    );
    const roomViewCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );

    assert.match(homeCode, /fetchDashboardData\(/);
    assert.match(roomPageCode, /Promise\.all\(\[\s*params,\s*searchParams,?\s*\]\)/);

    assert.match(useRoomCode, /realtimeAuthPromiseRef/);
    assert.match(useRoomCode, /roomService\s*\n?\s*\.getChatMessages\(\s*resolvedRoom\.id/);
    assert.match(useRoomCode, /initialChatHistory/);

    assert.match(roomViewCode, /initialHistory=\{initialChatHistory\}/);
    assert.match(chatContainerCode, /initialHistory\?:\s*InitialChatHistory/);
    assert.match(useChatCode, /usesPrefetchedHistory/);
    assert.match(useChatCode, /if \(!roomId \|\| usesPrefetchedHistory\) return;/);
  });
});
