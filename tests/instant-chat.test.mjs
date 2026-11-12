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

const {
  ChatPersistenceError,
  generateChatMessageId,
  isRetryableChatError,
  syncParticipantNameCache,
  resolveCachedSenderName,
  isValidChatBroadcastPayload,
  upsertChatMessage,
  mergeChatHistory,
} = jiti(path.join(process.cwd(), 'src/lib/utils/chat.ts'));

const { subscribeToRoomChatBroadcasts, emitRoomChatBroadcast } = jiti(
  path.join(process.cwd(), 'src/lib/supabase/roomRealtimeBus.ts')
);

describe('Optimization 1 — Instant Chat', () => {
  it('1. Generates valid unique UUIDv4 message IDs without collisions', () => {
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids = new Set();
    for (let i = 0; i < 500; i += 1) {
      const id = generateChatMessageId();
      assert.match(id, uuidV4Regex);
      ids.add(id);
    }
    assert.equal(ids.size, 500);
  });

  it('2. Deduplicates Broadcast + Postgres Changes events by message ID without redundant re-renders', () => {
    const id1 = generateChatMessageId();
    const broadcastMsg = {
      id: id1,
      roomId: 'room-1',
      userId: 'user-2',
      username: 'Avery',
      content: 'Hello instant chat!',
      type: 'chat',
      createdAt: '2026-11-12T10:00:00.000Z',
      status: 'sent',
    };

    const afterBroadcast = upsertChatMessage([], broadcastMsg);
    assert.equal(afterBroadcast.length, 1);
    assert.equal(afterBroadcast[0].status, 'sent');

    // Subsequent Postgres Changes INSERT for the exact same ID must be a no-op reference
    const afterPgInsert = upsertChatMessage(afterBroadcast, {
      ...broadcastMsg,
      createdAt: '2026-11-12T10:00:00.250Z',
    });
    assert.strictEqual(afterPgInsert, afterBroadcast);
    assert.equal(afterPgInsert.length, 1);

    // Sender optimistic 'sending' transitions cleanly to 'sent' when confirmed
    const id2 = generateChatMessageId();
    const afterOptimistic = upsertChatMessage(afterPgInsert, {
      id: id2,
      roomId: 'room-1',
      userId: 'user-1',
      username: 'Host',
      content: 'Popcorn ready',
      type: 'chat',
      createdAt: '2026-11-12T10:00:01.000Z',
      status: 'sending',
    });
    assert.equal(afterOptimistic.length, 2);
    assert.equal(afterOptimistic[1].status, 'sending');

    const afterConfirmed = upsertChatMessage(afterOptimistic, {
      id: id2,
      roomId: 'room-1',
      userId: 'user-1',
      username: 'Host',
      content: 'Popcorn ready',
      type: 'chat',
      createdAt: '2026-11-12T10:00:01.100Z',
      status: 'sent',
    });
    assert.equal(afterConfirmed.length, 2);
    assert.equal(afterConfirmed[1].status, 'sent');
  });

  it('3. Merges initial chat history without clobbering in-flight broadcast/optimistic messages', () => {
    const history = [
      {
        id: 'hist-1',
        roomId: 'room-1',
        userId: 'user-2',
        username: 'Avery',
        content: 'Earlier message',
        type: 'chat',
        createdAt: '2026-11-12T09:59:00.000Z',
      },
    ];
    const inMemory = [
      {
        id: 'welcome-msg',
        roomId: 'room-1',
        userId: 'system',
        username: 'Syncora',
        content: 'Welcome',
        type: 'system',
        createdAt: '2026-11-12T09:59:30.000Z',
      },
      {
        id: 'hist-1',
        roomId: 'room-1',
        userId: 'user-2',
        username: 'Avery',
        content: 'Earlier message',
        type: 'chat',
        createdAt: '2026-11-12T09:59:00.000Z',
      },
      {
        id: 'live-2',
        roomId: 'room-1',
        userId: 'user-1',
        username: 'Host',
        content: 'Sent while history loading',
        type: 'chat',
        createdAt: '2026-11-12T10:00:00.000Z',
        status: 'sending',
      },
    ];

    const merged = mergeChatHistory(history, inMemory);
    assert.equal(merged.length, 2);
    assert.deepEqual(
      merged.map((m) => m.id),
      ['hist-1', 'live-2']
    );
  });

  it('4. Resolves sender names from cached members and presence without DB lookups', () => {
    const cache = new Map();
    syncParticipantNameCache(cache, {
      self: { id: 'u1', username: 'Sid' },
      members: [
        {
          id: 'm1',
          roomId: 'r1',
          userId: 'u2',
          username: 'Mira',
          role: 'viewer',
          joinedAt: '2026-11-12T10:00:00.000Z',
          lastSeenAt: '2026-11-12T10:00:00.000Z',
        },
      ],
      presenceList: [
        {
          userId: 'u3',
          username: 'Rohan',
          role: 'co-host',
          clientState: 'ready',
          joinedAt: 1000,
        },
      ],
    });

    assert.equal(resolveCachedSenderName(cache, 'u1'), 'Sid');
    assert.equal(resolveCachedSenderName(cache, 'u2'), 'Mira');
    assert.equal(resolveCachedSenderName(cache, 'u3'), 'Rohan');
    assert.equal(resolveCachedSenderName(cache, 'u4'), 'Viewer');
    assert.equal(resolveCachedSenderName(cache, 'u4', 'Guest'), 'Guest');
    assert.equal(cache.has('u4'), false);
    assert.equal(resolveCachedSenderName(cache, 'u4', 'Tara'), 'Tara');
    assert.equal(cache.get('u4'), 'Tara');
  });

  it('5. Validates CHAT_MESSAGE broadcast payloads strictly', () => {
    const valid = {
      id: generateChatMessageId(),
      roomId: 'room-abc',
      userId: 'user-1',
      username: 'Sid',
      content: 'Great scene!',
      type: 'chat',
      createdAt: '2026-11-12T10:00:00.000Z',
    };
    assert.equal(isValidChatBroadcastPayload(valid, 'room-abc'), true);
    assert.equal(isValidChatBroadcastPayload(valid, 'room-other'), false);
    assert.equal(isValidChatBroadcastPayload({ ...valid, content: '' }, 'room-abc'), false);
    assert.equal(
      isValidChatBroadcastPayload({ ...valid, content: 'a'.repeat(1001) }, 'room-abc'),
      false
    );
    assert.equal(isValidChatBroadcastPayload({ ...valid, type: 'admin' }, 'room-abc'), false);
  });

  it('6. Classifies persistence errors and dispatches CHAT_MESSAGE via roomRealtimeBus', () => {
    assert.equal(isRetryableChatError({ code: '42501', message: 'row-level security' }), false);
    assert.equal(
      isRetryableChatError({ message: 'Chat rate limit exceeded. Please wait.' }),
      false
    );
    assert.equal(isRetryableChatError({ code: '503', message: 'Service Unavailable' }), true);
    const err = new ChatPersistenceError('Network timeout', true);
    assert.equal(err.retryable, true);

    const received = [];
    const unsub = subscribeToRoomChatBroadcasts('room-bus', (payload) => {
      received.push(payload);
    });
    const payload = {
      id: generateChatMessageId(),
      roomId: 'room-bus',
      userId: 'user-1',
      username: 'Sid',
      content: 'Instant bus delivery',
      type: 'chat',
      createdAt: '2026-11-12T10:00:00.000Z',
    };
    emitRoomChatBroadcast('room-bus', payload);
    assert.equal(received.length, 1);
    assert.equal(received[0].id, payload.id);

    unsub();
    emitRoomChatBroadcast('room-bus', payload);
    assert.equal(received.length, 1);
  });

  it('7. Wiring check: useRoom registers CHAT_MESSAGE before subscribe, useChat broadcasts before DB, ChatContainer renders retry UI', () => {
    const useRoomCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useRoom.ts'),
      'utf-8'
    );
    const useChatCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useChat.ts'),
      'utf-8'
    );
    const roomServiceCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/services/roomService.ts'),
      'utf-8'
    );
    const chatContainerCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/chat/ChatContainer.tsx'),
      'utf-8'
    );

    const chatBroadcastIdx = useRoomCode.indexOf("event: 'CHAT_MESSAGE'");
    const subscribeIdx = useRoomCode.indexOf('roomChannel.subscribe(');
    assert.ok(chatBroadcastIdx !== -1 && chatBroadcastIdx < subscribeIdx);

    assert.match(useChatCode, /broadcastChatMessage\(/);
    assert.match(useChatCode, /persistMessageWithRetry\(/);
    assert.match(useChatCode, /retryMessage/);
    assert.doesNotMatch(
      useChatCode,
      /handleIncomingRow[\s\S]*?from\('profiles'\)/,
      'handleIncomingRow must not perform per-message profile lookups'
    );

    assert.match(roomServiceCode, /23505/);
    assert.doesNotMatch(
      roomServiceCode,
      /sendChatMessage[\s\S]*?\.select\('\*, profiles\(username\)'\)/,
      'sendChatMessage must not join profiles on every insert'
    );

    assert.match(chatContainerCode, /retryMessage/);
    assert.match(chatContainerCode, /Failed to save/);
  });
});
