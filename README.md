# Syncora — Real-Time Duo Watch Party

> **Watch YouTube and personal videos together in real time with side-by-side live chat.**

Built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS v4**, and **Supabase** (PostgreSQL, Realtime, Storage).

---

## ✨ Features

- **💑 Crafted Intimately for Two**: Tailored for couples and friends with direct partner presence indicators (`Partner Connected`, `Partner Buffering`, `Waiting for Partner`).
- **⏱️ Host-Authoritative Playback Sync**: Real-time play, pause, seek, and rate adjustments via Supabase Realtime Broadcast (<50ms transit).
- **🎯 3-Tier Drift Reconciliation Algorithm**:
  - `<500ms`: In-sync deadband (no audio jitter).
  - `500ms - 2000ms`: Micro-drift rate nudging ($1.05\times / 0.95\times$) for smooth imperceptible catch-up.
  - `>2000ms`: Hard seek directly to authoritative timestamp.
- **💬 Persistent Side-by-Side Live Chat**: Chat throughout the entire movie/video without overlays covering the screen or pausing playback. Includes real-time typing indicators, sound notification chimes, and 1-click emoji reactions.
- **📺 Multi-Provider Video Playback**:
  - **YouTube**: Integrated via official YouTube IFrame Player API (standard links, Shorts, and IDs).
  - **Direct URLs**: Native HTML5 streaming for `.mp4` and `.webm` links.
  - **Personal Uploads**: Upload video clips directly to Supabase Storage with a 50MB file size cap.
- **🛡️ Auto-Failover Protocol**: 30-second grace period if the host disconnects; automatic promotion of the active partner to keep the party going.
- **📱 Responsive Theater Layout**: 70/30 split Theater Mode on desktop/tablets and stacked view on mobile.

---

## 🚀 Quickstart

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/syncora.git
cd syncora
npm install
```

### 2. Configure Environment Variables
```bash
cp .env.example .env.local
```
Fill in your Supabase credentials from your [Supabase Dashboard](https://supabase.com/dashboard) (Settings > API):
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Run Database Migrations
Copy the contents of [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) and execute it in your Supabase SQL Editor.

### 4. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🏗️ Architecture & Documentation

- [`AGENTS.md`](AGENTS.md) — Permanent agent coding standards and multi-chat operating constraints.
- [`PROJECT.md`](PROJECT.md) — Product requirements and non-functional specifications.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Detailed system architecture, timing models, and schema.
- [`DECISIONS.md`](DECISIONS.md) — Architectural Decision Records (ADRs 001–008).
- [`CURRENT_STATE.md`](CURRENT_STATE.md) — Active phase tracking and milestones.
- [`TASKS.md`](TASKS.md) — Full phase-by-phase implementation checklist.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Production deployment manual for Vercel and Supabase.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5 (Strict mode)
- **Styling**: Tailwind CSS v4
- **Backend & Realtime**: Supabase (PostgreSQL, Realtime Broadcast & Presence, Supabase Storage)
- **Video Providers**: YouTube IFrame Player API & Native HTML5 Media API
- **Deployment**: Vercel Serverless
