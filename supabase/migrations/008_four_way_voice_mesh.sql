-- =============================================================================
-- Migration: 008_four_way_voice_mesh.sql
-- Phase 12 — Expand Room Voice Calls from 1:1 (2 Slots) to 4-Way Mesh (4 Slots)
--
-- Features:
--   - Updates `public.join_room_call(UUID)` so up to 4 room members can hold
--     active voice call slots simultaneously (`MAX_CALL_PARTICIPANTS = 4`),
--     matching `MAX_ROOM_PARTICIPANTS = 4`.
--   - Preserves per-room `pg_advisory_xact_lock`, 60-second stale slot pruning,
--     anti-spoofing `realtime.messages` RLS, and strict `REVOKE/GRANT` rules.
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

REVOKE EXECUTE ON FUNCTION public.join_room_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_call(UUID) TO authenticated, service_role;

