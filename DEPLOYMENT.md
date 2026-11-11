# DEPLOYMENT.md — Syncora Production Deployment Guide

This guide details the complete production setup and deployment procedure for **Syncora** using **Supabase** (PostgreSQL, Realtime, Storage) and **Vercel** (Next.js App Router).

---

## 1. Supabase Backend Configuration

Syncora operates completely within Supabase's generous free tier (zero monthly cost).

### Step 1: Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Choose an organization, enter Name (e.g. `syncora`), set a secure database password, and select your preferred region.
4. Wait for database provisioning to finish (~1-2 minutes).

### Step 2: Run Database Migrations & Secure Realtime
1. In your Supabase Dashboard, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. For a fresh database, copy the entire contents of [`supabase/full_setup.sql`](file:///home/sid/Desktop/Cinemate/supabase/full_setup.sql) and click **Run**.
   *(For an existing database that already ran earlier migrations, apply `004_fix_rls_recursion.sql`, `005_realtime_authorization_and_membership_hardening.sql`, and `006_voice_call_authorization.sql` in order).*
4. Confirm all tables, triggers, RPCs, and Realtime publications (`rooms`, `room_members`, `chat_messages`, `room_call_participants`) are present.
5. **Critical Security Step (Private Realtime Enforcement):**
   - Navigate to **Supabase Dashboard → Realtime → Settings**.
   - Turn **OFF** **"Allow public access"** so clients cannot bypass `realtime.messages` RLS by opening public channels.

### Step 3: Verify Storage Bucket for Personal Videos
The SQL setup creates a **private** `videos` bucket (`public = false`, `50MB` file limit, signed URLs scoped to verified room members via `storage.objects` RLS). Confirm the `videos` bucket appears under **Storage** in your Supabase Dashboard.

### Step 4: Configure Cloudflare Realtime TURN (Required for Production Voice Calls)
While local same-LAN development works in STUN-only fallback mode, **STUN-only is NOT production-ready** (mobile carrier CGNAT such as Jio 4G/5G and corporate firewalls frequently block direct P2P UDP).
1. In the **Cloudflare Dashboard**, navigate to **Calls / Realtime → TURN Keys** and create a new TURN key.
2. Copy the **Key ID** (`CLOUDFLARE_TURN_KEY_ID`) and **API Token** (`CLOUDFLARE_TURN_API_TOKEN`).
3. Keep both strictly server-side (never prefix with `NEXT_PUBLIC_`).

### Step 5: Retrieve Supabase API Credentials
1. In your Supabase Dashboard, navigate to **Project Settings** > **API Keys**.
2. Note the following values:
   - **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - **Publishable key** (`sb_publishable_...`, client-side key safe for browsers)
   - **Secret key** (`sb_secret_...`, privileged secret key for server-side operations only)
   *(Legacy `anon` and `service_role` keys are also supported via backward-compatibility fallbacks).*

---

## 2. Local Environment Setup

Create `.env.local` from the template:
```bash
cp .env.example .env.local
```

Fill in your actual Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... (your publishable key)
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SECRET_KEY=sb_secret_... (your secret key)
```

Run the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 3. Vercel Deployment

Syncora is optimized for serverless edge deployment on Vercel.

### Step 1: Push Repository to GitHub
```bash
git remote add origin https://github.com/your-username/syncora.git
git branch -M main
git push -u origin main
```

### Step 2: Import into Vercel
1. Log in to [vercel.com](https://vercel.com).
2. Click **Add New...** > **Project**.
3. Import your `syncora` GitHub repository.
4. Framework Preset: **Next.js** (automatically detected).

### Step 3: Set Production Environment Variables
Under the **Environment Variables** section in Vercel, configure:

| Variable Name | Environment | Value |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | `https://your-project-ref.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview | Your publishable key (`sb_publishable_...`) |
| `NEXT_PUBLIC_APP_URL` | Production, Preview | `https://your-syncora-app.vercel.app` |
| `SUPABASE_SECRET_KEY` | Production, Preview | Your secret key (`sb_secret_...`) |
| `CRON_SECRET` | Production, Preview | Random secret (`openssl rand -hex 32`) protecting `/api/cron/cleanup` |
| `CLOUDFLARE_TURN_KEY_ID` | Production, Preview | Cloudflare Realtime TURN Key ID (required for prod voice) |
| `CLOUDFLARE_TURN_API_TOKEN` | Production, Preview | Cloudflare Realtime TURN API Token (required for prod voice) |
| `TURN_CREDENTIAL_TTL_SECONDS` | Production, Preview | Optional (`3600` default) |

> [!CAUTION]
> Never prefix `SUPABASE_SECRET_KEY`, `CRON_SECRET`, or `CLOUDFLARE_TURN_*` with `NEXT_PUBLIC_`. They must remain strictly server-side.

### Step 4: Deploy
Click **Deploy**. Vercel will build and deploy the Next.js App Router application.

---

## 4. Multi-Device & Mobile Browser Verification

### Testing Scenarios:
1. **Multi-Tab / Multi-Window Test**:
   - Open [http://localhost:3000](http://localhost:3000) in Window 1. Create a room.
   - Copy the partner invite link and open in an Incognito / Private Window (Window 2).
   - Enter a display name in both windows.
   - Play/pause/seek a YouTube video in Window 1 (Host). Verify Window 2 (Viewer) mirrors state within 50ms.
   - Send chat messages and quick emoji reactions in both windows.
2. **Mobile & Autoplay Policy**:
   - Mobile browsers (Safari on iOS, Chrome on Android) require user interaction before playing unmuted audio.
   - Syncora automatically handles this: if autoplay is restricted, the player starts muted with a visible tap-to-unmute control.
3. **Tab Backgrounding & Resync**:
   - Switch tabs in Window 2 for 30 seconds while Window 1 plays video.
   - Return to Window 2. The `visibilitychange` listener immediately issues `REQUEST_SYNC` and aligns video within 1 heartbeat.
4. **Host Disconnection Grace Period**:
   - Close Window 1 (Host).
   - Window 2 immediately enters a 30-second amber countdown banner.
   - If Window 1 reopens within 30 seconds, Host control resumes.
   - If 30 seconds elapse, Window 2 is automatically promoted to Host.

---

## 5. Two-Person Voice Call Pre-Production Verification Checklist

Run these checks after applying `005` + `006`, disabling Realtime public access, and deploying with `CLOUDFLARE_TURN_*` env vars on HTTPS:

1. **Two-User Voice + Waiting State**: User A clicks **Join Voice** (`1/2`, waiting). User B sees `"A is on voice"`, clicks **Join**, both connect (`Live · P2P` or `Live · Relayed`) with live speaking rings.
2. **2-Person Call Cap Inside 4-Viewer Room**: User C (3rd room viewer) sees `Voice Full 2/2` (and if racing User B concurrently, only 2 succeed while the 3rd receives `"Voice call is full (2/2 participants active)."`). Chat and video sync continue working for all viewers.
3. **Cross-Network Jio ↔ Wi-Fi Test**: User A on laptop Wi-Fi and User B on mobile Jio 4G/5G join voice; verify bidirectional audio connects cleanly via Cloudflare `turns:443` relay.
4. **Mic Denial, Mute & Autoplay**: Deny mic permission -> verify `PERMISSION_DENIED` banner appears and slot is **not** occupied. Allow mic -> toggle Mute/Unmute -> verify remote mute icon updates immediately. If mobile blocks remote autoplay, tap `"Tap to enable partner audio"`.
5. **Playback Independence**: While voice call is active, host changes YouTube video, uploads/plays an HTML5 clip, seeks, and pauses -> verify voice audio stays connected without interruption.
6. **Simultaneous Join, Network Drop & Exit Cleanup**: Both users click **Join Voice** simultaneously (Perfect Negotiation resolves cleanly). Toggle airplane mode briefly on mobile -> verify `Reconnecting…` recovers automatically. Refresh or close tab -> verify `room_call_participants` slot releases immediately (or within 60s on hard power-off) so another user can join.
7. **Unauthorized Access Verification**: Confirm unauthenticated `POST /api/rooms/<id>/call/ice-servers` returns HTTP `401` JSON, non-members receive `403`, and non-member Realtime channel subscriptions to `room:<id>` or `call:<id>:<user>` fail with `CHANNEL_ERROR`.

