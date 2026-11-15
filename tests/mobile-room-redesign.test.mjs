import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Mobile Room Redesign — Responsive UX & Chat Prioritization', () => {
  const roomHeaderSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/room/RoomHeader.tsx'),
    'utf-8'
  );
  const roomViewSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
    'utf-8'
  );
  const chatContainerSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/chat/ChatContainer.tsx'),
    'utf-8'
  );
  const callToolbarSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/call/CallActionsToolbar.tsx'),
    'utf-8'
  );
  const visualViewportHookSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/hooks/useVisualViewport.ts'),
    'utf-8'
  );

  it('1. Header: Removes Chat button from top bar, eliminates overlapping controls, keeps room info & participants accessible', () => {
    // In mobile header, Chat button is removed
    const mobileHeaderSection = roomHeaderSrc.slice(
      roomHeaderSrc.indexOf('Redesigned Mobile Room Header Bar'),
      roomHeaderSrc.indexOf('Desktop Screening Header Bar')
    );
    assert.doesNotMatch(
      mobileHeaderSection,
      /<button[^>]*>[^<]*Chat[^<]*<\/button>/i,
      'Mobile top toolbar must not render a Chat button'
    );
    assert.doesNotMatch(
      mobileHeaderSection,
      /renderVoiceControls\(true\)/,
      'Mobile top toolbar must not cram voice controls into the header'
    );

    // Clean groups: Back arrow + Room Title + Room Code, Link pill, Participants count pill, MoreVertical menu (no repeating Syncora BrandMark)
    assert.match(mobileHeaderSection, /ArrowLeft/);
    assert.doesNotMatch(
      mobileHeaderSection,
      /BrandMark/,
      'Mobile room header must not repeat Syncora BrandMark below global Navbar'
    );
    assert.match(mobileHeaderSection, /room\.title/);
    assert.match(mobileHeaderSection, /room\.code/);
    assert.match(mobileHeaderSection, /handleShareInvite/);
    assert.match(mobileHeaderSection, /totalOnline/);
    assert.match(mobileHeaderSection, /MoreVertical/);
    assert.match(mobileHeaderSection, /aria-label="Room actions menu"/);
    assert.match(mobileHeaderSection, /Share Invite Link/);
    assert.match(mobileHeaderSection, /Close & Leave Room/);
  });

  it('2. Notifications: Distinguishes room joins below header from call joins in call interface with deduplication', () => {
    // Room join banner below header
    assert.match(roomViewSrc, /joined the room/);
    assert.match(roomViewSrc, /roomJoinNotice/);
    assert.match(roomViewSrc, /recentRoomJoinNoticesRef/);
    assert.match(roomViewSrc, /Join Call/);

    // Call join notice inside call interface
    assert.match(roomViewSrc, /callJoinNotice/);
    assert.match(roomViewSrc, /recentCallJoinNoticesRef/);
    assert.match(callToolbarSrc, /joined the voice call/);
    assert.match(callToolbarSrc, /callJoinNotice/);
  });

  it('3. Media and Call Controls: Dedicated responsive toolbar for mic, camera, screen share, participants, and call action', () => {
    assert.match(callToolbarSrc, /CallActionsToolbar/);
    assert.match(callToolbarSrc, /onToggleMute/);
    assert.match(callToolbarSrc, /MicOff/);
    assert.match(callToolbarSrc, /Video/);
    assert.match(callToolbarSrc, /ScreenShare/);
    assert.match(callToolbarSrc, /Users/);
    assert.match(callToolbarSrc, /PhoneOff/);
    assert.match(callToolbarSrc, /PhoneCall/);

    // Compact & space-optimized touch targets (w-9 h-9 sm:w-9.5 sm:h-9.5 = 36px-38px)
    assert.match(callToolbarSrc, /w-9 h-9 sm:w-9\.5 sm:h-9\.5 rounded-full/);
  });

  it('4. Chat — Highest Priority: Gives chat remaining vertical space, pinned composer, visualViewport, scroll-back pill', () => {
    // ChatContainer uses full flex space and independently scrolls
    assert.match(chatContainerSrc, /overflow-y-auto overscroll-contain touch-pan-y/);
    assert.match(chatContainerSrc, /flex-1 min-h-0/);
    assert.match(chatContainerSrc, /h-full min-h-0 flex-1/);

    // Composer pinned with safe-area insets and 16px text size to prevent mobile auto-zoom
    assert.match(chatContainerSrc, /env\(safe-area-inset-bottom\)/);
    assert.match(chatContainerSrc, /text-base sm:text-sm/);

    // Auto-scroll guard when reading older messages
    assert.match(chatContainerSrc, /isScrolledUp/);
    assert.match(chatContainerSrc, /distanceFromBottom > 60/);
    assert.match(chatContainerSrc, /Latest messages|new (?:message|messages) ↓/);

    // Visual viewport hook handles keyboard resizing and Android Chrome/iOS Safari insets
    assert.match(visualViewportHookSrc, /window\.visualViewport/);
    assert.match(visualViewportHookSrc, /isKeyboardOpen/);
    assert.match(visualViewportHookSrc, /viewportHeight/);
    assert.match(roomViewSrc, /useVisualViewport/);
  });

  it('5. Segmented Navigation Tabs: Seamless 1-tap switching between Chat, Queue, and Participants on mobile', () => {
    assert.match(roomViewSrc, /mobileTab === 'chat'/);
    assert.match(roomViewSrc, /mobileTab === 'queue'/);
    assert.match(roomViewSrc, /mobileTab === 'participants'/);
    assert.match(roomViewSrc, /Queue ·/);
    assert.match(roomViewSrc, /Participants ·/);
  });

  it('6. Smooth Drawer Transitions & Flash Elimination: Drawers use smooth enter/exit animations and chat is never abruptly hidden', () => {
    const queuePanelSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomQueuePanel.tsx'),
      'utf-8'
    );
    const participantsModalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomParticipantsModal.tsx'),
      'utf-8'
    );
    const changeVideoModalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/ChangeVideoModal.tsx'),
      'utf-8'
    );
    const globalsCssSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/app/globals.css'),
      'utf-8'
    );

    // Drawers use useDrawerTransition for smooth exit animations
    assert.match(queuePanelSrc, /useDrawerTransition/);
    assert.match(queuePanelSrc, /drawer-exit/);
    assert.match(participantsModalSrc, /useDrawerTransition/);
    assert.match(participantsModalSrc, /drawer-exit/);
    assert.match(changeVideoModalSrc, /useDrawerTransition/);
    assert.match(changeVideoModalSrc, /drawer-exit/);

    // Global CSS defines smooth enter and exit keyframes
    assert.match(globalsCssSrc, /drawerSlideRight/);
    assert.match(globalsCssSrc, /drawerSlideRightExit/);
    assert.match(globalsCssSrc, /drawer-enter/);
    assert.match(globalsCssSrc, /drawer-exit/);

    // Chat in RoomView is NOT abruptly hidden with display:none when drawers open
    assert.doesNotMatch(
      roomViewSrc,
      /isAnyDrawerOpen && 'lg:hidden'/,
      'Chat must not be abruptly hidden with display:none when drawers open to avoid flashing'
    );
  });

  it('7. Watch Queue Cross Button, Chat Scroll-to-Top Stability, & Mobile Permissions Toggles', () => {
    const queuePanelSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomQueuePanel.tsx'),
      'utf-8'
    );
    const updatedRoomViewSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/room/RoomView.tsx'),
      'utf-8'
    );
    const updatedChatContainerSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/chat/ChatContainer.tsx'),
      'utf-8'
    );

    // 1. Queue Drawer has prominent 36px close button with pointer-events and Escape key handler
    assert.match(queuePanelSrc, /aria-label="Close watch queue"/);
    assert.match(queuePanelSrc, /handleKeyDown = \(e: KeyboardEvent\)/);
    assert.match(queuePanelSrc, /e\.key === 'Escape'/);
    assert.match(queuePanelSrc, /h-9 w-9 shrink-0 items-center justify-center rounded-xl/);

    // 2. Chat Container prevents scroll interruptions when reading older/top messages
    assert.match(updatedChatContainerSrc, /isScrolledUpRef/);
    assert.match(updatedChatContainerSrc, /hasInitializedScrollRef/);
    assert.match(updatedChatContainerSrc, /!isScrolledUpRef\.current \|\| isMyMessage/);

    // 3. Mobile Participants tab includes Shared Playback Controls and Voice Call Initiation toggles
    assert.match(updatedRoomViewSrc, /Shared Playback Controls/);
    assert.match(updatedRoomViewSrc, /Voice Call Initiation/);
    assert.match(updatedRoomViewSrc, /toggleGuestControl/);
    assert.match(updatedRoomViewSrc, /toggleGuestCall/);
    assert.match(updatedRoomViewSrc, /handleMobileCopyLink/);
  });
});
