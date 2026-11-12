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

const { CALL_CONSTANTS } = jiti(
  path.join(process.cwd(), 'src/lib/constants/sync.constants.ts')
);
const { CallSignaling } = jiti(
  path.join(process.cwd(), 'src/core/call/CallSignaling.ts')
);

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';
const USER_C = '44444444-4444-4444-8444-444444444444';
const SESS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESS_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function createMockRealtimeBus() {
  const topics = new Map();
  const removed = [];

  const transport = {
    async setAuth() {},
    createPrivateChannel(topic) {
      const handlers = new Map();
      const ch = {
        topic,
        on(_type, filter, cb) {
          handlers.set(filter.event, cb);
          return ch;
        },
        async send({ event, payload }) {
          const subs = topics.get(topic) || [];
          for (const sub of subs) {
            const fn = sub.handlers.get(event);
            if (fn) fn({ payload });
          }
          return 'ok';
        },
        subscribe(cb) {
          const list = topics.get(topic) || [];
          list.push({ ch, handlers });
          topics.set(topic, list);
          queueMicrotask(() => cb?.('SUBSCRIBED'));
          return ch;
        },
      };
      return ch;
    },
    removeChannel(ch) {
      removed.push(ch.topic);
      const list = topics.get(ch.topic) || [];
      topics.set(
        ch.topic,
        list.filter((item) => item.ch !== ch)
      );
    },
  };

  return { transport, topics, removed };
}

describe('Phase 12 — 4-Way Mesh Voice Calls & Video Auto-Ducking', () => {
  it('1. CALL_CONSTANTS allows up to 4 participants matching room capacity', () => {
    assert.equal(CALL_CONSTANTS.MAX_CALL_PARTICIPANTS, 4);
  });

  it('2. CallSignaling syncPeers supports simultaneous multi-peer subscriptions and selective removal', async () => {
    const bus = createMockRealtimeBus();
    const receivedByA = [];
    const subscribedForA = [];

    const sigA = new CallSignaling({
      roomId: ROOM_ID,
      selfUserId: USER_A,
      callSessionId: SESS_A,
      transport: bus.transport,
      onSignal: (signal, fromUserId) => receivedByA.push({ fromUserId, signal }),
      onPeerSubscribed: (peerId) => subscribedForA.push(peerId),
    });

    const sigB = new CallSignaling({
      roomId: ROOM_ID,
      selfUserId: USER_B,
      callSessionId: SESS_B,
      transport: bus.transport,
      onSignal: () => {},
    });

    const sigC = new CallSignaling({
      roomId: ROOM_ID,
      selfUserId: USER_C,
      callSessionId: SESS_C,
      transport: bus.transport,
      onSignal: () => {},
    });

    await Promise.all([sigA.connectOutbox(), sigB.connectOutbox(), sigC.connectOutbox()]);

    await sigA.syncPeers([
      { userId: USER_B, callSessionId: SESS_B },
      { userId: USER_C, callSessionId: SESS_C },
    ]);
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(subscribedForA.sort(), [USER_B, USER_C].sort());

    sigB.sendMediaState(USER_A, { isMuted: true });
    sigC.sendMediaState(USER_A, { isMuted: false });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(receivedByA.length, 2);
    assert.equal(receivedByA.find((m) => m.fromUserId === USER_B)?.signal.mediaState.isMuted, true);
    assert.equal(receivedByA.find((m) => m.fromUserId === USER_C)?.signal.mediaState.isMuted, false);

    // Removing USER_B keeps USER_C active
    await sigA.syncPeers([{ userId: USER_C, callSessionId: SESS_C }]);
    assert.ok(bus.removed.includes(`call:${ROOM_ID}:${USER_B}`));

    sigB.sendMediaState(USER_A, { isMuted: false });
    sigC.sendMediaState(USER_A, { isMuted: true });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(receivedByA.length, 3);
    assert.equal(receivedByA[2].fromUserId, USER_C);
    assert.equal(receivedByA[2].signal.mediaState.isMuted, true);

    sigA.destroy();
    sigB.destroy();
    sigC.destroy();
  });

  it('3. UniversalPlayer and RoomView implement voice auto-ducking and toggle control', () => {
    const universalPlayerCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/player/UniversalPlayer.tsx'),
      'utf-8'
    );
    const roomViewCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );
    const useCallCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useCall.ts'),
      'utf-8'
    );

    assert.match(universalPlayerCode, /isInVoiceCall/);
    assert.match(universalPlayerCode, /isVoiceAutoDuckEnabled/);
    assert.match(universalPlayerCode, /isVoiceSpeaking/);
    assert.match(universalPlayerCode, /duckFactor/);
    assert.match(roomViewCode, /isVoiceAutoDuckEnabled/);
    assert.match(roomViewCode, /onToggleAutoDuck/);
    assert.match(useCallCode, /peerManagersRef/);
    assert.match(useCallCode, /syncPeers\(/);
  });

  it('4. Host leaving voice ends the call server-side (009 & full_setup.sql) and client-side for all peers', () => {
    const migration009Sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/009_host_leave_ends_voice_call.sql'),
      'utf-8'
    );
    const fullSetupSql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/full_setup.sql'),
      'utf-8'
    );
    const useCallCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useCall.ts'),
      'utf-8'
    );
    const roomViewCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );
    const voiceCallBarCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/call/VoiceCallBar.tsx'),
      'utf-8'
    );
    const roomHeaderCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomHeader.tsx'),
      'utf-8'
    );

    for (const sql of [migration009Sql, fullSetupSql]) {
      assert.match(sql, /IF public\.is_room_host\(p_room_id, v_uid\) THEN\s+DELETE FROM public\.room_call_participants rcp\s+WHERE rcp\.room_id = p_room_id;/);
      assert.match(sql, /IF public\.is_room_host\(OLD\.room_id, OLD\.user_id\) THEN\s+DELETE FROM public\.room_call_participants\s+WHERE room_id = OLD\.room_id;/);
      assert.match(sql, /v_host_expired/);
    }

    assert.match(useCallCode, /hostId\?: string;/);
    assert.match(useCallCode, /byeReason = isHostCaller \? 'host-ended' : 'left'/);
    assert.match(useCallCode, /signal\.reason === 'host-ended'/);
    assert.match(useCallCode, /Host ended the voice call\./);
    assert.match(useCallCode, /callEndedNotice/);
    assert.match(useCallCode, /clearCallEndedNotice/);

    assert.match(roomViewCode, /hostId:\s*room\?\.hostId/);
    assert.match(roomViewCode, /callEndedNotice:\s*voiceCall\.callEndedNotice/);
    assert.match(voiceCallBarCode, /callEndedNotice/);
    assert.match(voiceCallBarCode, /End voice call for everyone/);
    assert.match(roomHeaderCode, /End voice call for everyone/);
    assert.match(roomHeaderCode, /Media \/ URL/);
    assert.match(roomHeaderCode, /Voice Call/);
  });

  it('5. CallSignaling purges stale channels on rejoin and auto-recovers from transient socket closed: 1006', async () => {
    let subscribeCb = null;
    let cleanedTopics = [];
    const errors = [];
    let recovered = 0;

    const transport = {
      async setAuth() {},
      async cleanupStaleChannel(topic) {
        cleanedTopics.push(topic);
      },
      createPrivateChannel() {
        const ch = {
          on() {
            return ch;
          },
          async send() {
            return 'ok';
          },
          subscribe(cb) {
            subscribeCb = cb;
            queueMicrotask(() => cb?.('SUBSCRIBED'));
            return ch;
          },
        };
        return ch;
      },
      removeChannel() {},
    };

    const sig = new CallSignaling({
      roomId: ROOM_ID,
      selfUserId: USER_A,
      callSessionId: SESS_A,
      transport,
      onSignal: () => {},
      onRecover: () => {
        recovered += 1;
      },
      onError: (msg) => {
        errors.push(msg);
      },
    });

    await sig.connectOutbox();
    assert.deepEqual(cleanedTopics, [`call:${ROOM_ID}:${USER_A}`]);

    // Simulate transient socket close followed quickly by Phoenix reconnect -> zero noisy error flash
    subscribeCb?.('CHANNEL_ERROR', new Error('socket closed: 1006'));
    await new Promise((r) => setTimeout(r, 20));
    subscribeCb?.('SUBSCRIBED');
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(errors.length, 0);
    assert.equal(recovered, 1);

    sig.destroy();
  });
});

