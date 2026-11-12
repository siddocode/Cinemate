# DECISIONS.md — Syncora Architectural Decisions Log

## ADR-001: Host-Authoritative Playback Synchronization Model

- **Context**: A watch party needs a reliable source of truth for video play, pause, seek, and video changes.
- **Alternatives Considered**:
  - *Full Peer-to-Peer Consensus (CRDTs / Raft)*: High complexity, heavy network message overhead, high vulnerability to malicious participants altering playback.
  - *Server-Driven Playback Clock*: Requires a persistent stateful server process (e.g. Node.js with active timers) calculating ticks, which conflicts with serverless Vercel deployment.
- **Decision**: Host-Authoritative model. The host's client player acts as the master clock. Playback state transitions and periodic heartbeats are emitted by the host and mirrored by viewers.
- **Consequences**:
  - Extremely lightweight.
  - Viewers can request changes via chat or UI controls, but only the host client emits authoritative state broadcasts.
  - Requires clean host reassignment/failover logic if the host leaves the room.

---

## ADR-002: Realtime Infrastructure — Supabase Realtime over Custom Socket.io/Redis

- **Context**: Real-time watch parties need sub-100ms messaging for video synchronization and presence tracking.
- **Alternatives Considered**:
  - *Custom Node.js WebSocket Server (Socket.io) + Redis*: Requires standalone VPS/Docker containers, persistent connection management, separate deployment pipelines.
  - *Liveblocks / PartyKit*: Third-party proprietary SaaS adding additional dependencies and subscription costs.
- **Decision**: Leverage Supabase Realtime (Broadcast for ephemeral sync events, Presence for viewer status, Postgres Changes for chat and room mutations).
- **Consequences**:
  - Zero additional server infrastructure; 100% compatible with Vercel serverless deployment.
  - Leverages Supabase's global edge network for WebSockets.
  - Keeps all auth, DB, storage, and realtime in a unified, cohesive platform.

---

## ADR-003: Video Player Adapter Pattern (`IVideoPlayerAdapter`)

- **Context**: Syncora must support both YouTube (IFrame Player API) and personal videos (HTML5 `<video>`, direct URLs, and Supabase Storage uploads).
- **Alternatives Considered**:
  - *Scattered Provider Logic in React Components*: Tying `YT.Player` calls and `<video>` event listeners inside React UI components leads to brittle code, spaghetti state, and duplication.
  - *Heavy monolithic third-party player (e.g. Video.js plugins)*: Bulky bundle size, difficult to reconcile with custom drift algorithms.
- **Decision**: Build an explicit adapter interface `IVideoPlayerAdapter` with distinct implementations: `YouTubePlayerAdapter` and `HTML5VideoAdapter`.
- **Consequences**:
  - Complete decoupling between the sync engine, UI, and video providers.
  - Easy to add future video providers (e.g., Vimeo, Twitch, HLS.js) by implementing one interface.

---

## ADR-004: Tiered Drift Compensation Strategy

- **Context**: Internet latency, CPU scheduling, and browser background throttling cause client video positions to drift apart over time.
- **Alternatives Considered**:
  - *Hard Seek on Every Event/Heartbeat*: Causes stuttering audio, buffer thrashing, and visual pauses every few seconds.
  - *Pure Play/Pause Broadcast without Time Stamps*: Accumulates uncorrected drift over minutes, especially if a user buffers.
- **Decision**: Tiered 3-stage drift correction:
  1. Drift $< 500\text{ms}$: Deadband — do nothing.
  2. Drift between $500\text{ms}$ and $2000\text{ms}$: Playback rate nudge ($1.05\times$ or $0.95\times$) for smooth micro-adjustment without audible pitch glitches.
  3. Drift $> 2000\text{ms}$: Hard seek to authoritative timestamp.
- **Consequences**:
  - Video and audio playback feel completely natural for viewers while maintaining tight multi-device synchronization.

---

## ADR-005: Authentication Strategy — Frictionless Guest Identity with Future Auth Migration

- **Context**: The user specified: *"for now dont add any auth, but design system in such a way we will add auth later"*. Watch parties need zero login barriers initially, but the system must accommodate full authentication (email/OAuth) in the future without schema overhauls or architectural rewrites.
- **Alternatives Considered**:
  - *Hardcoding Supabase Auth upfront*: Adds login/signup friction before core watch party features can be used.
  - *No user IDs at all (pure ephemeral strings)*: Would break room membership, RLS policies, and require a complete rewrite when adding auth later.
- **Decision**: 
  - Every visitor gets a persistent client-side session identity (UUID) and a chosen display name (stored in cookies / localStorage / `profiles` table).
  - All database models (`profiles`, `rooms`, `room_members`, `chat_messages`) utilize a standard `user_id UUID` foreign key.
  - An abstraction layer (`useSession()` / `AuthContext`) provides `user: { id: string, username: string, isAnonymous: boolean }`.
  - When Supabase Auth is enabled later, the auth hook simply switches from local guest session tokens to Supabase `auth.users` JWTs, with an automated account claiming/linking migration path.
- **Consequences**:
  - Zero login friction for users today.
  - Zero schema breaking changes when introducing Supabase Auth later.

---

## ADR-006: Host Disconnect & Auto-Failover Protocol

- **Context**: In a host-authoritative model, if the host abruptly closes their browser, experiences network outage, or navigates away, the room could be left frozen.
- **Decision**: 
  - When Supabase Realtime Presence detects the host left the channel, the room enters a `HOST_DISCONNECTED_GRACE_PERIOD` state (30 seconds).
  - A subtle banner informs participants: *"Host disconnected. Pausing playback. Host has 30 seconds to reconnect..."*
  - If the host reconnects within 30 seconds, they resume authority.
  - If the 30-second timer expires, the system automatically promotes the next eligible participant (co-host, or the participant with the earliest `joined_at` timestamp) to become the new host, updating `rooms.host_id` in PostgreSQL and notifying the room via Realtime Broadcast.

---

## ADR-007: Personal Video Storage Limits & External Stream Policy

- **Context**: Syncora supports personal videos (Phase 6). Supabase free tier includes a 50MB maximum single file upload limit and 1GB total project storage.
- **Decision**:
  - Enforce a strict 50MB client-side and Supabase Storage bucket policy cap on direct file uploads (ideal for short clips, family videos, trailer snippets, and reaction videos).
  - Fully support direct web video URLs (MP4, WebM, native HLS streams) without file size limitations for full-length movies or larger external files.

---

## ADR-008: Two-Person (Duo) Focused Experience

- **Context**: The user specified: *"mostly i wan to build soemthign for two people only not group for now... watching youtube video together and chat their at realtime should be there, adn chating should be there thoroyught whiel watchign things"*.
- **Decision**: 
  - Optimize the UI, presence indicators, and interaction models specifically for 2-person watch sessions (You & Your Partner/Friend).
  - Room header & presence explicitly highlight "Partner Status" (Connected, Buffering, Playing, Idle).
  - Layout priority: Side-by-side Theater Mode on desktop/tablets with a persistent real-time chat panel directly beside the video so chatting never interrupts or obscures video playback. On mobile, responsive split view (video pinned top, real-time chat persistent below).
  - The underlying database (`room_members`) and Realtime engine remain multi-user capable under the hood so scaling to groups in the future requires zero architectural rework.

---

## ADR-009: Supabase Modern API Key Format (`sb_publishable_...` and `sb_secret_...`)

- **Context**: Supabase transitioned to a new API key architecture featuring prefix-identifiable keys: `sb_publishable_...` (replacing the JWT `anon` key) and `sb_secret_...` (replacing the JWT `service_role` key).
- **Decision**:
  - The client bundle strictly uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (configured in `src/lib/supabase/config.ts` and `src/lib/supabase/client.ts`).
  - Privileged administrative access strictly uses `SUPABASE_SECRET_KEY` (configured in `src/lib/supabase/server.ts` via `getSupabaseAdminClient()`), which is never prefixed with `NEXT_PUBLIC_` and never exported to browser bundles.
  - Backward compatibility: Fallbacks to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are maintained so legacy projects continue to function seamlessly.

---

## ADR-010: Two-Person P2P WebRTC Voice Calling over Private Realtime Outboxes & Server-Side Cloudflare TURN

- **Context**: Syncora needed low-latency voice calling while watching without adding container servers, third-party SFUs, or exposing TURN secrets to the browser, while preserving the 4-participant watch-room cap and hardening Supabase Realtime against unauthenticated access or sender spoofing.
- **Decisions**:
  1. **2-Person Voice Cap (`MAX_CALL_PARTICIPANTS = 2`) within 4-Viewer Rooms**: Voice calls use direct 1:1 WebRTC (`RTCPeerConnection`) rather than a multi-party mesh or external SFU. Concurrency is enforced atomically in PostgreSQL (`join_room_call` with `pg_advisory_xact_lock` + 60s heartbeat expiry).
  2. **Anti-Spoofing Per-Caller Private Outbox Topics**: Because Supabase Realtime Broadcast does not stamp a verified sender ID in payloads, each caller publishes strictly to `call:{roomId}:{selfUserId}` enforced by `realtime.messages` RLS (`auth.uid() = senderId` + active membership + active call slot). Non-callers in the 4-person room cannot subscribe to or inject SDP/ICE.
  3. **Configurable Cloudflare TURN with STUN-Only Dev Mode**: `turnService.ts` runs strictly server-side behind `POST /api/rooms/[id]/call/ice-servers` (with Postgres rate limiting in `call_credential_requests`). When `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are omitted, local development uses STUN-only (`isProductionReady: false`); production deployments generate short-lived Cloudflare TURN credentials (`turns:` on port 443 for strict mobile CGNAT/Jio compatibility).
- **Consequences**:
  - Zero new runtime npm dependencies and 100% Vercel serverless compatibility.
  - Watch-party playback, chat, and authentication remain completely decoupled from voice calls.
  - STUN-only development works without third-party keys, while production mobile/NAT reliability requires configuring Cloudflare TURN keys before go-live.

---

## ADR-011: Instant Chat via Private Room Broadcast + Independent PostgreSQL Persistence

- **Context**: Previously, sending a chat message waited for a PostgreSQL `INSERT` with a `profiles(username)` join, WAL propagation through Supabase Postgres Changes, and a second per-message `profiles` `SELECT` on every receiver before displaying the message.
- **Decision**:
  - Generate an RFC 4122 v4 UUID (`generateChatMessageId()`) on the sender and broadcast `CHAT_MESSAGE` immediately over the existing private `room:{roomId}` channel (already protected by `realtime.messages` RLS `can_access_room_topic()`).
  - Persist to `public.chat_messages` independently using the same client UUID (treating `23505` duplicate-key retries as idempotent success) without joining `profiles` on insert.
  - Deduplicate Broadcast, `postgres_changes`, optimistic state, and initial history by `id`, and resolve sender usernames from the in-memory `members` + `presenceList` cache instead of querying `profiles` per message.
  - Track optimistic message status (`'sending' | 'sent' | 'failed'`) with bounded automatic retries for transient failures and manual retry/dismiss actions in the UI.
- **Consequences**:
  - Peer message delivery bypasses DB write + WAL round-trips and eliminates per-message `profiles` queries while retaining durable PostgreSQL chat history and RLS enforcement.

---

## ADR-012: Atomic Room Creation & Joining via `create_room_session` and `join_room_session` RPCs

- **Context**: Entering or creating a watch room previously required 8–12 sequential client-to-PostgREST round-trips (`getRoomByCode`, `ensureProfile`, `rooms` insert/check, `room_members` count/check/upsert, second `getRoomByCode`, `getRoomMembers`, and a post-mount `updateVideo` call).
- **Decision**:
  - Consolidate room creation (including initial `video_url` and `video_type`), conditional profile sync, advisory-locked 4-member capacity enforcement, kicked-user view-only checks, membership upsert, and participant list aggregation into two `SECURITY DEFINER` RPCs: `create_room_session` and `join_room_session` (`011_atomic_room_session_rpcs.sql`).
  - Retain a `PGRST202`/`42883` fallback in `roomService.ts` only so unmigrated environments continue functioning until migration `011` is applied.
- **Consequences**:
  - Reduces room creation and joining to 1 atomic database round-trip (while keeping `tr_check_room_creation_rate`, `tr_enforce_room_member_capacity`, `tr_enforce_kicked_member_viewer_only`, and `tr_guard_room_member_update` enforced server-side).

---

## ADR-013: Verified JWT Claims Verification with Cached JWKS in Middleware

- **Context**: `updateSession` middleware previously instantiated `createServerClient()` and called `supabase.auth.getUser()` on every page navigation and `/api/*` request, causing an extra HTTPS round-trip to `/auth/v1/user` even for valid sessions and allocating clients unnecessarily when requests lacked session cookies.
- **Decision**:
  - Switch `updateSession` ([`middleware.ts`](file:///home/sid/Desktop/Cinemate/src/lib/supabase/middleware.ts)) to [`getVerifiedAuthClaims()`](file:///home/sid/Desktop/Cinemate/src/lib/supabase/auth.ts) (`supabase.auth.getClaims()`) paired with a 10-minute module-level deduplicated JWKS cache (`getCachedJwks()`), preserving automatic session refresh and rejecting anonymous, expired, `alg: 'none'`, or forged JWTs.
  - Skip `createServerClient()` instantiation on `/auth/callback` and on requests without `sb-*-auth-token*` cookies (`hasSupabaseAuthCookie()`).
  - Keep `supabase.auth.getUser()` inside privileged/destructive and external-secret API routes (`DELETE /api/rooms/[id]`, `DELETE /api/rooms/[id]/video`, `POST /api/rooms/[id]/call/ice-servers`, and `POST /api/rooms/[id]/call/leave`).
- **Consequences**:
  - Eliminates per-request `/auth/v1/user` network hops in middleware for asymmetric JWTs (`100` -> `0` `/auth/v1/user` requests across 100 requests; `1` cached JWKS fetch per 10m TTL) without weakening authentication or losing `getUser()` revocation checks on sensitive mutations.

---

## ADR-014: Server-Seeded `SessionProvider` & Parallel Dashboard / Room Initialization

- **Context**: Even with single-RPC room creation/joining, first paint waited on a client-side `supabase.auth.getSession()` waterfall before `SessionProvider` initialized, dashboard shelves fetched independently on child mount, and chat history waited until after React committed `RoomView` -> `ChatContainer` mount and Realtime socket setup.
- **Decision**:
  - Resolve initial `UserIdentity` server-side in [`layout.tsx`](file:///home/sid/Desktop/Cinemate/src/app/layout.tsx) via [`getServerInitialSession()`](file:///home/sid/Desktop/Cinemate/src/lib/supabase/server.ts) (verified JWT claims + cached JWKS) and seed [`SessionProvider`](file:///home/sid/Desktop/Cinemate/src/context/SessionContext.tsx) without sharing mutable module state across SSR requests.
  - Consolidate dashboard data fetching into [`fetchDashboardData()`](file:///home/sid/Desktop/Cinemate/src/lib/services/dashboardService.ts) using `Promise.all([roomService.getUserRooms, favoriteService.getFavorites])`.
  - Pre-warm `realtime.setAuth` alongside `createRoomSession`/`joinRoomSession` in [`useRoom.ts`](file:///home/sid/Desktop/Cinemate/src/hooks/useRoom.ts), start `roomService.getChatMessages(room.id)` immediately after session membership commits (in parallel with Realtime subscribe and player boot), and pass `initialChatHistory` into [`useChat.ts`](file:///home/sid/Desktop/Cinemate/src/hooks/useChat.ts).
- **Consequences**:
  - Cuts dashboard critical-path stages from `2` to `1` (`51.61ms` -> `23.8ms` in local `20ms`-query simulation) and room init critical-path stages from `4` to `2` (`93.01ms` -> `48.05ms`) while preserving strict RLS enforcement (`chat_messages` membership check) and hydration consistency.


