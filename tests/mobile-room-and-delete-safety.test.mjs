import { describe, it, afterEach } from 'node:test';
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

const { copyTextToClipboard, shareOrCopyInvite } = jiti(
  path.join(process.cwd(), 'src/lib/utils/share.ts')
);
const {
  resolveLoadingStage,
  CREATE_ROOM_BUTTON_STAGES,
  JOIN_ROOM_BUTTON_STAGES,
  ROOM_CREATE_SCREEN_STAGES,
  ROOM_ENTER_SCREEN_STAGES,
} = jiti(path.join(process.cwd(), 'src/hooks/useLoadingStages.ts'));

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

function restoreGlobals() {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: originalDocument,
    configurable: true,
    writable: true,
  });
}

describe('Mobile share, clipboard fallback & safe delete event handling', () => {
  afterEach(() => {
    restoreGlobals();
  });

  it('copyTextToClipboard uses navigator.clipboard in secure contexts', async () => {
    let copied = '';
    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: true },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText: async (text) => {
            copied = text;
          },
        },
      },
      configurable: true,
      writable: true,
    });

    const ok = await copyTextToClipboard('https://syncora.app/room/SYNC-1234');
    assert.equal(ok, true);
    assert.equal(copied, 'https://syncora.app/room/SYNC-1234');
  });

  it('copyTextToClipboard falls back to textarea execCommand on non-HTTPS mobile browsers', async () => {
    const appended = [];
    const removed = [];
    let execCalledWith = '';

    const fakeTextarea = {
      value: '',
      style: {},
      parentNode: null,
      setAttribute() {},
      focus() {},
      select() {},
      setSelectionRange() {},
    };

    const fakeBody = {
      appendChild(node) {
        node.parentNode = fakeBody;
        appended.push(node);
      },
      removeChild(node) {
        node.parentNode = null;
        removed.push(node);
      },
    };

    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: false },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: {
        body: fakeBody,
        createElement: () => fakeTextarea,
        execCommand: (cmd) => {
          execCalledWith = cmd;
          return true;
        },
      },
      configurable: true,
      writable: true,
    });

    const ok = await copyTextToClipboard('http://192.168.1.10:3000/room/SYNC-AB12');
    assert.equal(ok, true);
    assert.equal(execCalledWith, 'copy');
    assert.equal(fakeTextarea.value, 'http://192.168.1.10:3000/room/SYNC-AB12');
    assert.equal(appended.length, 1);
    assert.equal(removed.length, 1);
  });

  it('shareOrCopyInvite supports Web Share API, ignores user AbortError, and copies otherwise', async () => {
    let sharedPayload = null;
    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: true },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: async (payload) => {
          sharedPayload = payload;
        },
      },
      configurable: true,
      writable: true,
    });

    const shared = await shareOrCopyInvite({
      roomTitle: 'Friday Screening',
      roomCode: 'SYNC-9999',
      url: 'https://syncora.app/room/SYNC-9999',
    });
    assert.equal(shared, 'shared');
    assert.equal(sharedPayload.url, 'https://syncora.app/room/SYNC-9999');

    // User cancelled share sheet -> should return 'cancelled', not overwrite clipboard
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: async () => {
          throw new DOMException('Share cancelled', 'AbortError');
        },
      },
      configurable: true,
      writable: true,
    });
    const cancelled = await shareOrCopyInvite({
      roomTitle: 'Friday Screening',
      roomCode: 'SYNC-9999',
      url: 'https://syncora.app/room/SYNC-9999',
    });
    assert.equal(cancelled, 'cancelled');

    // No Web Share API -> falls back to clipboard
    let fallbackCopied = '';
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText: async (text) => {
            fallbackCopied = text;
          },
        },
      },
      configurable: true,
      writable: true,
    });
    const copied = await shareOrCopyInvite({
      roomTitle: 'Friday Screening',
      roomCode: 'SYNC-9999',
      url: 'https://syncora.app/room/SYNC-9999',
    });
    assert.equal(copied, 'copied');
    assert.equal(fallbackCopied, 'https://syncora.app/room/SYNC-9999');
  });

  it('RoomHeader and Navbar are structured cleanly for narrow mobile viewports', () => {
    const roomHeaderSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomHeader.tsx'),
      'utf8'
    );
    const navbarSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/common/Navbar.tsx'),
      'utf8'
    );
    const roomViewSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf8'
    );

    // Single compact mobile bar + desktop toolbar
    assert.match(roomHeaderSrc, /flex md:hidden items-center justify-between/);
    assert.match(roomHeaderSrc, /hidden md:flex min-h-14/);
    // Mobile bar includes native share/invite + overflow menu with Clear Leave & Members actions
    assert.match(roomHeaderSrc, /handleShareInvite/);
    assert.match(roomHeaderSrc, /aria-label="Room actions menu"/);
    assert.match(roomHeaderSrc, /Share Invite Link/);
    assert.match(roomHeaderSrc, /Close & Leave Room/);
    // RoomHeader + RoomParticipantsModal use share/clipboard helper instead of raw navigator.clipboard
    assert.ok(!roomHeaderSrc.includes('navigator.clipboard.writeText'));
    assert.match(roomHeaderSrc, /copyTextToClipboard/);

    const participantsSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomParticipantsModal.tsx'),
      'utf8'
    );
    assert.ok(!participantsSrc.includes('navigator.clipboard.writeText'));
    assert.match(participantsSrc, /copyTextToClipboard/);

    // Compact mobile navbar matches RoomView viewport height cleanly and hides Lounge badge inside mobile rooms
    assert.match(navbarSrc, /h-14 sm:h-16/);
    assert.match(navbarSrc, /isRoomRoute \? 'hidden sm:inline-flex' : 'inline-flex'/);
    assert.match(roomViewSrc, /h-\[calc\(100dvh-3\.5rem\)\] sm:h-\[calc\(100dvh-4rem\)\]/);
  });

  it('resolveLoadingStage adapts spinner and loading page messages for normal vs slow networks', () => {
    assert.equal(resolveLoadingStage(0, CREATE_ROOM_BUTTON_STAGES).stage.label, 'Creating…');
    assert.equal(resolveLoadingStage(1000, CREATE_ROOM_BUTTON_STAGES).stage.label, 'Entering…');
    assert.equal(resolveLoadingStage(4300, CREATE_ROOM_BUTTON_STAGES).stage.label, 'Almost done…');
    assert.equal(resolveLoadingStage(8000, CREATE_ROOM_BUTTON_STAGES).stage.label, 'Slow network…');

    assert.equal(resolveLoadingStage(0, JOIN_ROOM_BUTTON_STAGES).stage.label, 'Finding…');
    assert.equal(resolveLoadingStage(1000, JOIN_ROOM_BUTTON_STAGES).stage.label, 'Entering…');
    assert.equal(resolveLoadingStage(4500, JOIN_ROOM_BUTTON_STAGES).stage.label, 'Almost done…');

    assert.equal(resolveLoadingStage(0, ROOM_CREATE_SCREEN_STAGES).stage.label, 'Creating space…');
    assert.equal(resolveLoadingStage(2600, ROOM_CREATE_SCREEN_STAGES).stage.label, 'Almost done…');
    assert.equal(resolveLoadingStage(0, ROOM_ENTER_SCREEN_STAGES).stage.label, 'Entering room…');
    assert.equal(resolveLoadingStage(5000, ROOM_ENTER_SCREEN_STAGES).stage.label, 'Slow network…');

    const homeSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const roomViewSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf8'
    );
    const roomPageSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/app/room/[code]/page.tsx'),
      'utf8'
    );
    const roomLoadingSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/app/room/[code]/loading.tsx'),
      'utf8'
    );
    assert.match(homeSrc, /useLoadingStages\(/);
    assert.match(roomViewSrc, /<RoomLoadingState\s+mode=/);
    assert.match(roomPageSrc, /<RoomLoadingState\s+mode=/);
    assert.match(roomLoadingSrc, /<RoomLoadingState\s+mode=/);
  });

  it('RecentRoomsSection and FavoritesSection isolate delete buttons from navigation and form submits', () => {
    const recentSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RecentRoomsSection.tsx'),
      'utf8'
    );
    const favSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/FavoritesSection.tsx'),
      'utf8'
    );
    const buttonSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ui/Button.tsx'),
      'utf8'
    );

    // Button defaults to type="button" so no stray form submissions happen
    assert.match(buttonSrc, /type = 'button'/);

    // RecentRoomsSection must NOT wrap the delete button inside an <article onClick=...>
    assert.ok(!/<article[^>]*onClick=/.test(recentSrc));
    assert.match(recentSrc, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
    assert.match(recentSrc, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
    assert.match(recentSrc, /if \(isNavigating \|\| deletingRoomId !== null\) return;/);

    assert.match(favSrc, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
    assert.match(favSrc, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});
