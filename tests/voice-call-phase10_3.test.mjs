import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.join(process.cwd(), 'src'),
  },
});

const { validateCallSignalEnvelope, SignalRateLimiter } = jiti(
  path.join(process.cwd(), 'src/core/call/callSignalValidation.ts')
);
const { CallSignaling } = jiti(
  path.join(process.cwd(), 'src/core/call/CallSignaling.ts')
);
const { PeerConnectionManager } = jiti(
  path.join(process.cwd(), 'src/core/call/PeerConnectionManager.ts')
);

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';
const SESS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const VALID_AUDIO_SDP = [
  'v=0',
  'o=- 12345 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:supersecreticepassword1234',
  'a=fingerprint:sha-256 AA:BB:CC:DD',
  'a=rtpmap:111 opus/48000/2',
].join('\r\n');

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

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.signalingState = 'stable';
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.addedIce = [];
    this.senders = [];
    this.transceiversStopped = 0;
    this.closed = false;
    this.iceRestartCalls = 0;
    this.statsReport = new Map();
    this.onnegotiationneeded = null;
    this.onicecandidate = null;
    this.ontrack = null;
    this.oniceconnectionstatechange = null;
    this.onconnectionstatechange = null;
    this.onsignalingstatechange = null;
  }

  addTrack(track) {
    const sender = {
      track,
      async replaceTrack(next) {
        sender.track = next;
      },
    };
    this.senders.push(sender);
    return sender;
  }

  setConfiguration(cfg) {
    this.config = cfg;
  }

  async createOffer(opts = {}) {
    return {
      type: 'offer',
      sdp: `${VALID_AUDIO_SDP}\r\n${opts.iceRestart ? 'a=ice-restart:1' : ''}`.trim(),
    };
  }

  async createAnswer() {
    return {
      type: 'answer',
      sdp: VALID_AUDIO_SDP,
    };
  }

  async setLocalDescription(desc) {
    if (desc?.type === 'rollback') {
      this.signalingState = 'stable';
      this.localDescription = null;
      this.onsignalingstatechange?.();
      return;
    }
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    this.onsignalingstatechange?.();
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.onsignalingstatechange?.();
  }

  async addIceCandidate(cand) {
    if (!this.remoteDescription) {
      throw new Error('InvalidStateError: remoteDescription is null');
    }
    this.addedIce.push(cand);
  }

  restartIce() {
    this.iceRestartCalls += 1;
  }

  getTransceivers() {
    return [
      {
        stop: () => {
          this.transceiversStopped += 1;
        },
      },
    ];
  }

  async getStats() {
    return this.statsReport;
  }

  close() {
    this.closed = true;
    this.signalingState = 'closed';
  }
}

describe('Phase 10.3 — Core 2-Person WebRTC Engine', () => {
  it('1. Validates audio-only SDP, ICE candidates, targetUserId, roomId, and session IDs strictly', () => {
    const ctx = {
      roomId: ROOM_ID,
      selfUserId: USER_A,
      expectedPeerUserId: USER_B,
      expectedPeerSessionId: SESS_B,
    };

    const okOffer = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'offer',
        sdp: { type: 'offer', sdp: VALID_AUDIO_SDP },
      },
      ctx
    );
    assert.equal(okOffer.valid, true);

    // Reject video m=line injection
    const videoSdp = `${VALID_AUDIO_SDP}\r\nm=video 9 UDP/TLS/RTP/SAVPF 96`;
    const badVideo = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'offer',
        sdp: { type: 'offer', sdp: videoSdp },
      },
      ctx
    );
    assert.equal(badVideo.valid, false);
    assert.match(badVideo.reason, /Non-audio media/);

    // Reject wrong targetUserId
    const badTarget = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_B,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'bye',
      },
      ctx
    );
    assert.equal(badTarget.valid, false);

    // Reject stale peer callSessionId
    const staleSession = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_A,
        sentAt: Date.now(),
        event: 'bye',
      },
      ctx
    );
    assert.equal(staleSession.valid, false);

    // Accept empty end-of-candidates ICE string, reject malformed ICE prefix
    const endOfCands = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'ice',
        candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null },
      },
      ctx
    );
    assert.equal(endOfCands.valid, true);

    const badIce = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'ice',
        candidate: { candidate: 'evil:123', sdpMid: '0', sdpMLineIndex: 0 },
      },
      ctx
    );
    assert.equal(badIce.valid, false);

    // Reject oversized SDP (> 16KB)
    const hugeSdp = `${VALID_AUDIO_SDP}\r\na=ext:${'x'.repeat(17000)}`;
    const tooBig = validateCallSignalEnvelope(
      {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'answer',
        sdp: { type: 'answer', sdp: hugeSdp },
      },
      ctx
    );
    assert.equal(tooBig.valid, false);
  });

  it('2. SignalRateLimiter caps burst signaling and recovers after window expires', () => {
    const limiter = new SignalRateLimiter(3, 1000);
    assert.equal(limiter.allow(1000), true);
    assert.equal(limiter.allow(1100), true);
    assert.equal(limiter.allow(1200), true);
    assert.equal(limiter.allow(1300), false);
    assert.equal(limiter.allow(2050), true);
  });

  it('3. CallSignaling buffers early sends, isolates peer outboxes, drops spoofed payloads, and cleans up', async () => {
    const { transport, removed } = createMockRealtimeBus();
    const receivedByB = [];

    const sigA = new CallSignaling({
      roomId: ROOM_ID,
      selfUserId: USER_A,
      callSessionId: SESS_A,
      transport,
      onSignal: () => {},
    });
    const sigB = new CallSignaling({
      roomId: ROOM_ID,
      selfUserId: USER_B,
      callSessionId: SESS_B,
      transport,
      onSignal: (signal, fromUserId) => {
        receivedByB.push({ signal, fromUserId });
      },
    });

    await sigB.connectOutbox();
    await sigB.setPeer(USER_A, SESS_A);

    // Queue offer before sigA connects outbox -> flushed automatically on SUBSCRIBED
    sigA.sendOffer(USER_B, { type: 'offer', sdp: VALID_AUDIO_SDP });
    await sigA.connectOutbox();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(receivedByB.length, 1);
    assert.equal(receivedByB[0].fromUserId, USER_A);
    assert.equal(receivedByB[0].signal.event, 'offer');

    // Inject malformed / video payload directly onto A's topic -> must be dropped by B
    const rawTopicA = transport.createPrivateChannel(`call:${ROOM_ID}:${USER_A}`);
    await rawTopicA.send({
      type: 'broadcast',
      event: 'CALL_SIGNAL',
      payload: {
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_B,
        callSessionId: SESS_A,
        sentAt: Date.now(),
        event: 'offer',
        sdp: { type: 'offer', sdp: `${VALID_AUDIO_SDP}\r\nm=video 9 UDP/TLS/RTP/SAVPF 96` },
      },
    });
    assert.equal(receivedByB.length, 1);

    sigA.destroy();
    sigB.destroy();
    assert.ok(removed.includes(`call:${ROOM_ID}:${USER_A}`));
    assert.ok(removed.includes(`call:${ROOM_ID}:${USER_B}`));
  });

  it('4. PeerConnectionManager resolves simultaneous offer collisions via Perfect Negotiation and buffers early ICE', async () => {
    let pcA;
    let pcB;
    const signalsToA = [];
    const signalsToB = [];

    const mgrA = new PeerConnectionManager({
      selfUserId: USER_A,
      peerUserId: USER_B,
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      createPeerConnection: (cfg) => {
        pcA = new MockRTCPeerConnection(cfg);
        return pcA;
      },
      callbacks: {
        onOffer: (sdp) => signalsToB.push({ event: 'offer', sdp }),
        onAnswer: (sdp) => signalsToB.push({ event: 'answer', sdp }),
        onIceCandidate: () => {},
        onRemoteStream: () => {},
        onStatusChange: () => {},
      },
    });

    const mgrB = new PeerConnectionManager({
      selfUserId: USER_B,
      peerUserId: USER_A,
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      createPeerConnection: (cfg) => {
        pcB = new MockRTCPeerConnection(cfg);
        return pcB;
      },
      callbacks: {
        onOffer: (sdp) => signalsToA.push({ event: 'offer', sdp }),
        onAnswer: (sdp) => signalsToA.push({ event: 'answer', sdp }),
        onIceCandidate: () => {},
        onRemoteStream: () => {},
        onStatusChange: () => {},
      },
    });

    // Deterministic tie-breaker: USER_A < USER_B => A is polite, B is impolite
    assert.equal(mgrA.isPolite(), true);
    assert.equal(mgrB.isPolite(), false);

    // Early ICE arrives at A before remoteDescription is set -> must buffer, not throw
    await mgrA.handleSignal({
      version: 1,
      roomId: ROOM_ID,
      targetUserId: USER_A,
      callSessionId: SESS_B,
      sentAt: Date.now(),
      event: 'ice',
      candidate: { candidate: 'candidate:1 1 UDP 2122 1.2.3.4 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    });
    assert.equal(pcA.addedIce.length, 0);

    // Both create offers simultaneously (glare)
    await Promise.all([mgrA.createAndSendOffer(), mgrB.createAndSendOffer()]);
    assert.equal(pcA.signalingState, 'have-local-offer');
    assert.equal(pcB.signalingState, 'have-local-offer');

    // Deliver colliding offers simultaneously
    await Promise.all([
      mgrA.handleSignal({
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_A,
        callSessionId: SESS_B,
        sentAt: Date.now(),
        event: 'offer',
        sdp: signalsToA[0].sdp,
      }),
      mgrB.handleSignal({
        version: 1,
        roomId: ROOM_ID,
        targetUserId: USER_B,
        callSessionId: SESS_A,
        sentAt: Date.now(),
        event: 'offer',
        sdp: signalsToB[0].sdp,
      }),
    ]);

    // Buffered early ICE on A was flushed once remoteDescription arrived
    assert.equal(pcA.addedIce.length, 1);

    // Polite A emitted an answer; impolite B ignored A's offer and stayed in have-local-offer
    const answerForB = signalsToB.find((s) => s.event === 'answer');
    assert.ok(answerForB, 'Polite peer must emit answer after rolling back collision');
    assert.equal(pcB.signalingState, 'have-local-offer');

    await mgrB.handleSignal({
      version: 1,
      roomId: ROOM_ID,
      targetUserId: USER_B,
      callSessionId: SESS_A,
      sentAt: Date.now(),
      event: 'answer',
      sdp: answerForB.sdp,
    });

    assert.equal(pcB.signalingState, 'stable');

    mgrA.destroy();
    mgrB.destroy();
    assert.equal(pcA.closed, true);
    assert.equal(pcA.transceiversStopped, 1);
  });

  it('5. PeerConnectionManager detects relayed vs p2p stats and triggers ICE restart on failure', async () => {
    let pc;
    const statuses = [];
    const modes = [];
    const offers = [];

    const mgr = new PeerConnectionManager({
      selfUserId: USER_A,
      peerUserId: USER_B,
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      createPeerConnection: (cfg) => {
        pc = new MockRTCPeerConnection(cfg);
        return pc;
      },
      callbacks: {
        onOffer: (sdp) => offers.push(sdp),
        onAnswer: () => {},
        onIceCandidate: () => {},
        onRemoteStream: () => {},
        onStatusChange: (s) => statuses.push(s),
        onConnectionModeChange: (m) => modes.push(m),
      },
    });

    pc.statsReport = new Map([
      [
        'pair-1',
        {
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          localCandidateId: 'loc-1',
          remoteCandidateId: 'rem-1',
        },
      ],
      ['loc-1', { id: 'loc-1', type: 'local-candidate', candidateType: 'relay' }],
      ['rem-1', { id: 'rem-1', type: 'remote-candidate', candidateType: 'srflx' }],
    ]);

    pc.iceConnectionState = 'connected';
    pc.oniceconnectionstatechange?.();
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(statuses.includes('connected'));
    assert.ok(modes.includes('relayed'));

    // Simulate ICE failure -> immediate backoff=0ms restart attempt
    pc.iceConnectionState = 'failed';
    pc.oniceconnectionstatechange?.();
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(statuses.includes('reconnecting'));
    assert.equal(pc.iceRestartCalls, 1);
    assert.ok(offers.some((o) => o.sdp.includes('a=ice-restart:1')));

    mgr.destroy();
  });
});

