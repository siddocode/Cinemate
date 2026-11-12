-- =============================================================================
-- SYNCORA FULL DATABASE SETUP SCRIPT (supabase/full_setup.sql)
-- Copy and run this entire script in your Supabase SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> Paste & Click RUN
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 2. PROFILES TABLE (Linked to Supabase Auth)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL CHECK (char_length(username) >= 1 AND char_length(username) <= 30),
    avatar_url TEXT,
    is_guest BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- -----------------------------------------------------------------------------
-- 3. AUTOMATIC PROFILE PROVISIONING & EMAIL CONFIRMATION TRIGGERS
-- -----------------------------------------------------------------------------
-- Auto-confirm user emails on signup (frictionless dev & testing)
CREATE OR REPLACE FUNCTION public.auto_confirm_new_users()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_auto_confirm_new_users ON auth.users;
CREATE TRIGGER tr_auto_confirm_new_users
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_new_users();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  initial_username TEXT;
BEGIN
  initial_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    SPLIT_PART(NEW.email, '@', 1),
    'Guest-' || SUBSTRING(NEW.id::text FROM 1 FOR 4)
  );

  INSERT INTO public.profiles (id, username, is_guest)
  VALUES (
    NEW.id,
    initial_username,
    COALESCE(NEW.is_anonymous, false)
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
-- 4. ROOMS TABLE
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
    allow_guest_control BOOLEAN DEFAULT false NOT NULL,
    allow_guest_call BOOLEAN DEFAULT false NOT NULL,
    kicked_user_ids UUID[] DEFAULT '{}'::uuid[] NOT NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON public.rooms(host_id);

-- Ensure upgrade idempotency if public.rooms already existed before migrations 003 / 007 / 010
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS allow_guest_control BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS allow_guest_call BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS kicked_user_ids UUID[] DEFAULT '{}'::uuid[] NOT NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- 5. ROOM MEMBERS TABLE
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

CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members(user_id);

-- -----------------------------------------------------------------------------
-- 6. CHAT MESSAGES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 1000),
    type TEXT NOT NULL DEFAULT 'chat' CHECK (type IN ('chat', 'system')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON public.chat_messages(room_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- 7. STORAGE USAGE METRICS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.storage_usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size_bytes BIGINT NOT NULL,
    estimated_egress_bytes BIGINT DEFAULT 0 NOT NULL,
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_storage_metrics_user ON public.storage_usage_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_storage_metrics_room ON public.storage_usage_metrics(room_id);
CREATE INDEX IF NOT EXISTS idx_storage_metrics_deleted ON public.storage_usage_metrics(is_deleted);

-- -----------------------------------------------------------------------------
-- 8. REPLICA IDENTITY FOR REALTIME
-- -----------------------------------------------------------------------------
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_members REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

-- -----------------------------------------------------------------------------
-- 8b. HELPER FUNCTIONS FOR RLS (SECURITY DEFINER to avoid recursion)
-- -----------------------------------------------------------------------------
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

-- Host authority is derived ONLY from rooms.host_id (a stale room_members.role = 'host'
-- after a host transfer grants nothing). Co-host remains a delegated member role.
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
      AND role = 'co-host'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_room_member(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_room_host(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_room_host_or_cohost(UUID, UUID) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_usage_metrics ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Host, co-hosts or permitted members can update room playback" ON public.rooms;
DROP POLICY IF EXISTS "Host and co-hosts can update room playback" ON public.rooms;
CREATE POLICY "Host, co-hosts or permitted members can update room playback"
ON public.rooms FOR UPDATE
TO authenticated
USING (
  auth.uid() = host_id
  OR (
    NOT (auth.uid() = ANY(COALESCE(kicked_user_ids, '{}'::uuid[])))
    AND (
      public.is_room_host_or_cohost(id, auth.uid())
      OR (allow_guest_control = true AND public.is_room_member(id, auth.uid()))
    )
  )
)
WITH CHECK (
  auth.uid() = host_id
  OR (
    NOT (auth.uid() = ANY(COALESCE(kicked_user_ids, '{}'::uuid[])))
    AND (
      public.is_room_host_or_cohost(id, auth.uid())
      OR (allow_guest_control = true AND public.is_room_member(id, auth.uid()))
    )
  )
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

-- Storage Metrics Policies
DROP POLICY IF EXISTS "Users can view their own storage metrics" ON public.storage_usage_metrics;
CREATE POLICY "Users can view their own storage metrics"
ON public.storage_usage_metrics FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can record storage metrics for own uploads" ON public.storage_usage_metrics;
CREATE POLICY "Authenticated users can record storage metrics for own uploads"
ON public.storage_usage_metrics FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 10. RPC FUNCTIONS
-- -----------------------------------------------------------------------------

-- Safe room code lookup RPC
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

GRANT EXECUTE ON FUNCTION public.lookup_room_by_code(TEXT) TO authenticated, anon;

-- Video egress increment RPC
CREATE OR REPLACE FUNCTION public.increment_video_egress(p_file_path TEXT, p_bytes BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.storage_usage_metrics
  SET estimated_egress_bytes = estimated_egress_bytes + p_bytes
  WHERE file_path = p_file_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_video_egress(TEXT, BIGINT) TO authenticated, anon;

-- Expired videos retrieval query
CREATE OR REPLACE FUNCTION public.get_expired_videos()
RETURNS TABLE (
  metric_id UUID,
  file_path TEXT,
  file_size_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.file_path,
    m.file_size_bytes
  FROM public.storage_usage_metrics m
  LEFT JOIN public.rooms r ON m.room_id = r.id
  WHERE m.is_deleted = false
    AND (
      (r.closed_at IS NOT NULL AND r.closed_at < NOW() - INTERVAL '24 hours')
      OR (r.last_synced_at < NOW() - INTERVAL '7 days')
      OR (r.id IS NULL AND m.created_at < NOW() - INTERVAL '7 days')
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RATE LIMITING & ABUSE PREVENTION TRIGGERS
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

-- -----------------------------------------------------------------------------
-- 12. STORAGE BUCKET & STORAGE RLS
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'videos',
  'videos',
  false,
  52428800, -- 50MB
  ARRAY['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

DROP POLICY IF EXISTS "Room hosts and co-hosts can upload video" ON storage.objects;
CREATE POLICY "Room hosts and co-hosts can upload video"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'videos'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_room_host_or_cohost(((storage.foldername(name))[1])::uuid, auth.uid())
);

DROP POLICY IF EXISTS "Room members can read video files via signed URL" ON storage.objects;
CREATE POLICY "Room members can read video files via signed URL"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'videos'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND (
    public.is_room_member(((storage.foldername(name))[1])::uuid, auth.uid())
    OR public.is_room_host(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

DROP POLICY IF EXISTS "Room host can delete room video files" ON storage.objects;
CREATE POLICY "Room host can delete room video files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'videos'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_room_host(((storage.foldername(name))[1])::uuid, auth.uid())
);

-- -----------------------------------------------------------------------------
-- 13. REALTIME PUBLICATION SETUP
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

-- -----------------------------------------------------------------------------
-- 14. USER FAVORITES TABLE & POLICIES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    room_code TEXT,
    video_id TEXT NOT NULL,
    video_title TEXT NOT NULL,
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    UNIQUE(user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON public.user_favorites(user_id);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own favorites" ON public.user_favorites;
CREATE POLICY "Users can read their own favorites"
ON public.user_favorites FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own favorites" ON public.user_favorites;
CREATE POLICY "Users can insert their own favorites"
ON public.user_favorites FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own favorites" ON public.user_favorites;
CREATE POLICY "Users can delete their own favorites"
ON public.user_favorites FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 15. TABLE & SCHEMA PERMISSIONS (GRANTS)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 16. PHASE 10.1 SECURITY FOUNDATION (mirrors migrations/005_realtime_authorization_and_membership_hardening.sql)
--     Realtime Authorization for private room channels, server-side room capacity,
--     membership escalation guard and function privilege hardening.
--     MUST stay after section 15 so the REVOKEs override the broad GRANTs above.
--     After running: Dashboard -> Realtime -> Settings -> disable "Allow public access".
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 2. REALTIME TOPIC AUTHORIZATION HELPER (G1)
--    Uses auth.uid() internally (no user-id parameter) so callers cannot probe
--    other users' memberships. Accepts only strictly formatted topics.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_room_topic(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room_id UUID;
BEGIN
  IF v_uid IS NULL OR p_topic IS NULL OR char_length(p_topic) > 64 THEN
    RETURN FALSE;
  END IF;

  IF p_topic !~ '^(room|room_chat):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;

  v_room_id := split_part(p_topic, ':', 2)::uuid;

  RETURN public.is_room_member(v_room_id, v_uid)
      OR public.is_room_host(v_room_id, v_uid);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. REALTIME AUTHORIZATION POLICIES ON realtime.messages (G1)
--    SELECT  = receive broadcasts / presence
--    INSERT  = send broadcasts / track presence
--    Applies to private channels only. Public channels must be disabled in the
--    dashboard ("Allow public access" = off) for this to be fully enforced.
-- -----------------------------------------------------------------------------
-- Replace legacy 002 policies (which lacked extension checks and strict topic parsing)
DROP POLICY IF EXISTS "Members can receive realtime room messages" ON realtime.messages;
DROP POLICY IF EXISTS "Members can broadcast realtime room messages" ON realtime.messages;

DROP POLICY IF EXISTS "syncora_room_members_can_receive" ON realtime.messages;
CREATE POLICY "syncora_room_members_can_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND public.can_access_room_topic((SELECT realtime.topic()))
);

DROP POLICY IF EXISTS "syncora_room_members_can_send" ON realtime.messages;
CREATE POLICY "syncora_room_members_can_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND public.can_access_room_topic((SELECT realtime.topic()))
);

-- Warn (do not drop) if pre-existing permissive policies would widen access.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname NOT LIKE 'syncora_%'
  LOOP
    RAISE NOTICE 'Review existing realtime.messages policy "%": permissive policies are OR-ed with Syncora policies and may widen channel access.', r.policyname;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. SERVER-SIDE ROOM CAPACITY (G3) — concurrency safe
--    A per-room transaction-scoped advisory lock serializes concurrent joins, so
--    two simultaneous joins cannot both observe count = 3. Existing members
--    (upsert ON CONFLICT path) are always allowed through.
--    Keep in sync with SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS (4).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_room_member_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max CONSTANT INTEGER := 4;
  v_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:room_members:' || NEW.room_id::text, 0)
  );

  -- Upsert of an existing membership (BEFORE INSERT fires before ON CONFLICT)
  IF EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = NEW.room_id AND user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.room_members
  WHERE room_id = NEW.room_id;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Room has reached its maximum capacity (%/%).', v_max, v_max
      USING ERRCODE = 'P0001', HINT = 'ROOM_FULL';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_room_member_capacity ON public.room_members;
CREATE TRIGGER tr_enforce_room_member_capacity
  BEFORE INSERT ON public.room_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_member_capacity();

-- -----------------------------------------------------------------------------
-- 4b. ALLOW REJOIN AS VIEWER-ONLY FOR KICKED USERS (NEVER CO-HOST OR CONTROL AUTHORITY)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_check_kicked_member_rejoin ON public.room_members;
DROP FUNCTION IF EXISTS public.check_kicked_member_rejoin();

CREATE OR REPLACE FUNCTION public.enforce_kicked_member_viewer_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kicked UUID[];
  v_host_id UUID;
BEGIN
  SELECT kicked_user_ids, host_id INTO v_kicked, v_host_id
  FROM public.rooms
  WHERE id = NEW.room_id;

  IF v_kicked IS NOT NULL AND NEW.user_id = ANY(v_kicked) AND NEW.user_id <> v_host_id THEN
    IF TG_OP = 'INSERT' THEN
      NEW.role := 'viewer';
    ELSIF NEW.role IS DISTINCT FROM 'viewer' THEN
      RAISE EXCEPTION 'Previously kicked participants cannot be promoted to Co-Host or granted playback authority.'
        USING ERRCODE = '42501', HINT = 'RESTRICTED_VIEWER';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_kicked_member_viewer_only ON public.room_members;
CREATE TRIGGER tr_enforce_kicked_member_viewer_only
  BEFORE INSERT OR UPDATE ON public.room_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kicked_member_viewer_only();

-- -----------------------------------------------------------------------------
-- 4c. GUARD AGAINST NON-HOSTS MODIFYING ROOM SETTINGS OR KICKED LIST
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_room_settings_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_uid <> OLD.host_id THEN
    IF NEW.allow_guest_control IS DISTINCT FROM OLD.allow_guest_control
       OR NEW.allow_guest_call IS DISTINCT FROM OLD.allow_guest_call
       OR NEW.kicked_user_ids IS DISTINCT FROM OLD.kicked_user_ids
       OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.is_private IS DISTINCT FROM OLD.is_private
       OR NEW.passcode_hash IS DISTINCT FROM OLD.passcode_hash THEN
      RAISE EXCEPTION 'Only the room host can modify room settings, permissions, or kicked members.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.host_id IS DISTINCT FROM OLD.host_id
       AND NOT public.is_room_host_or_cohost(OLD.id, v_uid) THEN
      RAISE EXCEPTION 'Only the room host or co-host can transfer room ownership.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_room_settings_update ON public.rooms;
CREATE TRIGGER tr_guard_room_settings_update
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.guard_room_settings_update();

-- -----------------------------------------------------------------------------
-- 5. ROOM MEMBERSHIP UPDATE GUARD (G8)
--    - room_id / user_id are immutable for end users.
--    - joined_at is preserved.
--    - Role changes: only the room host (rooms.host_id) may change roles; the
--      'host' role may only be assigned to the actual rooms.host_id; any member
--      may demote THEMSELVES to 'viewer'.
--    Privileged contexts (service role / SQL editor, auth.uid() IS NULL) bypass.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_room_member_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Room membership identity cannot be changed.'
      USING ERRCODE = '42501';
  END IF;

  NEW.joined_at := OLD.joined_at;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF public.is_room_host(NEW.room_id, v_uid) THEN
      IF NEW.role = 'host' AND NOT public.is_room_host(NEW.room_id, NEW.user_id) THEN
        RAISE EXCEPTION 'The host role can only be held by the room owner. Transfer rooms.host_id first.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.role = 'viewer' AND NEW.user_id = v_uid THEN
      NULL; -- self-demotion is always allowed
    ELSE
      RAISE EXCEPTION 'Only the room host can change participant roles.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_room_member_update ON public.room_members;
CREATE TRIGGER tr_guard_room_member_update
  BEFORE UPDATE ON public.room_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_room_member_update();

-- -----------------------------------------------------------------------------
-- 6. FUNCTION EXECUTION PRIVILEGES (G10)
--    All Syncora RLS policies target `authenticated`; `anon` never needs these.
--    Functions are executable by PUBLIC by default, so revoke from PUBLIC too.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.is_room_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_room_host(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_room_host_or_cohost(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_room_topic(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lookup_room_by_code(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_video_egress(TEXT, BIGINT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_expired_videos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_room_member_capacity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_room_member_update() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_room_member(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_room_host(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_room_host_or_cohost(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_room_topic(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_room_by_code(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_video_egress(TEXT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_expired_videos() TO service_role;

-- -----------------------------------------------------------------------------
-- 17. PHASE 10.2 TWO-PERSON VOICE CALL AUTHORIZATION (mirrors migrations/006_voice_call_authorization.sql)
--     Enforces MAX 2 callers per room atomically, locks 1:1 signaling topics to
--     active callers, and adds Postgres-backed TURN credential rate limiting.
--     MUST stay after section 15 so explicit REVOKEs override ALTER DEFAULT PRIVILEGES.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1. ACTIVE VOICE CALL SLOT REGISTRY (MAX 2 PARTICIPANTS PER ROOM)
--    Stores ONLY slot occupancy & server-issued call_session_id (no SDP/ICE/audio).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_call_participants (
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    call_session_id UUID NOT NULL DEFAULT gen_random_uuid(),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_call_participants_room_hb
  ON public.room_call_participants(room_id, last_heartbeat_at);

ALTER TABLE public.room_call_participants REPLICA IDENTITY FULL;
ALTER TABLE public.room_call_participants ENABLE ROW LEVEL SECURITY;

-- Room members (up to 4) can see who is currently in the 2-person voice call.
-- No INSERT/UPDATE/DELETE policies are granted to authenticated: all mutations
-- go strictly through the atomic SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "Room members can view active call participants" ON public.room_call_participants;
CREATE POLICY "Room members can view active call participants"
ON public.room_call_participants
FOR SELECT
TO authenticated
USING (
  public.is_room_member(room_id, auth.uid())
  OR public.is_room_host(room_id, auth.uid())
);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_call_participants;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- -----------------------------------------------------------------------------
-- 2. ACTIVE CALL PARTICIPANT HELPER (60s HEARTBEAT TTL)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_room_call_participant(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_call_participants
    WHERE room_id = p_room_id
      AND user_id = p_user_id
      AND last_heartbeat_at >= TIMEZONE('utc', NOW()) - INTERVAL '60 seconds'
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. ATOMIC 2-PERSON CALL JOIN / HEARTBEAT / LEAVE RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_room_call(p_room_id UUID)
RETURNS TABLE (
    room_id UUID,
    user_id UUID,
    call_session_id UUID,
    joined_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_max CONSTANT INTEGER := 4;
  v_count INTEGER;
  v_already_in BOOLEAN;
  v_host_expired BOOLEAN := FALSE;
  v_is_host BOOLEAN := FALSE;
  v_allow_guest_call BOOLEAN := FALSE;
  v_kicked UUID[] := '{}'::uuid[];
  v_is_restricted BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
BEGIN
  IF v_uid IS NULL OR p_room_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and valid room ID required.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_room_member(p_room_id, v_uid) OR public.is_room_host(p_room_id, v_uid)) THEN
    RAISE EXCEPTION 'Only room members can join voice calls.'
      USING ERRCODE = '42501', HINT = 'NOT_ROOM_MEMBER';
  END IF;

  -- Serialize concurrent join attempts for this room's 4-slot voice mesh
  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:room_call:' || p_room_id::text, 0)
  );

  -- If the host's active slot went stale (>60s), end the entire previous call
  SELECT EXISTS (
    SELECT 1 FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id
      AND public.is_room_host(p_room_id, rcp.user_id)
      AND rcp.last_heartbeat_at < v_now - INTERVAL '60 seconds'
  ) INTO v_host_expired;

  IF v_host_expired THEN
    DELETE FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id;
  ELSE
    -- Reclaim crashed/abandoned slots older than 60s before checking capacity
    DELETE FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id
      AND rcp.last_heartbeat_at < v_now - INTERVAL '60 seconds';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id AND rcp.user_id = v_uid
  ) INTO v_already_in;

  SELECT COUNT(*) INTO v_count
  FROM public.room_call_participants rcp
  WHERE rcp.room_id = p_room_id;

  -- Only permitted initiators may start a new call when none is active (v_count = 0)
  IF v_count = 0 THEN
    v_is_host := public.is_room_host(p_room_id, v_uid);
    SELECT COALESCE(r.allow_guest_call, false), COALESCE(r.kicked_user_ids, '{}'::uuid[])
    INTO v_allow_guest_call, v_kicked
    FROM public.rooms r
    WHERE r.id = p_room_id;

    v_is_restricted := NOT v_is_host AND (v_uid = ANY(v_kicked));

    IF NOT (
      v_is_host
      OR (
        NOT v_is_restricted
        AND (v_allow_guest_call OR public.is_room_host_or_cohost(p_room_id, v_uid))
      )
    ) THEN
      RAISE EXCEPTION 'Only the room host or permitted members can start a voice call.'
        USING ERRCODE = '42501', HINT = 'CALL_START_NOT_ALLOWED';
    END IF;
  END IF;

  IF NOT v_already_in AND v_count >= v_max THEN
    RAISE EXCEPTION 'Voice call is full (%/%).', v_max, v_max
      USING ERRCODE = 'P0001', HINT = 'CALL_FULL';
  END IF;

  INSERT INTO public.room_call_participants AS rcp (
    room_id,
    user_id,
    call_session_id,
    joined_at,
    last_heartbeat_at
  )
  VALUES (
    p_room_id,
    v_uid,
    gen_random_uuid(),
    v_now,
    v_now
  )
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET call_session_id = gen_random_uuid(),
      last_heartbeat_at = v_now;

  RETURN QUERY
  SELECT
    rcp.room_id,
    rcp.user_id,
    rcp.call_session_id,
    rcp.joined_at,
    rcp.last_heartbeat_at
  FROM public.room_call_participants rcp
  WHERE rcp.room_id = p_room_id
  ORDER BY rcp.joined_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_room_call(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_row_count INTEGER := 0;
  v_host_expired BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR p_room_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (public.is_room_member(p_room_id, v_uid) OR public.is_room_host(p_room_id, v_uid)) THEN
    DELETE FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id AND rcp.user_id = v_uid;
    RETURN FALSE;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:room_call:' || p_room_id::text, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id
      AND public.is_room_host(p_room_id, rcp.user_id)
      AND rcp.last_heartbeat_at < v_now - INTERVAL '60 seconds'
  ) INTO v_host_expired;

  IF v_host_expired THEN
    DELETE FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id;
    RETURN FALSE;
  END IF;

  DELETE FROM public.room_call_participants rcp
  WHERE rcp.room_id = p_room_id
    AND rcp.last_heartbeat_at < v_now - INTERVAL '60 seconds';

  UPDATE public.room_call_participants rcp
  SET last_heartbeat_at = v_now
  WHERE rcp.room_id = p_room_id
    AND rcp.user_id = v_uid;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_room_call(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_room_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:room_call:' || p_room_id::text, 0)
  );

  -- Host leaving voice ends the entire room voice call for all participants
  IF public.is_room_host(p_room_id, v_uid) THEN
    DELETE FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id;
  ELSE
    DELETE FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id
      AND rcp.user_id = v_uid;
  END IF;
END;
$$;

-- Automatically free voice call slots when a member leaves; if host leaves, end for all
CREATE OR REPLACE FUNCTION public.cleanup_call_on_member_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_room_host(OLD.room_id, OLD.user_id) THEN
    DELETE FROM public.room_call_participants
    WHERE room_id = OLD.room_id;
  ELSE
    DELETE FROM public.room_call_participants
    WHERE room_id = OLD.room_id AND user_id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_cleanup_call_on_member_leave ON public.room_members;
CREATE TRIGGER tr_cleanup_call_on_member_leave
  AFTER DELETE ON public.room_members
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_call_on_member_leave();

-- -----------------------------------------------------------------------------
-- 4. CALL SIGNALING & ROSTER REALTIME AUTHORIZATION (ANTI-SPOOFING)
--    - `call:<room_uuid>:<sender_uuid>`:
--        INSERT: extension = 'broadcast', auth.uid() = sender_uuid, active room
--                member AND active caller in room_call_participants.
--        SELECT: extension = 'broadcast', active room member AND active caller
--                in room_call_participants.
--    - `callroster:<room_uuid>`:
--        INSERT: extension = 'presence', active room member AND active caller.
--        SELECT: extension = 'presence', active room member.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_receive_call_topic(p_topic TEXT, p_extension TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room_id UUID;
BEGIN
  IF v_uid IS NULL OR p_topic IS NULL OR char_length(p_topic) > 96 THEN
    RETURN FALSE;
  END IF;

  IF p_extension = 'broadcast'
     AND p_topic ~ '^call:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_room_id := split_part(p_topic, ':', 2)::uuid;
    RETURN (public.is_room_member(v_room_id, v_uid) OR public.is_room_host(v_room_id, v_uid))
       AND public.is_room_call_participant(v_room_id, v_uid);
  END IF;

  IF p_extension = 'presence'
     AND p_topic ~ '^callroster:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_room_id := split_part(p_topic, ':', 2)::uuid;
    RETURN public.is_room_member(v_room_id, v_uid)
        OR public.is_room_host(v_room_id, v_uid);
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_send_call_topic(p_topic TEXT, p_extension TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room_id UUID;
  v_sender_id UUID;
BEGIN
  IF v_uid IS NULL OR p_topic IS NULL OR char_length(p_topic) > 96 THEN
    RETURN FALSE;
  END IF;

  IF p_extension = 'broadcast'
     AND p_topic ~ '^call:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_room_id := split_part(p_topic, ':', 2)::uuid;
    v_sender_id := split_part(p_topic, ':', 3)::uuid;
    RETURN v_uid = v_sender_id
       AND (public.is_room_member(v_room_id, v_uid) OR public.is_room_host(v_room_id, v_uid))
       AND public.is_room_call_participant(v_room_id, v_uid);
  END IF;

  IF p_extension = 'presence'
     AND p_topic ~ '^callroster:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_room_id := split_part(p_topic, ':', 2)::uuid;
    RETURN (public.is_room_member(v_room_id, v_uid) OR public.is_room_host(v_room_id, v_uid))
       AND public.is_room_call_participant(v_room_id, v_uid);
  END IF;

  RETURN FALSE;
END;
$$;

DROP POLICY IF EXISTS "syncora_call_members_can_receive" ON realtime.messages;
CREATE POLICY "syncora_call_members_can_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.can_receive_call_topic((SELECT realtime.topic()), realtime.messages.extension)
);

DROP POLICY IF EXISTS "syncora_call_members_can_send" ON realtime.messages;
CREATE POLICY "syncora_call_members_can_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_send_call_topic((SELECT realtime.topic()), realtime.messages.extension)
);

-- -----------------------------------------------------------------------------
-- 5. SERVER-SIDE RATE LIMITING FOR TURN / ICE CREDENTIAL REQUESTS
--    Stores only (user_id, room_id, created_at). Never stores SDP, ICE, or TURN secrets.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_credential_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_call_cred_req_user_created
  ON public.call_credential_requests(user_id, created_at DESC);

ALTER TABLE public.call_credential_requests ENABLE ROW LEVEL SECURITY;
-- Intentionally NO RLS policies for anon/authenticated: only accessed via SECURITY DEFINER RPC.

CREATE OR REPLACE FUNCTION public.check_and_record_call_credential_request(
    p_room_id UUID,
    p_max_requests INTEGER DEFAULT 12,
    p_window_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_window_start TIMESTAMPTZ;
  v_recent_count INTEGER;
  v_max INTEGER := GREATEST(1, LEAST(COALESCE(p_max_requests, 12), 60));
  v_window INTEGER := GREATEST(30, LEAST(COALESCE(p_window_seconds, 600), 3600));
BEGIN
  IF v_uid IS NULL OR p_room_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (public.is_room_member(p_room_id, v_uid) OR public.is_room_host(p_room_id, v_uid)) THEN
    RETURN FALSE;
  END IF;

  IF NOT public.is_room_call_participant(p_room_id, v_uid) THEN
    RETURN FALSE;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:call_cred_rl:' || v_uid::text, 0)
  );

  v_window_start := v_now - make_interval(secs => v_window);

  -- Prune expired rate-limit entries for this user
  DELETE FROM public.call_credential_requests
  WHERE user_id = v_uid
    AND created_at < v_window_start;

  SELECT COUNT(*) INTO v_recent_count
  FROM public.call_credential_requests
  WHERE user_id = v_uid
    AND created_at >= v_window_start;

  IF v_recent_count >= v_max THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.call_credential_requests (user_id, room_id, created_at)
  VALUES (v_uid, p_room_id, v_now);

  RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. FUNCTION EXECUTION PRIVILEGES
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.room_call_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.room_call_participants TO authenticated;
GRANT ALL ON TABLE public.room_call_participants TO service_role;

REVOKE ALL ON TABLE public.call_credential_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.call_credential_requests TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_room_call_participant(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_room_call(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.heartbeat_room_call(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_room_call(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_call_on_member_leave() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_receive_call_topic(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_send_call_topic(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_and_record_call_credential_request(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_room_call_participant(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_room_call(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_room_call(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_room_call(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_receive_call_topic(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_send_call_topic(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_and_record_call_credential_request(UUID, INTEGER, INTEGER) TO authenticated, service_role;

-- Refresh PostgREST schema cache so new columns are visible immediately
NOTIFY pgrst, 'reload schema';
