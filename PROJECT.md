# PROJECT.md — Syncora Product Overview

## 1. Product Summary

**Syncora** is a real-time collaborative watch party web application that allows friends and groups to watch YouTube videos, direct video streams, and uploaded personal videos together in seamless synchronization across desktop, tablet, and mobile devices.

---

## 2. Target Audience & Use Cases

- **Casual Groups & Friends**: Watching YouTube shows, podcasts, trailers, music videos, or personal clips together while chatting in real-time.
- **Content Creators & Communities**: Hosting watch parties with followers with authoritative host controls.
- **Remote Families & Couples**: Sharing personal family videos (MP4/WebM) uploaded securely.

---

## 3. Product Features & Scope

### Feature 1: Private Rooms & Sharing
- Instant room creation with a clean, human-readable code (e.g., `SYNC-4821`) and direct invitation URL (`/room/SYNC-4821` or `/room/[uuid]`).
- Optional room passcodes for enhanced privacy.
- Frictionless joining for participants with anonymous or registered authentication.

### Feature 2: Host-Authoritative Synchronized Playback
- Play, pause, seek, and video changes initiated by the host reflect on all participant screens within milliseconds.
- Periodic synchronization heartbeats (every 2-3 seconds) prevent temporal drift.
- Smart drift correction:
  - $|drift| < 500\text{ms}$: Silent tolerance (no stutter or audio distortion).
  - $500\text{ms} \le |drift| \le 2000\text{ms}$: Dynamic playback rate nudging (1.05x / 0.95x) for smooth micro-adjustment without audible pitch glitches.
  - $|drift| > 2000\text{ms}$: Seamless seek to authoritative timestamp.

### Feature 3: Modular Multi-Provider Video Playback
- **YouTube**: Integrated via the official YouTube IFrame Player API. Supports video IDs, standard YouTube URLs, and YouTube Shorts.
- **Direct Video URLs**: Supports standard HTML5 compatible web formats (MP4, WebM, HLS where natively supported).
- **Personal Video Uploads**: Direct uploads to Supabase Storage with size caps, secure signed URLs, and streaming playback.

### Feature 4: Real-Time Chat & Interactions
- Instant messaging inside the watch room powered by Supabase Realtime Postgres Changes.
- System announcements (e.g., "Alex joined the room", "Sarah paused the video", "Host changed video to...").
- Full chat history preserved per room session.

### Feature 5: Participant Presence & Roles
- Live viewer roster displaying active members, avatars, and roles (`Host`, `Co-Host`, `Viewer`).
- Client status indicators (Ready, Buffering, Playing, Idle).
- Host reassignment / migration if the host disconnects or transfers leadership.

### Feature 6: Responsive & Polished UX
- Desktop theater mode, full-screen player, collapsible chat drawer.
- Tablet and mobile-optimized layouts with touch-friendly controls.
- Handles browser autoplay restrictions (e.g. initial muted prompt when required by browser policies).

---

## 4. Non-Functional Requirements

- **Performance**: Initial page load under 1.5s; video sync drift maintained within $\pm 0.5\text{s}$ under typical consumer network conditions.
- **Reliability & Recovery**: Automatic recovery from backgrounded tabs, mobile screen locks, and transient network disconnects.
- **Scalability**: Capable of supporting dozens of concurrent viewers per room with near-zero server CPU load due to peer-directed Supabase Realtime Broadcast.
- **Security**: Strict Row-Level Security (RLS) on PostgreSQL tables; zero exposure of backend service credentials to client browsers.

