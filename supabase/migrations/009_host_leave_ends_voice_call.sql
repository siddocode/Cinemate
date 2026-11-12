-- =============================================================================
-- Migration: 009_host_leave_ends_voice_call.sql
-- Phase 12.1 — Host Leaving Voice Ends the Room Call for Everyone
--
-- Features:
--   - `public.leave_room_call(UUID)`: when called by the room host, removes ALL
--     `room_call_participants` rows for `p_room_id` (ends call for everyone).
--     When called by a non-host participant, removes only that caller's slot.
--   - `public.cleanup_call_on_member_leave()`: if the deleted `room_members` row
--     belongs to the room host, clears all voice call slots for the room.
--   - `public.join_room_call(UUID)` & `public.heartbeat_room_call(UUID)`:
--     if an active host call slot expires past the 60-second TTL, clears all
--     remaining participant slots for `p_room_id` so orphaned callers are ended.
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

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
    -- Reclaim crashed/abandoned non-host slots older than 60s before checking capacity
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

REVOKE EXECUTE ON FUNCTION public.join_room_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_call(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.heartbeat_room_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_room_call(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.leave_room_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_room_call(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cleanup_call_on_member_leave() FROM PUBLIC, anon, authenticated;

