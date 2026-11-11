-- =============================================================================
-- Migration: 006_voice_call_authorization.sql
-- Phase 10.2 — Two-Person Voice Call Slots, Realtime Signaling RLS & Rate Limits
--
-- Features & Security Guarantees:
--   1. public.room_call_participants: Ephemeral slot table enforcing MAX 2 callers
--      per room server-side via atomic RPC `join_room_call()` + per-room
--      pg_advisory_xact_lock (serializes concurrent join attempts) and automatic
--      60-second stale heartbeat pruning + cleanup when leaving room_members.
--   2. Zero persistence of media, SDP offers/answers, or ICE candidates.
--   3. Realtime Authorization policies on realtime.messages for:
--        - `call:<room_uuid>:<sender_uuid>` (1:1 signaling outbox; INSERT locked
--          to auth.uid() = sender_uuid AND active call slot; SELECT locked to
--          active call participants in that room)
--        - `callroster:<room_uuid>` (presence; SELECT for room members, INSERT
--          locked to active call participants)
--   4. public.call_credential_requests + check_and_record_call_credential_request():
--      Server-side Postgres rate limit for TURN/ICE credential requests.
--   5. Strict REVOKE from PUBLIC & anon on all new functions.
--
-- Idempotent: safe to run multiple times.
-- NOTE: Do NOT run `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY`.
-- =============================================================================

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
  v_max CONSTANT INTEGER := 2;
  v_count INTEGER;
  v_already_in BOOLEAN;
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

  -- Serialize concurrent join attempts for this room's 2-slot voice call
  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:room_call:' || p_room_id::text, 0)
  );

  -- Reclaim crashed/abandoned slots older than 60s before checking capacity
  DELETE FROM public.room_call_participants rcp
  WHERE rcp.room_id = p_room_id
    AND rcp.last_heartbeat_at < v_now - INTERVAL '60 seconds';

  SELECT EXISTS (
    SELECT 1 FROM public.room_call_participants rcp
    WHERE rcp.room_id = p_room_id AND rcp.user_id = v_uid
  ) INTO v_already_in;

  SELECT COUNT(*) INTO v_count
  FROM public.room_call_participants rcp
  WHERE rcp.room_id = p_room_id;

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

  DELETE FROM public.room_call_participants rcp
  WHERE rcp.room_id = p_room_id
    AND rcp.user_id = v_uid;
END;
$$;

-- Automatically free a voice call slot if a member leaves or is removed from the room
CREATE OR REPLACE FUNCTION public.cleanup_call_on_member_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.room_call_participants
  WHERE room_id = OLD.room_id AND user_id = OLD.user_id;
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
#variable_conflict use_column
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
