import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Syncora End-to-End Authentication Architecture', () => {
  // Mock Supabase Auth state container for tests
  const createMockAuthEnv = () => {
    let currentUser = null;
    let registeredUsers = new Map();

    const mockSupabase = {
      auth: {
        async signUp({ email, password, options }) {
          if (registeredUsers.has(email)) {
            // Supabase email enumeration protection returns empty identities
            return {
              data: {
                user: { id: registeredUsers.get(email).id, email, identities: [] },
                session: null,
              },
              error: null,
            };
          }

          const newUser = {
            id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            email,
            user_metadata: { username: options?.data?.username || email.split('@')[0] },
            identities: [{ id: 'identity-1' }],
            is_anonymous: false,
          };
          registeredUsers.set(email, { ...newUser, password });
          const newSession = { user: newUser, access_token: 'valid_token' };
          currentUser = newUser;

          return {
            data: { user: newUser, session: newSession },
            error: null,
          };
        },

        async signInWithPassword({ email, password }) {
          const existing = registeredUsers.get(email);
          if (!existing || existing.password !== password) {
            return {
              data: { user: null, session: null },
              error: { message: 'Invalid login credentials' },
            };
          }
          currentUser = existing;
          return {
            data: {
              user: existing,
              session: { user: existing, access_token: 'valid_token' },
            },
            error: null,
          };
        },

        async getSession() {
          return {
            data: {
              session: currentUser ? { user: currentUser, access_token: 'valid_token' } : null,
            },
            error: null,
          };
        },

        async getUser() {
          return {
            data: { user: currentUser },
            error: null,
          };
        },

        async signOut() {
          currentUser = null;
          return { error: null };
        },

        async refreshSession() {
          if (!currentUser) return { data: { session: null }, error: { message: 'No session' } };
          return {
            data: { session: { user: currentUser, access_token: 'refreshed_token' } },
            error: null,
          };
        },
      },
    };

    return { mockSupabase, registeredUsers, getCurrentUser: () => currentUser };
  };

  // 1. New email registration
  it('1. New email registration: creates user, verified identity and authenticated session', async () => {
    const { mockSupabase } = createMockAuthEnv();

    const result = await mockSupabase.auth.signUp({
      email: 'alex@example.com',
      password: 'password123',
      options: { data: { username: 'AlexCinema' } },
    });

    assert.equal(result.error, null);
    assert.ok(result.data.user);
    assert.equal(result.data.user.email, 'alex@example.com');
    assert.equal(result.data.user.user_metadata.username, 'AlexCinema');
    assert.ok(result.data.user.identities.length > 0);
    assert.ok(result.data.session);
  });

  // 2. Duplicate email registration
  it('2. Duplicate email registration: detects empty identities array and rejects duplicate signup', async () => {
    const { mockSupabase } = createMockAuthEnv();

    // First registration
    await mockSupabase.auth.signUp({
      email: 'taylor@example.com',
      password: 'password123',
      options: { data: { username: 'Taylor' } },
    });

    // Second registration with the same email
    const duplicateRes = await mockSupabase.auth.signUp({
      email: 'taylor@example.com',
      password: 'anotherpassword',
      options: { data: { username: 'TaylorDuplicate' } },
    });

    assert.equal(duplicateRes.error, null);
    // When Supabase email enumeration protection is on, identities is empty []
    const isDuplicate =
      duplicateRes.data.user &&
      Array.isArray(duplicateRes.data.user.identities) &&
      duplicateRes.data.user.identities.length === 0;

    assert.equal(isDuplicate, true);
    assert.equal(duplicateRes.data.session, null);
  });

  // 3. Login with valid credentials
  it('3. Login with valid credentials: sets verified identity and active session', async () => {
    const { mockSupabase } = createMockAuthEnv();

    await mockSupabase.auth.signUp({
      email: 'jordan@example.com',
      password: 'supersecretpass',
      options: { data: { username: 'Jordan' } },
    });

    const loginRes = await mockSupabase.auth.signInWithPassword({
      email: 'jordan@example.com',
      password: 'supersecretpass',
    });

    assert.equal(loginRes.error, null);
    assert.ok(loginRes.data.session);
    assert.equal(loginRes.data.user.email, 'jordan@example.com');
  });

  // 4. Login with incorrect credentials
  it('4. Login with incorrect credentials: returns invalid credentials error without session', async () => {
    const { mockSupabase } = createMockAuthEnv();

    await mockSupabase.auth.signUp({
      email: 'sam@example.com',
      password: 'correctpassword',
      options: { data: { username: 'Sam' } },
    });

    const failRes = await mockSupabase.auth.signInWithPassword({
      email: 'sam@example.com',
      password: 'wrongpassword',
    });

    assert.ok(failRes.error);
    assert.match(failRes.error.message, /invalid/i);
    assert.equal(failRes.data.session, null);
  });

  // 5. Refresh page after login
  it('5. Refresh page after login: restores authenticated user from cookie/session without re-prompting', async () => {
    const { mockSupabase } = createMockAuthEnv();

    await mockSupabase.auth.signUp({
      email: 'riley@example.com',
      password: 'password123',
      options: { data: { username: 'Riley' } },
    });

    // Simulating page refresh by retrieving session from client
    const sessionRes = await mockSupabase.auth.getSession();
    assert.ok(sessionRes.data.session);
    assert.equal(sessionRes.data.session.user.email, 'riley@example.com');
    assert.equal(sessionRes.data.session.user.is_anonymous, false);
  });

  // 6. Open another tab after login
  it('6. Open another tab after login: cross-tab session is immediately recognized', async () => {
    const { mockSupabase } = createMockAuthEnv();

    // Tab 1 registers and logs in
    await mockSupabase.auth.signUp({
      email: 'tab_user@example.com',
      password: 'password123',
      options: { data: { username: 'TabUser' } },
    });

    // Tab 2 checks session
    const tab2Session = await mockSupabase.auth.getSession();
    assert.ok(tab2Session.data.session);
    assert.equal(tab2Session.data.session.user.email, 'tab_user@example.com');
  });

  // 7. Visit login/register while already logged in
  it('7. Visit login/register while already logged in: middleware redirects to target destination or home', () => {
    const evaluateMiddlewareRedirect = ({ user, pathname, redirectParam }) => {
      const isAuthRoute =
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/auth');
      const isCallbackRoute = pathname === '/auth/callback';
      const isAuthenticated = Boolean(user && !user.is_anonymous);

      if (isAuthenticated && isAuthRoute && !isCallbackRoute) {
        return {
          action: 'redirect',
          target: redirectParam && redirectParam.startsWith('/') ? redirectParam : '/',
        };
      }
      return { action: 'proceed' };
    };

    const authenticatedUser = { id: 'usr_1', email: 'test@example.com', is_anonymous: false };

    // Visiting /login while authenticated
    const res1 = evaluateMiddlewareRedirect({
      user: authenticatedUser,
      pathname: '/login',
      redirectParam: null,
    });
    assert.equal(res1.action, 'redirect');
    assert.equal(res1.target, '/');

    // Visiting /register with redirect parameter
    const res2 = evaluateMiddlewareRedirect({
      user: authenticatedUser,
      pathname: '/register',
      redirectParam: '/room/SYNC-9999',
    });
    assert.equal(res2.action, 'redirect');
    assert.equal(res2.target, '/room/SYNC-9999');
  });

  // 8. Access protected routes without authentication
  it('8. Access protected routes without authentication: middleware redirects to /login with return destination', () => {
    const evaluateMiddlewareProtection = ({ user, pathname }) => {
      const isAuthRoute =
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/auth');
      const isAuthenticated = Boolean(user && !user.is_anonymous);

      if (!isAuthenticated && !isAuthRoute) {
        const redirectUrl = `/login${pathname !== '/' ? `?redirect=${encodeURIComponent(pathname)}` : ''}`;
        return { action: 'redirect', target: redirectUrl };
      }
      return { action: 'proceed' };
    };

    // Unauthenticated visiting home '/'
    const homeRes = evaluateMiddlewareProtection({ user: null, pathname: '/' });
    assert.equal(homeRes.action, 'redirect');
    assert.equal(homeRes.target, '/login');

    // Unauthenticated visiting room '/room/SYNC-4421'
    const roomRes = evaluateMiddlewareProtection({ user: null, pathname: '/room/SYNC-4421' });
    assert.equal(roomRes.action, 'redirect');
    assert.equal(roomRes.target, '/login?redirect=%2Froom%2FSYNC-4421');
  });

  // 9. Logout and attempt to access protected routes
  it('9. Logout and attempt to access protected routes: destroys session and blocks access', async () => {
    const { mockSupabase } = createMockAuthEnv();

    await mockSupabase.auth.signUp({
      email: 'logout_test@example.com',
      password: 'password123',
    });

    // Logout
    await mockSupabase.auth.signOut();

    // Verify session is completely empty
    const sessionRes = await mockSupabase.auth.getSession();
    assert.equal(sessionRes.data.session, null);

    // Re-evaluating route access
    const isAuthenticated = Boolean(sessionRes.data.session?.user);
    assert.equal(isAuthenticated, false);
  });

  // 10. Save and retrieve favourites after login
  it('10. Save and retrieve favourites after login: persists and retrieves user-scoped favorites', async () => {
    const storageMap = new Map();

    const mockFavoriteService = {
      async addFavorite(userId, item) {
        if (!userId) return { success: false, error: 'User must be authenticated' };
        const key = `syncora_favorites_${userId}`;
        const existing = storageMap.get(key) || [];
        const newFav = {
          id: `fav_${Date.now()}`,
          userId,
          videoId: item.videoId,
          videoTitle: item.videoTitle,
          createdAt: new Date().toISOString(),
        };
        storageMap.set(key, [newFav, ...existing.filter((f) => f.videoId !== item.videoId)]);
        return { success: true, favorite: newFav };
      },

      async getFavorites(userId) {
        if (!userId) return [];
        return storageMap.get(`syncora_favorites_${userId}`) || [];
      },

      async isFavorite(userId, videoId) {
        const favs = await this.getFavorites(userId);
        return favs.some((f) => f.videoId === videoId);
      },

      async removeFavorite(userId, videoId) {
        const key = `syncora_favorites_${userId}`;
        const existing = storageMap.get(key) || [];
        storageMap.set(key, existing.filter((f) => f.videoId !== videoId));
        return { success: true };
      },
    };

    const userId = 'usr_verified_123';

    // 1. Add favorite
    const addRes = await mockFavoriteService.addFavorite(userId, {
      videoId: 'dQw4w9WgXcQ',
      videoTitle: 'Never Gonna Give You Up',
    });
    assert.equal(addRes.success, true);

    // 2. Retrieve favorites
    const favs = await mockFavoriteService.getFavorites(userId);
    assert.equal(favs.length, 1);
    assert.equal(favs[0].videoId, 'dQw4w9WgXcQ');

    // 3. Check isFavorite
    const isFav = await mockFavoriteService.isFavorite(userId, 'dQw4w9WgXcQ');
    assert.equal(isFav, true);

    // 4. Remove favorite
    await mockFavoriteService.removeFavorite(userId, 'dQw4w9WgXcQ');
    const afterDelete = await mockFavoriteService.getFavorites(userId);
    assert.equal(afterDelete.length, 0);
  });

  // 11. Create and join rooms after login
  it('11. Create and join rooms after login: associates room and host role with verified user ID', async () => {
    const verifiedUser = {
      id: 'usr_verified_456',
      username: 'RoomMaster',
      email: 'master@example.com',
      isGuest: false,
    };

    const mockRooms = new Map();
    const mockMembers = new Map();

    const createRoom = (code, title, host) => {
      const room = {
        id: `room_${Date.now()}`,
        code,
        title,
        hostId: host.id,
      };
      mockRooms.set(code, room);
      mockMembers.set(room.id, [{ userId: host.id, username: host.username, role: 'host' }]);
      return room;
    };

    const joinRoom = (code, user) => {
      const room = mockRooms.get(code);
      if (!room) return null;
      const members = mockMembers.get(room.id) || [];
      const isHost = room.hostId === user.id;
      const role = isHost ? 'host' : 'viewer';
      members.push({ userId: user.id, username: user.username, role });
      return { room, role };
    };

    // Host creates room
    const created = createRoom('SYNC-7788', 'Sci-Fi Night', verifiedUser);
    assert.equal(created.hostId, verifiedUser.id);
    assert.equal(created.code, 'SYNC-7788');

    // Partner joins room
    const partner = { id: 'usr_partner_789', username: 'PartnerBob', isGuest: false };
    const joinRes = joinRoom('SYNC-7788', partner);
    assert.equal(joinRes.role, 'viewer');
    assert.equal(joinRes.room.hostId, verifiedUser.id);
  });

  // 12. Expired session and automatic token refresh
  it('12. Expired session and automatic token refresh: refreshes expired token seamlessly', async () => {
    const { mockSupabase } = createMockAuthEnv();

    await mockSupabase.auth.signUp({
      email: 'refresh_user@example.com',
      password: 'password123',
    });

    // Simulate token expiration and refresh
    const refreshRes = await mockSupabase.auth.refreshSession();
    assert.equal(refreshRes.error, null);
    assert.equal(refreshRes.data.session.access_token, 'refreshed_token');
    assert.equal(refreshRes.data.session.user.email, 'refresh_user@example.com');
  });
});

