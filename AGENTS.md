# AGENTS.md — Syncora Agent Operating Guidelines

This document contains permanent instructions, coding standards, and architectural rules for all AI coding agents working on **Syncora**.

---

## 1. Core Architectural Constraints

1. **Host-Authoritative Playback Architecture**
   - The room host (or assigned co-host) is the sole authority for playback state (play, pause, seek, video selection).
   - Viewers send control intents or requests to the host; they do NOT unilaterally broadcast playback state changes to the room.
   - All playback states are timestamped (`sent_at`, `position`, `is_playing`, `playback_rate`).

2. **Decoupled Video Providers via Player Adapters**
   - UI and synchronization engines MUST NEVER talk directly to raw player SDKs.
   - All players must implement the common `IVideoPlayerAdapter` interface:
     - `YouTubePlayerAdapter`
     - `HTML5VideoAdapter`
   - Playback synchronization logic must be video-provider agnostic.

3. **Hybrid Realtime Strategy**
   - **Supabase Realtime Broadcast**: Used strictly for transient, low-latency playback synchronization events (heartbeats, seek pulses, play/pause alerts) and ephemeral interaction pings.
   - **Supabase Realtime Presence**: Used strictly for tracking active room members, online status, device/buffer states, and host heartbeat.
   - **Supabase PostgreSQL & Changes**: Used for durable application data (room metadata, memberships, chat history, user profiles).

4. **Security & Validation**
   - **Zero Secret Leaks**: The Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY`) must NEVER be exposed to the client bundle or prefixed with `NEXT_PUBLIC_`.
   - **Server-Side Authorization**: Never trust client claims of host status. Validate room ownership and membership on the server (via Supabase RLS and Next.js Server Actions / Route Handlers).
   - **Input Validation**: Sanitize all URLs, chat messages, room codes, and timestamps on the server using Zod or equivalent schemas.

5. **Serverless & Clean Infrastructure**
   - Fully compatible with Vercel deployment without persistent container daemons, Redis, or custom WebSockets servers (relying on Supabase Realtime WebSockets managed infrastructure).

---

## 2. Multi-Chat Persistence Rules

- **Codebase as Truth**: Always check `CURRENT_STATE.md`, `TASKS.md`, and the filesystem before initiating work. Never assume a feature exists or is missing without inspecting it.
- **Never Restart**: Do not restart a project or redo previously completed phases simply because a new chat session was started.
- **Update Documentation**: At the end of every task or phase, update `CURRENT_STATE.md` and `TASKS.md`.
- **Token Efficiency**: Read only the files necessary for the current task. Do not bulk-read unrelated folders.
- **Explicit Approval**: Never transition across phase boundaries without explicit user sign-off.

---

## 3. TypeScript & Code Standards

- **Strict TypeScript**: `noImplicitAny: true`, strict null checks, explicit interfaces and type definitions in `@/core/types/`.
- **No Mocking in Production Paths**: Never replace core functionality with placeholder mocks or silent no-ops.
- **Clean Component Hierarchy**:
  - Presentational UI (`@/components/ui/`, `@/components/room/`, `@/components/chat/`)
  - Domain Hooks (`@/hooks/`)
  - Core Business & Sync Logic (`@/core/sync/`, `@/core/adapters/`)
  - Server & Database Utilities (`@/lib/supabase/`, `@/lib/utils/`)
- **Naming Conventions**:
  - Components: PascalCase (`UniversalPlayer.tsx`)
  - Hooks: camelCase with `use` prefix (`useSyncEngine.ts`)
  - Adapters/Classes: PascalCase (`YouTubePlayerAdapter.ts`)
  - Types/Interfaces: `I` prefix for interfaces (`IVideoPlayerAdapter.ts`), `.types.ts` for type files.

