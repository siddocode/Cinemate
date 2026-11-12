-- =============================================================================
-- Migration: 007_room_permissions_and_kick.sql
-- Room Playback Delegation, Kick Member & Storage Cleanup Safeguards
--
-- Features:
--   1. Adds `allow_guest_control` (BOOLEAN) to public.rooms (default: false).
--   2. Adds `kicked_user_ids` (UUID[]) to public.rooms (default: '{}'::uuid[]).
--   3. Updates public.rooms UPDATE RLS policy to allow playback updates when
--      `allow_guest_control = true` for active non-restricted room members.
--   4. Allows kicked users to rejoin as view-only participants, but permanently
--      blocks them from Co-Host promotion or playback authority in that room.
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- 1. ADD COLUMNS TO public.rooms
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS allow_guest_control BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS kicked_user_ids UUID[] DEFAULT '{}'::uuid[] NOT NULL;

-- 2. UPDATE RLS POLICIES ON public.rooms
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

-- 3. ALLOW REJOIN AS VIEWER-ONLY FOR KICKED USERS (NEVER CO-HOST OR CONTROL AUTHORITY)
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

-- 4. GUARD AGAINST NON-HOSTS MODIFYING ROOM SETTINGS OR KICKED LIST
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

-- 5. REFRESH POSTGREST SCHEMA CACHE
-- Ensures allow_guest_control and kicked_user_ids are immediately visible to API requests
NOTIFY pgrst, 'reload schema';

