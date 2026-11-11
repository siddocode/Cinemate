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

const { subscribeToRoomCallSlots, emitRoomCallSlotChange } = jiti(
  path.join(process.cwd(), 'src/lib/supabase/roomRealtimeBus.ts')
);

describe('Phase 10.4 — useCall Hook & Luxury Cinema Voice UI', () => {
  it('1. roomRealtimeBus dispatches room_call_participants changes and unsubscribes cleanly', () => {
    const received = [];
    const roomId = '11111111-1111-4111-8111-111111111111';

    const unsub = subscribeToRoomCallSlots(roomId, (change) => {
      received.push(change);
    });

    emitRoomCallSlotChange(roomId, {
      eventType: 'INSERT',
      newRow: {
        room_id: roomId,
        user_id: '22222222-2222-4222-8222-222222222222',
        call_session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        joined_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      },
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].eventType, 'INSERT');

    unsub();

    emitRoomCallSlotChange(roomId, {
      eventType: 'DELETE',
      oldRow: { user_id: '22222222-2222-4222-8222-222222222222' },
    });

    assert.equal(received.length, 1);
  });

  it('2. useRoom registers room_call_participants postgres_changes before subscribe()', () => {
    const useRoomCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useRoom.ts'),
      'utf-8'
    );

    const callSlotsIndex = useRoomCode.indexOf("table: 'room_call_participants'");
    const subscribeIndex = useRoomCode.indexOf('roomChannel.subscribe(');

    assert.ok(callSlotsIndex !== -1, 'useRoom must subscribe to room_call_participants');
    assert.ok(subscribeIndex !== -1, 'useRoom must call roomChannel.subscribe()');
    assert.ok(
      callSlotsIndex < subscribeIndex,
      'room_call_participants postgres_changes listener must be registered before subscribe()'
    );
  });

  it('3. useCall acquires audio-only mic before reserving slot, supports beacon leave, and resolves verified usernames', () => {
    const useCallCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useCall.ts'),
      'utf-8'
    );

    const gumIndex = useCallCode.indexOf('getUserMedia(');
    const rpcJoinIndex = useCallCode.indexOf("rpc('join_room_call'");
    assert.ok(gumIndex !== -1 && rpcJoinIndex !== -1);
    assert.ok(
      gumIndex < rpcJoinIndex,
      'Microphone access must run before reserving a server call slot so denied prompts never occupy slots'
    );

    assert.match(useCallCode, /video:\s*false/);
    assert.match(useCallCode, /echoCancellation:\s*true/);
    assert.match(useCallCode, /noiseSuppression:\s*true/);
    assert.match(useCallCode, /autoGainControl:\s*true/);
    assert.match(useCallCode, /navigator\.sendBeacon\(/);
    assert.match(useCallCode, /call\/ice-servers/);
    assert.match(useCallCode, /call\/leave/);
    assert.match(useCallCode, /heartbeat_room_call/);
    assert.match(useCallCode, /leave_room_call/);
    assert.match(useCallCode, /presenceList\.find/);
    assert.match(useCallCode, /members\.find/);
  });

  it('4. RoomView mounts voice audio independently of UniversalPlayer and UI remains voice-only without obstructing playback', () => {
    const roomViewCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );
    const roomHeaderCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomHeader.tsx'),
      'utf-8'
    );
    const voiceCallBarCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/call/VoiceCallBar.tsx'),
      'utf-8'
    );
    const universalPlayerCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/player/UniversalPlayer.tsx'),
      'utf-8'
    );

    assert.match(roomViewCode, /useCall\(/);
    assert.match(roomViewCode, /<audio\s+ref=\{voiceAudioRef\}/);
    assert.ok(
      !/\buseCall\b/.test(universalPlayerCode),
      'UniversalPlayer must not own call lifecycle so video changes never drop voice calls'
    );

    assert.ok(
      !voiceCallBarCode.includes('<video'),
      'VoiceCallBar must remain strictly voice-only with zero video elements'
    );
    assert.match(voiceCallBarCode, /is on voice/);
    assert.match(voiceCallBarCode, /Voice Full 2\/2/);
    assert.match(voiceCallBarCode, /Tap to enable partner audio/);
    assert.match(voiceCallBarCode, /STUN-only Dev/);
    assert.match(roomHeaderCode, /Join Voice/);
    assert.match(roomHeaderCode, /Voice 2\/2/);
  });
});

