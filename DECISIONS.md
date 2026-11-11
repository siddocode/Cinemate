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


