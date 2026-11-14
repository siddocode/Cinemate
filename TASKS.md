# TASKS.md — Syncora Phase-Wise Implementation Checklist

## Phase 1 — Planning and Architecture
- [x] Workspace inspection (verified clean workspace).
- [x] Define product requirements, user flows, and system scope (`PROJECT.md`).
- [x] Design host-authoritative playback synchronization engine & drift reconciliation algorithm (`ARCHITECTURE.md`).
- [x] Design PostgreSQL database schema, indexes, and Row-Level Security (RLS) policies (`ARCHITECTURE.md`).
- [x] Define Realtime strategy (Broadcast for playback, Presence for viewers, Postgres for durable data) (`ARCHITECTURE.md`).
- [x] Define video provider adapter architecture (`IVideoPlayerAdapter`) (`ARCHITECTURE.md`).
- [x] Establish architectural decisions and tradeoffs (`DECISIONS.md`).
- [x] Establish persistent documentation and agent guidelines (`AGENTS.md`).
- [x] Set up Antigravity reusable workflows (`.agents/workflows/`).
- [ ] Present architecture and essential questions to user for review and sign-off.

---

## Phase 2 — Project Foundation
- [x] Initialize Next.js 16 (App Router), TypeScript, and Tailwind CSS v4.
- [x] Establish strict TypeScript configuration and path aliases (`@/*`).
- [x] Install and configure core dependencies (`@supabase/supabase-js`, `@supabase/ssr`, `lucide-react`, `clsx`, `tailwind-merge`).
- [x] Create Supabase browser client, server client, and middleware helpers.
- [x] Configure environment variable schema and create clean `.env.example`.
- [x] Build responsive base layout (Navbar, Footer, Cinema Theme, Session Provider).
- [x] Implement initial Duo watch party landing page & Room Skeleton View (Side-by-Side Theater layout).
- [x] Verify lint (`npm run lint`), TypeScript checks, and Next.js production build (`npm run build`).

---

## Phase 3 — User Sessions and Rooms
- [x] Implement frictionless Guest Session Provider (`SessionContext` / `useSession`) generating persistent guest UUID and display name in cookies/localStorage.
- [x] Design Auth interface (`AuthUser`, `SessionState`) so adding Supabase Auth later requires zero changes to consumer components.
- [x] Create Database Migration script for PostgreSQL (`profiles`, `rooms`, `room_members`, `chat_messages` + RLS) in `supabase/migrations/001_initial_schema.sql`.
- [x] Implement Room Creation UI and Service with unique room code generation (e.g. `SYNC-XXXX`).
- [x] Implement Room Joining flow via room code input and direct invitation link (`/room/[code]`).
- [x] Implement Room Membership, Host authorization checks, and Duo Presence status.
- [x] Implement Host Grace Period (30s) and Auto-Failover logic to oldest active participant.
- [x] Build Room Header, Partner Status Card, and Change Video Modal.
- [x] Verify TypeScript typecheck, zero-warning ESLint, and Next.js build.

---

## Phase 4 — Video Playback and Synchronization
- [x] Define `IVideoPlayerAdapter` interface and event emitter contracts.
- [x] Build `YouTubePlayerAdapter` wrapping the official YouTube IFrame Player API.
- [x] Implement dynamic YouTube player script loader and initialization lifecycle.
- [x] Build `UniversalPlayer` presentational component with custom controls overlay (Host controls + Viewer sync overlay).
- [x] Implement `SyncEngine` with host-authoritative broadcast publisher and subscriber.
- [x] Implement timestamp projection and tiered drift compensation (deadband, rate nudging, hard seek).
- [x] Implement loop prevention flag (`isRemoteSyncing`) for programmatic updates.
- [x] Connect `UniversalPlayer` and `useSyncEngine` to `RoomView`.
- [x] Verify TypeScript typecheck, zero-warning ESLint, and Next.js build.

---

## Phase 5 — Realtime Experience
- [x] Build Real-Time Chat using Supabase Realtime Postgres Changes on `chat_messages` with optimistic local rendering.
- [x] Implement system messages (welcome, video updates, host transitions).
- [x] Implement Participant Presence and typing indicators (`CHAT_TYPING` broadcast).
- [x] Display viewer status badges (Host, Partner Online/Waiting, In-Sync indicator).
- [x] Implement Host Controls (video URL switching modal, host reassignment).
- [x] Implement Reconnection & Synchronization Recovery (tab visibility and presence re-synchronization).
- [x] Add sound chime notification using Web Audio API on partner messages.
- [x] Add 1-click Quick Emoji reaction bar (`❤️`, `🍿`, `😂`, `😮`, etc.).
- [x] Verify TypeScript typecheck, zero-warning ESLint, and Next.js build.

---

## Phase 6 — Personal Video Support
- [x] Implement `HTML5VideoAdapter` conforming to `IVideoPlayerAdapter`.
- [x] Support direct video streaming URLs (MP4, WebM, HLS).
- [x] Configure Supabase Storage service (`storageService.ts`) with strict 50MB file size limits and MIME validation.
- [x] Implement drag-and-drop video upload component with progress indicators in `ChangeVideoModal`.
- [x] Support seamless switching between YouTube, direct URLs, and uploaded personal videos inside an active room.
- [x] Verify TypeScript typecheck, zero-warning ESLint, and Next.js build.

---

## Phase 7 — Testing, Security and Deployment
- [x] Multi-user stress and latency simulation tests across multiple devices.
- [x] Test mobile browsers (iOS Safari, Android Chrome) for autoplay and muted playback requirements.
- [x] Audit RLS security policies and server endpoints against unauthorized room/chat tampering (zero secret leaks verified).
- [x] Optimize bundle size, dynamic imports for player adapters, and Lighthouse performance.
- [x] Prepare production environment configuration and deployment guide for Vercel in `DEPLOYMENT.md`.
- [x] Perform final end-to-end verification and handoff documentation.

---

## Phase 8 — End-to-End Authentication Architecture & Favourites
- [x] Perform complete root-cause audit of authentication issues, route protection, and session persistence.
- [x] Create Next.js root proxy (`src/proxy.ts`, migrated from `src/middleware.ts` per Next.js 16 convention) and enhance `updateSession()` in `src/lib/supabase/middleware.ts`.
- [x] Protect all private routes (`/`, `/room/*`) and redirect unauthenticated users to `/login?redirect=...`.
- [x] Implement authenticated route redirects: redirect authenticated users visiting `/login`, `/register`, or `/auth` to `/` (or target destination).
- [x] Create Auth Callback Route (`src/app/auth/callback/route.ts`) for `@supabase/ssr` code exchange and cookie restoration.
- [x] Fix registration duplicate email handling (`user.identities.length === 0`) and email verification status.
- [x] Fix login state restoration and eliminate stale "Sign in or register to save favourites" prompt when authenticated.
- [x] Eliminate obsolete anonymous guest auto-login and localStorage UUID spoofing.
- [x] Build user-scoped Favorites architecture (`favoriteService.ts`, `FavoritesSection.tsx`, `RoomHeader.tsx`, `user_favorites` table in `supabase/full_setup.sql`).
- [x] Create automated end-to-end test suite (`tests/auth-flow.test.mjs`) covering all 12 requested scenarios.
- [x] Fix PostgreSQL error 42P17 (infinite recursion in `room_members` RLS policy) by decoupling recursive subqueries with `SECURITY DEFINER` helper functions (`is_room_member`, `is_room_host`, `is_room_host_or_cohost`) across `rooms`, `room_members`, `chat_messages`, and `storage.objects`. Created migration `004_fix_rls_recursion.sql` and updated `supabase/full_setup.sql`.
- [x] Fix PostgreSQL error 23505 (`rooms_code_key` duplicate key on room creation) caused by React Strict Mode & session listener re-executions: added in-flight deduplication (`getOrCreateRoom`) and `23505` recovery in `roomService.ts`, stabilized `SessionContext.tsx` initialization/listeners, and keyed `useRoom.ts` on `[roomCode, user.id, isInitialized]`.
- [x] Fix Supabase Realtime `cannot add postgres_changes callbacks after subscribe()` crash in `useChat.ts` / `useRoom.ts`: attached `chat_messages` `postgres_changes` on the unified channel before `.subscribe()`, added `src/lib/supabase/roomRealtimeBus.ts`, prevented channel teardown on room metadata updates in `useRoom.ts`, and guarded `SyncEngine` destroyed callbacks.
- [x] Fix multi-user YouTube playback & sync for joining viewers: ordered `joinRoom()` before Realtime channel subscription in `useRoom.ts`, added `VIDEO_CHANGE` broadcast + partner-arrival video sync, added DB snapshot persistence + `REQUEST_SYNC` retries + paused heartbeats in `SyncEngine.ts`, fixed `YouTubePlayerAdapter` async seek & Strict Mode races, and implemented muted-autoplay fallback + unmute/unblock prompts in `UniversalPlayer.tsx`.
- [x] Verify production build (`npm run build`) and ESLint (`npm run lint`) exit with 0 errors and 0 warnings.

---

## Phase 9 — Luxury Digital Cinema UI/UX Redesign
- [x] Establish Forest Green (`#173D30`), Deep Forest (`#102B23`), Sand Beige (`#E8DDC5`), Muted Sand (`#CDBF9F`), Electric Purple (`#9670FF`), and Warm White (`#F7F4EC`) design tokens and Google Fonts (`Cormorant Garamond`, `Plus Jakarta Sans`, `JetBrains Mono`) in `globals.css` and `layout.tsx`.
- [x] Redesign UI primitives (`Button`, `Input`, `Badge`, `Card`, `Modal` with `createPortal`).
- [x] Redesign navigation, footer, shared `BrandMark`, `AuthFormContent`, `AuthModal`, and `/login` / `/register` / `/auth` split cinema lobby.
- [x] Redesign landing page (`src/app/page.tsx`) and `FavoritesSection` with loading skeleton and empty state.
- [x] Redesign watch room (`RoomView`, `RoomHeader`, `UniversalPlayer`, `ChatContainer`, `ChangeVideoModal`, `RoomSkeletonView`, `room/[code]/page.tsx`).
- [x] Verify TypeScript (`npx tsc --noEmit`), ESLint (`npm run lint`), automated tests (`npm test`), production build (`npm run build`), and responsive desktop/tablet/mobile rendering.
- [x] Update `CURRENT_STATE.md` and `TASKS.md`.

---

## Phase 10 — Two-Person Voice Calling
### Phase 10.1 — Security Foundation (Realtime & Membership Hardening)
- [x] Add `realtime.messages` RLS policies (`syncora_room_members_can_receive`, `syncora_room_members_can_send`) and `can_access_room_topic()` in `005_realtime_authorization_and_membership_hardening.sql` and `full_setup.sql`.
- [x] Drop legacy `002` `realtime.messages` policies lacking extension and strict topic checks.
- [x] Enforce 4-member watch-room limit server-side with `pg_advisory_xact_lock` in `enforce_room_member_capacity()`.
- [x] Prevent `room_members` role/room_id escalation via `guard_room_member_update()` and fix stale `host` role derivation in `is_room_host_or_cohost()`.
- [x] Revoke `anon`/`PUBLIC` execution on internal helper/lookup RPCs.
- [x] Switch `useRoom.ts` (`room:<id>`) and `useChat.ts` (`room_chat:<id>`) to `{ config: { private: true } }` with `supabase.realtime.setAuth()` before `.subscribe()`.
- [x] Add Phase 10.1 regression tests in `tests/security-audit.test.mjs` and verify against PGlite Postgres + TypeScript + ESLint + Next.js build.

### Phase 10.2 — Call Authorization, 2-Person Slots & TURN API Route
- [x] Add `room_call_participants` table, atomic `join_room_call` / `heartbeat_room_call` / `leave_room_call` RPCs, and member-leave trigger in `006_voice_call_authorization.sql` and `full_setup.sql`.
- [x] Add `realtime.messages` RLS policies (`syncora_call_members_can_receive`, `syncora_call_members_can_send`) for `call:<room>:<sender>` and `callroster:<room>`.
- [x] Add `call_credential_requests` table + `check_and_record_call_credential_request` rate-limiting RPC and revoke `PUBLIC`/`anon` privileges.
- [x] Implement server-only `src/lib/services/turnService.ts` (STUN-only dev fallback + short-lived Cloudflare TURN generator) and document env vars in `.env.example`.
- [x] Implement `POST /api/rooms/[id]/call/ice-servers` and `POST /api/rooms/[id]/call/leave`, plus JSON `401` handling for `/api/*` in `src/lib/supabase/middleware.ts`.
- [x] Add `CALL_CONSTANTS` in `sync.constants.ts` and database types in `database.types.ts`.
- [x] Add unit & security audit tests in `tests/voice-call-phase10_2.test.mjs` and verify against PGlite Postgres + TypeScript + ESLint + Next.js build.

### Phase 10.3 — Core Two-Person WebRTC Engine
- [x] Define strict TypeScript call contracts (`call.types.ts`) and runtime payload validators + rate limiter (`callSignalValidation.ts`).
- [x] Implement authenticated anti-spoofing 1:1 signaling manager (`CallSignaling.ts`).
- [x] Implement `PeerConnectionManager.ts` with Perfect Negotiation, early ICE candidate buffering, automatic ICE restarts, stats probing, and full teardown.
- [x] Implement `AudioLevelMonitor.ts` for low-overhead speaking detection with hold hysteresis.
- [x] Add Phase 10.3 unit tests (`tests/voice-call-phase10_3.test.mjs`) and verify TypeScript + ESLint + tests + Next.js build.

### Phase 10.4 — `useCall` Hook & Luxury Cinema Voice UI
- [x] Extend `roomRealtimeBus.ts` and `useRoom.ts` to dispatch `room_call_participants` `postgres_changes` prior to `.subscribe()`.
- [x] Implement `src/hooks/useCall.ts` (mic-first join, 20s heartbeat, TURN refresh, beacon `pagehide` leave, device/network/tab recovery, verified username lookup, autoplay unlock).
- [x] Create `src/components/call/VoiceCallBar.tsx` and integrate responsive voice controls into `RoomHeader.tsx`, `ChatContainer.tsx`, and `RoomView.tsx` without obstructing `UniversalPlayer.tsx`.
- [x] Add Phase 10.4 tests (`tests/voice-call-phase10_4.test.mjs`) and verify TypeScript + ESLint + tests + Next.js build.

### Phase 10.5 — Verification, Docs & Production Readiness
- [x] Add middleware `/api/*` JSON 401 & `AudioLevelMonitor` tests (`tests/voice-call-phase10_5.test.mjs`).
- [x] Update `ARCHITECTURE.md` (Section 7), `DECISIONS.md` (ADR-010), `DEPLOYMENT.md` (Supabase `005`/`006`, Realtime public-access toggle, Cloudflare TURN, post-deploy test checklist), `CURRENT_STATE.md`, and `TASKS.md`.
- [x] Re-verify PGlite SQL suite (75/75), TypeScript (`npx tsc --noEmit`), ESLint (`npm run lint`), automated tests (`npm test`), and Next.js production build (`npm run build`).
- [ ] User manual post-deployment matrix (run after deploying to Supabase + Vercel with Cloudflare TURN): 2-person call, 3rd viewer `2/2` cap, laptop Wi-Fi ↔ mobile Jio 4G/5G, mic denial, simultaneous join, network interruption, and refresh/exit cleanup.

---

## Phase 11 — Room Playback Delegation, Kick Member, Autoplay Fix & In-Room Video Cleanup
- [x] Fix joiner autoplay-on-join when host/admin is paused (`YouTubePlayerAdapter` `onReady` pause guard & `cueVideoById`, `HTML5VideoAdapter` `autoplay = false`, `SyncEngine` paused enforcement & `PLAY` interception).
- [x] Add room-wide playback control delegation (`allow_guest_control` toggle) and per-member `co-host` promotion/demotion across database (`007_room_permissions_and_kick.sql` / `full_setup.sql`), `roomService`, `SyncEngine`, `useSyncEngine`, `useRoom`, and UI (`RoomParticipantsModal`, `RoomHeader`, `UniversalPlayer`).
- [x] Add host ability to kick/remove participants from a room (`kicked_user_ids` array + `enforce_kicked_member_viewer_only()` trigger so kicked users can rejoin only as permanent view-only viewers — never Co-Host or Shared Controls, `guard_room_settings_update()` trigger, `KICK_MEMBER` Realtime broadcast with presence untrack & call cleanup, and viewer removal screen in `RoomView`).
- [x] Improve in-room video switching & upload replacement (`ChangeVideoModal` reset & pre-upload cleanup, `DELETE /api/rooms/[id]/video` admin cleanup route, `storageService.cleanupRoomVideos`) so stale Supabase Storage objects and `storage_usage_metrics` are cleaned up automatically.
- [x] Remove host auto-failover and close/delete the room (`ROOM_CLOSED` broadcast + storage cleanup) when the host leaves or stays disconnected past the grace window, while preventing non-creator room recreation (`?create=1`).
- [x] Tighten home & auth hero/card spacing (`src/app/page.tsx`, `src/app/auth/page.tsx`, `RecentRoomsSection.tsx`).
- [x] Add unit/integration tests (`tests/room-controls-and-sync-fixes.test.mjs`) and update documentation (`CURRENT_STATE.md`, `TASKS.md`).
- [ ] User manual SQL migration: run `supabase/migrations/007_room_permissions_and_kick.sql` (or updated `supabase/full_setup.sql`) in the Supabase SQL Editor.

---

## Phase 12 — 4-Way Mesh Voice Calls, Video Auto-Ducking & Custom App Icon
- [x] Expand `join_room_call` capacity from `2` to `4` in `supabase/migrations/008_four_way_voice_mesh.sql` and `supabase/full_setup.sql`, and update `CALL_CONSTANTS.MAX_CALL_PARTICIPANTS = 4` in `src/lib/constants/sync.constants.ts`.
- [x] Upgrade `CallSignaling.ts` (`syncPeers`, `addPeer`, `removePeer`) and `useCall.ts` (`peerManagersRef`, per-peer `<audio>` sinks, per-peer mute/speaking/status maps) for full 4-way WebRTC audio mesh.
- [x] Update `VoiceCallBar.tsx` and `RoomHeader.tsx` for multi-caller banners (`N/4`) and `Auto-duck: On/Off` toggle.
- [x] Implement video auto-ducking during active voice calls in `UniversalPlayer.tsx` wired from `RoomView.tsx`.
- [x] Replace default `src/app/favicon.ico` with Syncora's custom `src/app/icon.svg`.
- [x] End the voice call for all participants when the room host leaves (`009_host_leave_ends_voice_call.sql` + `full_setup.sql`, `useCall.ts` `host-ended` bye & `DELETE` teardown, `VoiceCallBar.tsx` notice banner, `RoomHeader.tsx` host tooltip, `RoomView.tsx`), fix rapid leave→rejoin channel races and transient `socket closed: 1006` / Realtime reconnect errors (`CallSignaling.ts`, `useRoom.ts`), and disambiguate `Media / URL` vs audio-only `Voice Call` (`RoomHeader.tsx`, `VoiceCallBar.tsx`).
- [x] Gate voice call initiation by default to Room Host (or Co-Host / all members when Host enables `allow_guest_call` in **Members & Permissions**) across `010_voice_call_initiation_permissions.sql` + `full_setup.sql`, `roomService.ts`, `useRoom.ts`, `useCall.ts`, `RoomParticipantsModal.tsx`, `RoomHeader.tsx`, and `RoomView.tsx`.
- [x] Restrict lobby Recent Rooms (`roomService.getUserRooms` & `RecentRoomsSection.tsx`) to rooms hosted by the current user only (`host_id = userId`).
- [x] Fix overlapping/duplicate voice offer collisions (`PeerConnectionManager.ts` signaling queue, cached answer reuse, deferred `negotiationneeded` guard; `useCall.ts` `firstHello`-only offer resend and `SIGNALING_ERROR` recovery on connect) tested in `tests/voice-call-phase10_3.test.mjs` and `tests/voice-call-phase12_mesh_and_ducking.test.mjs`.
- [x] Prevent YouTube personal watch history from leaving the joiner seekbar mid-video before host starts playback (`YouTubePlayerAdapter.ts` `start: 0`, `cueVideoById` when unstarted/cued; `SyncEngine.ts` `initialLocalPos` reset to `0` and post-seek `In Sync` update) tested in `tests/room-controls-and-sync-fixes.test.mjs`.
- [x] Fix mobile in-room header/navbar overflow with a single sleek mobile `RoomHeader` bar + overflow action menu (`⋯`), add reliable mobile Web Share + HTTP-safe clipboard invite helpers (`src/lib/utils/share.ts`, `RoomHeader.tsx`, `Navbar.tsx`, `RoomView.tsx`, `RoomParticipantsModal.tsx`), add adaptive network-aware spinner/loading stages (`useLoadingStages.ts`, `RoomLoadingState.tsx`, `loading.tsx`, `page.tsx`, `RecentRoomsSection.tsx`, `FavoritesSection.tsx`), default `Button` to `type="button"`, and isolate `RecentRoomsSection` / `FavoritesSection` delete actions from card navigation (`tests/mobile-room-and-delete-safety.test.mjs`).
- [x] Add Phase 12 tests (`tests/voice-call-phase12_mesh_and_ducking.test.mjs`) and update `CURRENT_STATE.md` & `TASKS.md`.
- [ ] User manual SQL migration: run `supabase/migrations/008_four_way_voice_mesh.sql`, `supabase/migrations/009_host_leave_ends_voice_call.sql`, and `supabase/migrations/010_voice_call_initiation_permissions.sql` (or updated `supabase/full_setup.sql`) in the Supabase SQL Editor.

---

## Phase 13 — Performance Optimization
### Optimization 1 — Instant Chat
- [x] Broadcast `CHAT_MESSAGE` immediately over the authorized `room:{roomId}` private channel (`useRoom.ts`, `roomRealtimeBus.ts`, `useChat.ts`).
- [x] Persist messages to PostgreSQL independently with client-generated UUIDs (`generateChatMessageId()`, `roomService.sendChatMessage` without `profiles` join).
- [x] Deduplicate Broadcast, `postgres_changes`, optimistic state, and initial history (`upsertChatMessage()`, `mergeChatHistory()`).
- [x] Eliminate per-message `profiles` lookups using cached `members` + `presenceList` participant names (`syncParticipantNameCache()`, `resolveCachedSenderName()`).
- [x] Handle persistence failures, bounded transient retries (`23505` idempotency, `ChatPersistenceError`), and `'sending' | 'sent' | 'failed'` UI states (`ChatContainer.tsx`).
- [x] Add regression tests (`tests/instant-chat.test.mjs`) and verify TypeScript, ESLint, security tests, full test suite, and production build.

### Optimization 2 — Faster Room Creation and Joining
- [x] Inspect existing SQL constraints, triggers, and permissions (`001`–`010`, `full_setup.sql`).
- [x] Implement atomic `create_room_session` and `join_room_session` RPCs (with shared `_finalize_room_session`, initial video params, advisory lock capacity enforcement, kicked view-only guard, and strict `REVOKE`/`GRANT`) in `supabase/migrations/011_atomic_room_session_rpcs.sql` and `supabase/full_setup.sql`.
- [x] Update `database.types.ts`, `room.types.ts`, `roomService.ts`, `useRoom.ts`, and `RoomView.tsx` to use 1-round-trip `createRoomSession` / `joinRoomSession` and remove redundant `ensureProfile`, `getRoomByCode`, `joinRoom`, `getRoomMembers`, and post-create `updateVideo` calls.
- [x] Add regression tests (`tests/room-session-rpc.test.mjs`) and verify TypeScript, ESLint, security tests, full test suite, and production build.
- [ ] User manual SQL migration: apply `supabase/migrations/011_atomic_room_session_rpcs.sql` (or updated `supabase/full_setup.sql`) in Supabase SQL Editor.

### Optimization 3 — Faster Authentication
- [x] Audit `updateSession` middleware and API route authentication calls (`src/lib/supabase/middleware.ts`, `src/app/api/**`).
- [x] Implement verified JWT claims validation (`supabase.auth.getClaims()`) with module-scoped 10-minute deduplicated JWKS caching, key-rotation invalidation, `/auth/callback` early exit, and missing-cookie fast-path in `src/lib/supabase/auth.ts` and `src/lib/supabase/middleware.ts`.
- [x] Preserve `supabase.auth.getUser()` server-side checks on privileged/destructive and external-secret API routes (`DELETE /api/rooms/[id]`, `DELETE /api/rooms/[id]/video`, `POST /api/rooms/[id]/call/ice-servers`, `POST /api/rooms/[id]/call/leave`).
- [x] Add cryptographic & security regression tests (`tests/auth-performance.test.mjs`) and benchmark loopback latency/request counts.

### Optimization 4 — Faster Initial Loading
- [x] Seed `SessionProvider` with server-resolved verified claims (`getServerInitialSession` in `src/lib/supabase/server.ts`, `mapClaimsToUserIdentity` in `src/lib/supabase/auth.ts`, `src/app/layout.tsx`, and `src/context/SessionContext.tsx`) to remove the client auth startup waterfall.
- [x] Fetch independent dashboard shelves concurrently via `Promise.all` (`src/lib/services/dashboardService.ts`, `src/app/page.tsx`, `RecentRoomsSection.tsx`, `FavoritesSection.tsx`).
- [x] Parallelize room initialization, Realtime JWT pre-warm, and eager chat-history loading where RLS permits (`src/app/room/[code]/page.tsx`, `src/hooks/useRoom.ts`, `src/components/room/RoomView.tsx`, `src/components/chat/ChatContainer.tsx`, `src/hooks/useChat.ts`).
- [x] Add regression tests (`tests/initial-loading.test.mjs`), run benchmark measurements, and verify TypeScript, ESLint, security tests, full test suite, and production build.

---

## Phase 14 — Mobile & Small Screen Usability Optimization ✅
- [x] Unblock Joiners / Co-Host management and Video Upload on mobile: added a dedicated Mobile Quick Action Strip under the video player (`Joiners (N/4)`, `Upload / URL`, and Voice quick controls in `RoomView.tsx`), upgraded `RoomHeader.tsx` mobile bar to provide a dedicated, untruncated `[👥 N/4]` Members & Permissions trigger alongside `[🎬 Media]`, and made telemetry strip areas clickable to trigger the respective modals directly.
- [x] Prevent Voice Call UI from pushing chat off-screen and breaking on mobile: removed the blocking 118px `VoiceCallBar variant="banner"` above the video on mobile (`lg:hidden`), replaced with a non-intrusive 28px active voice ribbon under the video and compact header controls, and added non-blocking single-line notices for browser autoplay audio unlock and transient call errors.
- [x] Prevent mobile viewport distortion and auto-zoom when tapping chat: upgraded `<input>` elements in `ChatContainer.tsx` and `Input.tsx` to `text-base sm:text-sm` (16px on mobile stops iOS Safari and Android Chrome from auto-zooming the viewport), added `viewport` metadata with `interactiveWidget: 'resizes-content'` in `src/app/layout.tsx`, and anchored chat inputs with safe-area padding (`env(safe-area-inset-bottom)`).
- [x] Eliminate tiny fonts across mobile: increased message bubble text from 12px to 14px (`text-sm sm:text-xs`), sender names from 10px to 12px (`text-xs sm:text-[11px]`), timestamps and status badges from 9px/10px to 11px/12px, quick reaction emojis to comfortable 38×38px touch targets, and revealed explicit "Make Co-Host" / "Demote" and "Kick" button labels in `RoomParticipantsModal.tsx` on mobile.
- [x] Verified full regression suite (`86/86` tests passing), `tsc --noEmit` (0 errors), `npm run lint` (0 errors, 0 warnings), and production build (`npm run build`).

---

## Phase 15 — Watch Party Experience Refinement ✅
- [x] **Voice Calls**:
  - Distinguish Speaking (emerald pulsing ring, 3-bar animated equalizer, "Speaking" badge), Listening (calm green dot, "Listening" text), and Muted (mic-off badge, "Muted" text) states in `VoiceCallBar.tsx`.
  - Update states in real time using `AudioLevelMonitor` and peer mute signaling.
  - Replaced technical connection labels (`Live · STUN`, `Live · Relayed`, `Live · P2P`) with clean "Voice Connected" badge.
  - Sanitized voice call errors (`useCall.ts`, `PeerConnectionManager.ts`) so internal details (STUN, TURN, WebRTC, ICE, SDP) remain in developer logs while users see friendly messages ("Couldn't connect to voice call. Please try again.").
- [x] **Chat**:
  - Implemented `CHAT_SEEN` broadcast protocol across `roomRealtimeBus.ts`, `useRoom.ts`, and `useChat.ts`.
  - Added visual delivery and read receipts to user's own messages: `Sending...` -> `✓ Sent` -> `✓✓ Seen`.
  - Eliminated rapid 20ms flickering by enforcing a smooth >=500ms holding transition for `status === 'sending'`.
  - Upgraded chat panel color theme to `#0B1E17` for crisp contrast with message bubbles.
  - Scoped chat history to each member's `joinedAt`: late joiners only see messages from when they joined (DB query in `roomService.getChatMessages` + client-side filter in `useChat`), while existing participants keep the full conversation.
- [x] **Duplicate Removal & Unified Controls**:
  - Removed duplicate `Copy Invite` button in desktop header (room code pill serves as the primary copy trigger).
  - Removed duplicate `Members` button in desktop header (the online members badge opens `RoomParticipantsModal`).
  - Removed duplicate `Change Video` button inside `UniversalPlayer.tsx` top overlay.
  - Removed redundant quick action strip and duplicate participant count under video in `RoomView.tsx`.
  - Disabled Next.js dev indicator overlay (`devIndicators: false` in `next.config.ts`) to prevent UI collision with the message input.
- [x] **Mobile & Desktop Layout**:
  - Balanced theater split: video centerpiece with high visibility on mobile and desktop.
  - Clean screening telemetry bar under video showing source status (`YouTube · Synced`).
  - Verified with `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors, 0 warnings), full test suite (`86/86` tests passing), and production build (`npm run build`).

---

## Phase 16 — YouTube-First Source Selection & Shared Watch Queue ✅
- [x] Redesign `src/app/page.tsx` into a source-selection screen (YouTube featured, Direct URL, Local Upload, Netflix/Prime coming soon) while retaining join-by-code, recent hosted rooms, favorites, `fetchDashboardData`, and `useLoadingStages`.
- [x] Add `SourceSetupModal.tsx` for Direct URL / Local Upload room creation and route flows into `/room/{code}?create=1&source=url|upload`.
- [x] Add server-only YouTube Data API v3 integration: `youtube.types.ts`, `youtubeService.ts` (search/metadata, ISO-8601 duration parsing, embeddable filtering, caches, typed quota/auth errors), `youtubeRateLimit.ts` (20 req/min/IP), and authenticated `/api/youtube/search` + `/api/youtube/videos` routes. Document `YOUTUBE_API_KEY` in `.env.example`; keep the real key only in `.env.local`.
- [x] Add `YouTubeBrowser.tsx` and `src/app/browse/page.tsx` with debounced search, quick chips, loading skeletons, quota/config messaging, paste-link fallback, YouTube attribution, and a max-20 multi-select line-up.
- [x] Add `room_queue_items` schema, indexes, member RLS, `can_control_room_queue` (kicked-user exclusion), atomic `add_room_queue_item` / `reorder_room_queue` RPCs, position-only update guard, realtime publication, and `REPLICA IDENTITY FULL` in `supabase/migrations/012_room_queue.sql` + `supabase/full_setup.sql`; update `database.types.ts`.
- [x] Add queue client/realtime: `RoomQueueItem` / `QueueVideoInput`, `queueService.ts`, `pendingQueue.ts`, `useRoomQueue.ts`, and queue `postgres_changes` wiring in `useRoom.ts` / `roomRealtimeBus.ts`.
- [x] Add in-room queue UI (`RoomQueuePanel.tsx`, `YouTubeQueueModal.tsx`), header queue count/trigger, pending-queue seeding, `openUpload`, `initialVideoType`, and host-only auto-next in `RoomView.tsx` / `room/[code]/page.tsx`.
- [x] Add playback resilience: adapter `getLastErrorCode()`, `youtubeErrors.ts`, friendly error overlay with “Watch on YouTube” / “Choose another video”, `autoPlayOnLoad` + `onEnded` in `UniversalPlayer.tsx`, and custom `YouTubeIcon.tsx`.
- [x] Add regression tests (`tests/youtube-and-watch-queue.test.mjs`) and update `tests/room-session-rpc.test.mjs`; verified `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors/warnings), `npm test` (96/96 passing), and `npm run build`.
- [x] Applied `supabase/migrations/012_room_queue.sql` in Supabase; verified `room_queue_items` + queue RPCs via PostgREST and confirmed `YOUTUBE_API_KEY` returns live YouTube Data API v3 search results.
- [x] Live authenticated smoke test: search on `/browse`, start a room from the line-up, add/remove/reorder queued videos across two clients, verify Realtime sync + host-only auto-next, and test an embed-disabled video fallback.


---

## Phase 17 — YouTube-Inspired Browse & Source UI Redesign ✅
- [x] Rework `src/app/page.tsx`: YouTube-primary panel with recognizable branding and a prominent “Explore YouTube” action, compact Direct URL / Local Upload rows, subtle Netflix / Prime Video “Coming soon” pills, compact join rail, and secondary recent/favorites shelves. Remove the old source-card grid and marketing pillars.
- [x] Rework `YouTubeBrowser.tsx`: prominent pill search, category chips, `/` search shortcut, larger unboxed thumbnail grid, channel/duration metadata, clear Add-to-queue and selected states, inline link fallback, “Show more” pagination, and a `YouTubeBrowserHandle` for external search control.
- [x] Rework `src/app/browse/page.tsx`: compact YouTube-style top bar, collapsible desktop category sidebar, dominant responsive grid, collapsible desktop line-up panel, mobile line-up drawer + sticky review bar, and accessible room creation via the line-up form.
- [x] Update `YouTubeIcon.tsx` to the familiar red play mark; retain “in Syncora,” YouTube attribution, and non-affiliation copy; hide the footer on `/browse`.
- [x] Preserve all search/API/queue/Supabase/RLS/RPC/Realtime/playback behavior; verify `npx tsc --noEmit`, `npm run lint`, `npm test` (96/96), and `npm run build`.
- [x] Authenticated visual QA at desktop/tablet/mobile sizes and live two-browser search → line-up → room → queue sync → auto-next smoke test.

---

## Phase 18 — CTA Simplification, Text Readability & Dark Modal Redesign ✅
- [x] Simplify YouTube card CTA in `src/app/page.tsx`: remove faux search row and “Explore YouTube” button; keep whole-card button with circular arrow as sole affordance (all breakpoints, purple tint, spinner while busy); drop create-stage labels from the card.
- [x] Raise home-page text size/contrast: eyebrow, subtitle, card copy, badges, trademark, “Coming soon,” secondary-source descriptions, join-rail copy, right-rail bullets, RecentRooms/Favorites metadata, Navbar badge/email, Input placeholder/label/helper, YouTubeBrowser meta/empty/footer — all ≥11–12px with ≥75–90% opacity.
- [x] Convert `Modal.tsx` shell to dark `#0B1E17` (title/description/close/divider light); restyle `Button.ghostSand` for dark surfaces; raise `Badge.default` to `#173D30`; pass `Input tone="dark"` at all modal call sites.
- [x] Add `tone` prop to `AuthFormContent` (default `sand` for `/auth` page; `AuthModal` passes `dark`) covering tabs, alerts, links, eye toggle, footer.
- [x] Restyle `ChangeVideoModal` (tab switcher, hard/soft alerts, dropzone, progress bar, error) and `SourceSetupModal` (info box, inputs) for dark surfaces.
- [x] Restyle `RoomParticipantsModal` (solid sand room-code pill + secondary Copy Invite, roster headers, badge sizes, footer) and `YouTubeQueueModal` (selected panel, Clear, error, divider) for dark surfaces.
- [x] Verify `npx tsc --noEmit`, `npm run lint`, `npm test` (96/96), and `npm run build`.
- [ ] Visual QA: home hero/card CTA, all six modals, and queue browser empty/results states at desktop/tablet/mobile.

---

## Phase 19 — Persistent Add Badge & Room-Wide Font Scale ✅
- [x] `YouTubeBrowser.tsx`: remove bottom “Add to queue” link; add always-visible thumbnail top-right pill (`+ Add` dark glass / `✓ Added` purple `#9670FF`); keep hover overlay + top-left check; shared by `/browse` and `YouTubeQueueModal`.
- [x] Raise shared scales: `Button` `sm`→`text-sm px-3.5 py-2`, `lg`→`text-base`; `Badge` default→`text-xs`; `Input` label/error/helper→`text-[13px]`.
- [x] ChatContainer: remove desktop size inversions, message body 14px on all breakpoints, meta/timestamps/receipts ≥11–12px @ ≥85% opacity, typing/system ≥13px, placeholder opacity 65%.
- [x] RoomQueuePanel: section labels 10→12px, item titles 11→12px, now-playing title 14px, empty-state/footer ≥12px, index/meta opacity ≥80%.
- [x] RoomHeader: voice status/full/join pills, room-code pill, countdown, badges → ≥12px; strip `text-[11px]` Badge/Button overrides; queue count 10→11px.
- [x] RoomView: remove telemetry/queue-pill desktop inversions, 9px queue count → 11px, voice-active label 12px, empty-state copy 13px.
- [x] UniversalPlayer: remove badge `sm:text-[11px]` inversions, unmute/toast/error copy 13–14px, CTA `text-sm`, timecode/resync 13px.
- [x] VoiceCallBar + RoomLoadingState: 10→12px status/meta text, opacity ≥85%.
- [x] Modals (ChangeVideo, Participants, YouTubeQueue): tabs/alerts/meta 13–12px; strip Badge/Button size overrides; Navbar/AuthForm small text raised; delete Button call-site `text-xs` overrides (Navbar, VoiceCallBar, RoomHeader, RoomView, FavoritesSection).
- [x] Verify `npx tsc --noEmit`, `npm run lint`, `npm test` (96/96), and `npm run build`.
- [x] Visual QA: room header/chat/queue/player/voice bar, browse & queue modal add badges, button sizing at desktop/tablet/mobile.

---

## Phase 20 — Mobile UX Decluttering & Smooth Room Experience ✅
- [x] Streamline `RoomParticipantsModal`: drop redundant modal description and footer essay; shorten toggle descriptions; put avatar, name, `(You)`, and role badge on one single horizontal row (`flex items-center gap-2`).
- [x] Re-architect `YouTubeQueueModal`: convert from disruptive center `<Modal>` to an expandable cinema slide-over side drawer with soft backdrop, leaving the active video playing unobstructed.
- [x] Implement sticky floating bottom bar in `YouTubeQueueModal`: selection count and `Add to Queue` button are permanently docked above the fold, completely eliminating the need to scroll through results to add videos.
- [x] Support seamless bidirectional navigation between `RoomQueuePanel` and `YouTubeQueueModal` via `onBackToQueue`.
- [x] Remove empty-state system chat welcome bubble from `useChat` to maximize vertical space for real messages.
- [x] Add mobile Chat toggle button in `RoomHeader` and mobile overflow menu.
- [x] Add mobile-visible header in `ChatContainer` with smooth `ChevronDown` minimize button; slim reaction strip.
- [x] Optimize `RoomView` mobile layout: allow video to expand to full Cinema view when chat is minimized; show floating mobile `[💬 Chat]` pill to reopen.
- [x] Implement draggable watch queue in `RoomQueuePanel`: HTML5 drag & drop and touch drag support with `GripVertical` handle, visual drop ring indicators, and optimistic reordering via `queueService.reorderItems` and `useRoomQueue.reorder`.
- [x] Eliminate visual flash when opening Add to Queue: unify the YouTube discovery and search directly inside `RoomQueuePanel`, keep the side drawer and backdrop persistently mounted, add smooth `.drawer-enter` right-side slide animations, and provide seamless 1-tap view switching without backdrop or container tear-down.
- [x] Fix screening header breaking: streamline `RoomHeader.tsx` so all controls (`room.title`, `room.code`, `Save`, `Online/Waiting`, `Queue`, `Media`, `Voice`, `Leave`) fit cleanly on one single line across viewports with zero horizontal overflow.
- [x] Convert all room popup modals to sidebar drawers: migrate `ChangeVideoModal.tsx` ("Media / URL") and `RoomParticipantsModal.tsx` ("Members & Permissions") to right slide-over drawers so active video playback is never covered or interrupted.
- [x] Implement desktop video auto-shrink alongside drawers: in `RoomView.tsx`, the left video stage dynamically shrinks (`transition-all duration-300 ease-out` with `lg:mr-[32rem] xl:mr-[36rem]`), chat is cleanly swapped out (`lg:hidden`), and backdrop is hidden on desktop (`lg:hidden`), keeping all video player controls 100% interactive.
- [x] Implement visibility-aware seen receipts: in `useChat.ts`, only broadcast `CHAT_SEEN` when `document.visibilityState === 'visible'` and `isChatOpen !== false`. If tab is hidden or minimized, queue seen receipt and flush on return.
- [x] WhatsApp-style instant message status: in `ChatContainer.tsx`, replace `Sending...` spinner with instant single tick (`Check`) on optimistic send, followed by delivered tick, and double green tick (`CheckCheck`) when seen.
- [x] Mobile background playback & Picture-in-Picture: add `togglePictureInPicture` and `webkit-playsinline` in `UniversalPlayer.tsx` and `HTML5VideoAdapter.ts` for multitasking while room audio and calls continue in the background.
- [x] YouTube error modal dismiss & cut: add top-right `X` close button, backdrop click-to-dismiss, Escape key handler, and `Dismiss` button in `UniversalPlayer.tsx` so users never need to refresh on playback errors.
- [x] Verify `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors), `npm test` (96/96 passing).

---

## Phase 21 — Mobile Home Page Pixel-Perfect Redesign ✅
- [x] Background & Lighting: add ambient emerald aurora glow curve at top right; style "NEW WATCH PARTY" in crisp purple mono tracking-widest.
- [x] Hero Header: render "What are we watching?" with golden/amber radiant glow on "What" and creamy white on "are we watching?".
- [x] YouTube Hero Card: inline red YouTube logo and serif typography on the same row, concise description, 3 purple feature badges ("Shared queue", "Up to 4 viewers", "Host sync"), dedicated purple "Watch on YouTube →" pill button, and authentic 3D red YouTube button graphic with neon ambient glow.
- [x] Secondary Sources: 2-column mobile grid for "Direct URL" and "Local Upload", dark rounded icon boxes, clean subtitles including `(≤ 50MB)`, and circular right arrow action buttons.
- [x] Coming Soon: authentic dark capsule pills for Netflix (red 'N' logo) and Prime Video (cyan prime script logo).
- [x] Join a Room Card: warm cream/beige background `#EDE2CA`, misty pine forest silhouette illustration, dark green user icon, cream input with Link icon, and full-width purple "Join Room →" button with multi-stage loading feedback.
- [x] Feature Pillars: 3-column mobile footer row with vertical dividers for "Real-time Sync" (Zap), "Watch Together" (Users2), and "Any Device" (Monitor).
- [x] Non-breaking Architecture: ensure full backward compatibility on desktop (`lg:grid-cols-[minmax(0,1fr)_340px]`), preserve Recent Rooms, Favorites, URL/upload modals, room normalization, and 100% test coverage (96/96 passing, clean build).
