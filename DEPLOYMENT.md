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

### Step 2: Run Database Migration
1. In your Supabase Dashboard, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open [`supabase/migrations/001_initial_schema.sql`](file:///home/sid/Desktop/Cinemate/supabase/migrations/001_initial_schema.sql) in this repository, copy the entire SQL content, and paste it into the editor.
4. Click **Run** (or `Ctrl+Enter`).
5. Confirm that the following tables were created with RLS enabled:
   - `profiles`
   - `rooms`
   - `room_members`
   - `chat_messages`
   - Realtime publication on `chat_messages`, `rooms`, and `room_members`.

### Step 3: Create Storage Bucket for Personal Videos
1. In your Supabase Dashboard, click **Storage** in the left sidebar.
2. Click **New Bucket**.
3. Name: `videos`
4. Set **Public Bucket**: **Enabled** (for seamless streaming access).
5. Set **File size limit**: `50MB` (as per ADR-007).
6. Set **Allowed MIME types**: `video/mp4, video/webm, video/ogg, video/quicktime`.
7. Click **Save**.

### Step 4: Retrieve API Credentials
1. In your Supabase Dashboard, navigate to **Project Settings** > **API**.
2. Note the following values:
   - **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - **anon / public key** (client-side JWT safe for browsers)
   - **service_role key** (secret key for server-side operations only)

---

## 2. Local Environment Setup

Create `.env.local` from the template:
```bash
cp .env.example .env.local
```

Fill in your actual Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi... (your public anon key)
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... (your service role key)
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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | Your public anon key |
| `NEXT_PUBLIC_APP_URL` | Production, Preview | `https://your-syncora-app.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | Your private service_role key |

> [!CAUTION]
> Never prefix `SUPABASE_SERVICE_ROLE_KEY` with `NEXT_PUBLIC_`. It must remain strictly server-side.

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
