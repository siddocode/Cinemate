-- =============================================================================
-- Migration: 010_voice_call_initiation_permissions.sql
-- Voice Call Initiation Permissions (Host-Only Default + Co-Host / Guest Toggle)
--
-- Features:
--   1. Adds `allow_guest_call` (BOOLEAN, default: false) to `public.rooms`.
--   2. Updates `guard_room_settings_update()` so only the room host can modify
--      `allow_guest_call`.
--   3. Updates `join_room_call(UUID)`:
--        - If a voice call is already active (`v_count > 0`), any room member
--          may join (up to 4 slots).
--        - If no voice call is active (`v_count = 0`), only the room host—or a
--          non-kicked Co-Host / room member when `allow_guest_call = true`—
--          may initiate a new call (`HINT = 'CALL_START_NOT_ALLOWED'`).
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- 1. ADD COLUMN TO public.rooms
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS allow_guest_call BOOLEAN DEFAULT false NOT NULL;

-- 2. GUARD AGAINST NON-HOSTS MODIFYING ROOM SETTINGS (INCLUDING allow_guest_call)
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

-- 3. ENFORCE VOICE CALL INITIATION PERMISSIONS IN join_room_call(UUID)
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

REVOKE EXECUTE ON FUNCTION public.join_room_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_call(UUID) TO authenticated, service_role;

-- 4. REFRESH POSTGREST SCHEMA CACHE
NOTIFY pgrst, 'reload schema';

