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
