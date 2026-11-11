-- =============================================================================
-- Migration: 001_initial_schema.sql
-- Description: Core schema, Supabase Auth link, strict RLS, indexes, and rate limits
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- Directly linked to Supabase Auth (auth.users)
-- Compatible with Anonymous Auth and future OAuth / Email upgrades
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL CHECK (char_length(username) >= 1 AND char_length(username) <= 30),
    avatar_url TEXT,
    is_guest BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Index on profiles username
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- -----------------------------------------------------------------------------
-- 2. AUTOMATIC PROFILE PROVISIONING TRIGGER
-- Automatically provisions a public profile upon auth.users creation
-- Works for anonymous logins and future Google/Email accounts
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  initial_username TEXT;
BEGIN
  initial_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    'Guest-' || SUBSTRING(NEW.id::text FROM 1 FOR 4)
  );

  INSERT INTO public.profiles (id, username, is_guest)
  VALUES (
    NEW.id,
    initial_username,
    COALESCE(NEW.is_anonymous, true)
  )
  ON CONFLICT (id) DO UPDATE
  SET is_guest = EXCLUDED.is_guest,
      updated_at = TIMEZONE('utc', NOW());

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. ROOMS TABLE
-- Durable room metadata and authoritative playback snapshot
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
-- 4. ROOM MEMBERS TABLE
-- Room participants, roles (host, co-host, viewer), and presence tracking
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
-- 5. CHAT MESSAGES TABLE
-- Durable room chat history
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
-- 6. PERFORMANCE INDEXES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON public.rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON public.chat_messages(room_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- 7. HELPER FUNCTIONS & ROW LEVEL SECURITY (RLS) POLICIES
-- Strict non-permissive access controls with SECURITY DEFINER helpers
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Helper functions to avoid infinite recursion in RLS policies
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_host(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id AND host_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_host_or_cohost(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id AND host_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room_id
      AND user_id = p_user_id
      AND role IN ('host', 'co-host')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_room_member(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_room_host(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_room_host_or_cohost(UUID, UUID) TO authenticated, anon;

-- Profiles Policies
DROP POLICY IF EXISTS "Profiles are readable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles are readable by authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Rooms Policies
DROP POLICY IF EXISTS "Rooms are viewable by members or host" ON public.rooms;
CREATE POLICY "Rooms are viewable by members or host"
ON public.rooms FOR SELECT
TO authenticated
USING (
  NOT is_private
  OR host_id = auth.uid()
  OR public.is_room_member(id, auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can create rooms as host" ON public.rooms;
CREATE POLICY "Authenticated users can create rooms as host"
ON public.rooms FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Host and co-hosts can update room playback" ON public.rooms;
CREATE POLICY "Host and co-hosts can update room playback"
ON public.rooms FOR UPDATE
TO authenticated
USING (
  auth.uid() = host_id
  OR public.is_room_host_or_cohost(id, auth.uid())
)
WITH CHECK (
  auth.uid() = host_id
  OR public.is_room_host_or_cohost(id, auth.uid())
);

DROP POLICY IF EXISTS "Only host can delete room" ON public.rooms;
CREATE POLICY "Only host can delete room"
ON public.rooms FOR DELETE
TO authenticated
USING (auth.uid() = host_id);

-- Room Members Policies
DROP POLICY IF EXISTS "Room members are viewable by participants" ON public.room_members;
CREATE POLICY "Room members are viewable by participants"
ON public.room_members FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_room_member(room_id, auth.uid())
  OR public.is_room_host(room_id, auth.uid())
);

DROP POLICY IF EXISTS "Users can join rooms with proper role authorization" ON public.room_members;
CREATE POLICY "Users can join rooms with proper role authorization"
ON public.room_members FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    role = 'viewer'
    OR (role = 'host' AND public.is_room_host(room_id, auth.uid()))
  )
);

DROP POLICY IF EXISTS "Members can update presence or host can manage roles" ON public.room_members;
CREATE POLICY "Members can update presence or host can manage roles"
ON public.room_members FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  OR public.is_room_host(room_id, auth.uid())
)
WITH CHECK (
  auth.uid() = user_id
  OR public.is_room_host(room_id, auth.uid())
);

DROP POLICY IF EXISTS "Members can leave or host can remove members" ON public.room_members;
CREATE POLICY "Members can leave or host can remove members"
ON public.room_members FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  OR public.is_room_host(room_id, auth.uid())
);

-- Chat Messages Policies
DROP POLICY IF EXISTS "Room members can read chat messages" ON public.chat_messages;
CREATE POLICY "Room members can read chat messages"
ON public.chat_messages FOR SELECT
TO authenticated
USING (
  public.is_room_member(room_id, auth.uid())
  OR public.is_room_host(room_id, auth.uid())
);

DROP POLICY IF EXISTS "Active room members can insert messages" ON public.chat_messages;
CREATE POLICY "Active room members can insert messages"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    public.is_room_member(room_id, auth.uid())
    OR public.is_room_host(room_id, auth.uid())
  )
);

-- -----------------------------------------------------------------------------
-- 8. SAFE ROOM CODE LOOKUP (RPC)
-- Allows lookup by exact invitation code without exposing table listing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_room_by_code(p_code TEXT)
RETURNS SETOF public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.rooms
  WHERE code = UPPER(TRIM(p_code))
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_room_by_code(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. RATE LIMITING & ABUSE PREVENTION TRIGGERS
-- -----------------------------------------------------------------------------

-- Max 10 rooms per hour per user
CREATE OR REPLACE FUNCTION public.check_room_creation_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM public.rooms
    WHERE host_id = NEW.host_id
      AND created_at > NOW() - INTERVAL '1 hour'
  ) >= 10 THEN
    RAISE EXCEPTION 'Room creation rate limit exceeded. Max 10 rooms per hour.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_check_room_creation_rate ON public.rooms;
CREATE TRIGGER tr_check_room_creation_rate
  BEFORE INSERT ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.check_room_creation_rate();

-- Max 20 chat messages per 10 seconds per user
CREATE OR REPLACE FUNCTION public.check_chat_message_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM public.chat_messages
    WHERE user_id = NEW.user_id
      AND created_at > NOW() - INTERVAL '10 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'Chat rate limit exceeded. Please wait a moment before sending more messages.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_check_chat_message_rate ON public.chat_messages;
CREATE TRIGGER tr_check_chat_message_rate
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.check_chat_message_rate();
