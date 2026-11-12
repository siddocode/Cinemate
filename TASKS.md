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
- [x] Create Next.js root middleware (`src/middleware.ts`) and enhance `updateSession()` in `src/lib/supabase/middleware.ts`.
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

