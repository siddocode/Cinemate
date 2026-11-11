-- =============================================================================
-- Migration: 005_realtime_authorization_and_membership_hardening.sql
-- Phase 10.1 — Security foundation (prerequisite for voice calling)
--
-- Fixes:
--   G1  Room Realtime channels were public. Adds Realtime Authorization policies on
--       realtime.messages so only room members can receive / send / track presence
--       on private `room:<uuid>` and `room_chat:<uuid>` topics.
--   G3  The 4-participant room cap was enforced only in the browser (and the client
--       count is hidden by RLS for non-members). Adds a concurrency-safe trigger.
--   G8  Privilege escalation: a member could upsert their own room_members row with
--       role = 'co-host'/'host' or move it to another room_id. Adds an UPDATE guard.
--   G9  Stale `room_members.role = 'host'` rows kept host privileges after a host
--       transfer. is_room_host_or_cohost now derives host from rooms.host_id.
--   G10 Helper / lookup RPCs were executable by the `anon` role.
--
-- DEPLOYMENT ORDER (important):
--   1. Run this migration in the Supabase SQL Editor.
--   2. Deploy the application code (channels now use `private: true`).
--   3. Dashboard -> Realtime -> Settings -> disable "Allow public access".
--
-- Idempotent: safe to run multiple times.
-- NOTE: Do NOT run `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` —
--       RLS is already enabled by Supabase and the table is owned by the realtime role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ROOM HOST / CO-HOST HELPER (G9)
--    Host authority is derived ONLY from rooms.host_id. A stale room_members.role
--    of 'host' no longer grants privileges. Co-host remains a delegated member role.
-- -----------------------------------------------------------------------------
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

