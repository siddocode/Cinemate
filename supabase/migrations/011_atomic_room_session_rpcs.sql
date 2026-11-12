-- =============================================================================
-- Migration: 011_atomic_room_session_rpcs.sql
-- Atomic Room Creation & Joining RPCs (Optimization 2)
--
-- Features:
--   1. `create_room_session(p_code, p_title, p_video_url, p_video_type, p_username, p_is_guest)`
--      Atomically ensures caller's profile, creates (or recovers existing) room
--      with initial video metadata, joins caller under `pg_advisory_xact_lock`,
--      and returns `{ room, role, members, created }` in one round-trip.
--   2. `join_room_session(p_code, p_username, p_is_guest)`
--      Atomically looks up room by exact code, ensures caller's profile,
--      enforces 4-participant capacity & kicked view-only restrictions under
--      `pg_advisory_xact_lock`, upserts membership, and returns
--      `{ room, role, members }` in one round-trip.
--
-- Preserves all existing constraints, rate limits (`tr_check_room_creation_rate`),
-- capacity triggers (`tr_enforce_room_member_capacity`), kicked-member guards
-- (`tr_enforce_kicked_member_viewer_only`), and role update guards
-- (`tr_guard_room_member_update`).
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- Internal helper: atomically upserts membership and builds `{ room, role, members }` JSONB.
-- Not directly callable by end users (`REVOKE ALL FROM PUBLIC, anon, authenticated`).
CREATE OR REPLACE FUNCTION public._finalize_room_session(
    p_room public.rooms,
    p_uid UUID,
    p_now TIMESTAMPTZ,
    p_created BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max CONSTANT INTEGER := 4;
  v_is_host BOOLEAN := FALSE;
  v_is_kicked BOOLEAN := FALSE;
  v_existing_role TEXT;
  v_member_count INTEGER := 0;
  v_role TEXT := 'viewer';
  v_members JSONB := '[]'::jsonb;
BEGIN
  -- Serialize concurrent joins for this room's 4-participant cap
  PERFORM pg_advisory_xact_lock(
    hashtextextended('syncora:room_members:' || p_room.id::text, 0)
  );

  v_is_host := (p_room.host_id = p_uid);
  v_is_kicked := (NOT v_is_host) AND (p_uid = ANY(COALESCE(p_room.kicked_user_ids, '{}'::uuid[])));

  SELECT rm.role INTO v_existing_role
  FROM public.room_members rm
  WHERE rm.room_id = p_room.id AND rm.user_id = p_uid
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_member_count
    FROM public.room_members rm
    WHERE rm.room_id = p_room.id;

    IF v_member_count >= v_max THEN
      RAISE EXCEPTION 'Room has reached its maximum capacity (%/%). Watch rooms are capped at % participants to protect bandwidth.',
        v_max, v_max, v_max
        USING ERRCODE = 'P0001', HINT = 'ROOM_FULL';
    END IF;

    v_role := CASE WHEN v_is_host THEN 'host' ELSE 'viewer' END;

    INSERT INTO public.room_members (room_id, user_id, role, joined_at, last_seen_at)
    VALUES (p_room.id, p_uid, v_role, p_now, p_now);
  ELSE
    v_role := CASE
      WHEN v_is_host THEN 'host'
      WHEN v_is_kicked THEN 'viewer'
      ELSE v_existing_role
    END;

    UPDATE public.room_members
    SET last_seen_at = p_now,
        role = v_role
    WHERE room_id = p_room.id AND user_id = p_uid;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rm.id,
        'room_id', rm.room_id,
        'user_id', rm.user_id,
        'username', COALESCE(p.username, 'Viewer'),
        'role', rm.role,
        'joined_at', rm.joined_at,
        'last_seen_at', rm.last_seen_at
      )
      ORDER BY rm.joined_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_members
  FROM public.room_members rm
  LEFT JOIN public.profiles p ON p.id = rm.user_id
  WHERE rm.room_id = p_room.id;

  RETURN jsonb_build_object(
    'room', to_jsonb(p_room),
    'role', v_role,
    'members', v_members,
    'created', p_created
  );
END;
$$;

-- 1. ATOMIC ROOM CREATION + INITIAL VIDEO + HOST MEMBERSHIP + PARTICIPANTS
CREATE OR REPLACE FUNCTION public.create_room_session(
    p_code TEXT,
    p_title TEXT DEFAULT 'Our Watch Party',
    p_video_url TEXT DEFAULT '',
    p_video_type TEXT DEFAULT 'youtube',
    p_username TEXT DEFAULT NULL,
    p_is_guest BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_code TEXT;
  v_title TEXT;
  v_video_url TEXT;
  v_video_type TEXT;
  v_username TEXT;
  v_room public.rooms%ROWTYPE;
  v_created BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to create a room.'
      USING ERRCODE = '42501';
  END IF;

  v_code := UPPER(BTRIM(COALESCE(p_code, '')));
  IF char_length(v_code) < 6 OR char_length(v_code) > 32 THEN
    RAISE EXCEPTION 'Room code must be between 6 and 32 characters.'
      USING ERRCODE = '22023';
  END IF;

  v_title := LEFT(COALESCE(NULLIF(BTRIM(p_title), ''), 'Our Watch Party'), 100);
  v_video_url := LEFT(COALESCE(BTRIM(p_video_url), ''), 2048);
  v_video_type := CASE
    WHEN p_video_type IN ('youtube', 'url', 'upload') THEN p_video_type
    ELSE 'youtube'
  END;
  v_username := LEFT(
    COALESCE(NULLIF(BTRIM(p_username), ''), 'User-' || SUBSTRING(v_uid::text FROM 1 FOR 4)),
    30
  );

  -- Ensure profile exists / sync display name only when changed
  INSERT INTO public.profiles (id, username, is_guest, updated_at)
  VALUES (v_uid, v_username, COALESCE(p_is_guest, false), v_now)
  ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      is_guest = EXCLUDED.is_guest,
      updated_at = v_now
  WHERE public.profiles.username IS DISTINCT FROM EXCLUDED.username
     OR public.profiles.is_guest IS DISTINCT FROM EXCLUDED.is_guest;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE code = v_code
  LIMIT 1;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.rooms (
        code,
        title,
        host_id,
        video_type,
        video_url,
        current_position,
        is_playing,
        is_private,
        last_synced_at
      )
      VALUES (
        v_code,
        v_title,
        v_uid,
        v_video_type,
        v_video_url,
        0.0,
        false,
        true,
        v_now
      )
      RETURNING * INTO v_room;
      v_created := TRUE;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT * INTO v_room
        FROM public.rooms
        WHERE code = v_code
        LIMIT 1;
        v_created := FALSE;
    END;
  ELSIF v_room.host_id = v_uid
    AND COALESCE(v_room.video_url, '') = ''
    AND v_video_url <> '' THEN
    UPDATE public.rooms
    SET video_url = v_video_url,
        video_type = v_video_type,
        updated_at = v_now
    WHERE id = v_room.id
    RETURNING * INTO v_room;
  END IF;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Failed to initialize room.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN public._finalize_room_session(v_room, v_uid, v_now, v_created);
END;
$$;

-- 2. ATOMIC ROOM JOIN + MEMBERSHIP + PARTICIPANTS
CREATE OR REPLACE FUNCTION public.join_room_session(
    p_code TEXT,
    p_username TEXT DEFAULT NULL,
    p_is_guest BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_code TEXT;
  v_username TEXT;
  v_room public.rooms%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join a room.'
      USING ERRCODE = '42501';
  END IF;

  v_code := UPPER(BTRIM(COALESCE(p_code, '')));
  IF char_length(v_code) < 6 OR char_length(v_code) > 32 THEN
    RETURN jsonb_build_object(
      'room', NULL,
      'role', 'viewer',
      'members', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE code = v_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'room', NULL,
      'role', 'viewer',
      'members', '[]'::jsonb
    );
  END IF;

  v_username := LEFT(
    COALESCE(NULLIF(BTRIM(p_username), ''), 'User-' || SUBSTRING(v_uid::text FROM 1 FOR 4)),
    30
  );

  INSERT INTO public.profiles (id, username, is_guest, updated_at)
  VALUES (v_uid, v_username, COALESCE(p_is_guest, false), v_now)
  ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      is_guest = EXCLUDED.is_guest,
      updated_at = v_now
  WHERE public.profiles.username IS DISTINCT FROM EXCLUDED.username
     OR public.profiles.is_guest IS DISTINCT FROM EXCLUDED.is_guest;

  RETURN public._finalize_room_session(v_room, v_uid, v_now, FALSE);
END;
$$;

-- 3. FUNCTION EXECUTION PRIVILEGES
REVOKE EXECUTE ON FUNCTION public._finalize_room_session(public.rooms, UUID, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finalize_room_session(public.rooms, UUID, TIMESTAMPTZ, BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_room_session(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_room_session(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_room_session(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_room_session(TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

-- 4. REFRESH POSTGREST SCHEMA CACHE
NOTIFY pgrst, 'reload schema';

