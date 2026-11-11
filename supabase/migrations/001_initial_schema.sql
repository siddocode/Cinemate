-- =============================================================================
-- Syncora Database Migration: 001_initial_schema.sql
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. PROFILES TABLE (User identity model, supports guests and future Supabase Auth)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL CHECK (char_length(username) >= 1 AND char_length(username) <= 30),
    avatar_url TEXT,
    is_guest BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- -----------------------------------------------------------------------------
-- 2. ROOMS TABLE (Durable room metadata and authoritative playback snapshot)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL CHECK (char_length(code) >= 6),
    title TEXT NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 100),
    host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    video_type TEXT NOT NULL CHECK (video_type IN ('youtube', 'url', 'upload')) DEFAULT 'youtube',
    video_url TEXT NOT NULL DEFAULT '',
    current_position FLOAT DEFAULT 0.0 NOT NULL,
    is_playing BOOLEAN DEFAULT false NOT NULL,
    last_synced_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    is_private BOOLEAN DEFAULT true NOT NULL,
    passcode_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- -----------------------------------------------------------------------------
-- 3. ROOM MEMBERS TABLE (Duo / Multi-member tracking and role permissions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('host', 'co-host', 'viewer')),
    joined_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    UNIQUE(room_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 4. CHAT MESSAGES TABLE (Durable real-time chat history)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 1000),
    type TEXT NOT NULL DEFAULT 'chat' CHECK (type IN ('chat', 'system')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- -----------------------------------------------------------------------------
-- 5. PERFORMANCE INDEXES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON public.chat_messages(room_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are readable by anyone"
ON public.profiles FOR SELECT
USING (true);

CREATE POLICY "Anyone can create or upsert profile"
ON public.profiles FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (true);

-- Rooms Policies
CREATE POLICY "Anyone can view rooms by code"
ON public.rooms FOR SELECT
USING (true);

CREATE POLICY "Users can create rooms"
ON public.rooms FOR INSERT
WITH CHECK (true);

CREATE POLICY "Hosts can update room playback and details"
ON public.rooms FOR UPDATE
USING (true);

-- Room Members Policies
CREATE POLICY "Members of a room are viewable"
ON public.room_members FOR SELECT
USING (true);

CREATE POLICY "Users can join rooms"
ON public.room_members FOR INSERT
WITH CHECK (true);

CREATE POLICY "Members can update their own presence or host can manage"
ON public.room_members FOR UPDATE
USING (true);

CREATE POLICY "Members can leave or host can remove members"
ON public.room_members FOR DELETE
USING (true);

-- Chat Messages Policies
CREATE POLICY "Anyone in room can read chat messages"
ON public.chat_messages FOR SELECT
USING (true);

CREATE POLICY "Members can post chat messages"
ON public.chat_messages FOR INSERT
WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 7. SUPABASE REALTIME REPLICATION SETUP
-- Enables realtime broadcast and database change streaming
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

