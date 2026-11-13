-- =============================================================================
-- Migration: 012_room_queue.sql
-- Shared YouTube-first watch queue.
--
-- Features:
--   1. `room_queue_items` stores upcoming videos for a room. The currently
--      playing video remains authoritative in `rooms.video_url` / `rooms.video_type`.
--   2. Any room member may enqueue a video; host / co-host / permitted controllers
--      may reorder and remove any item. A member may remove their own item.
--   3. `add_room_queue_item(...)` assigns the next position atomically.
--   4. `reorder_room_queue(...)` validates control authority server-side.
--   5. Realtime publication + FULL replica identity for live queue updates.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  video_type TEXT NOT NULL DEFAULT 'youtube'
    CHECK (video_type IN ('youtube', 'url', 'upload')),
  title TEXT NOT NULL,
  channel_title TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (duration_seconds >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  added_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT room_queue_items_source_required
    CHECK (char_length(BTRIM(video_id)) > 0 OR char_length(BTRIM(video_url)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_room_queue_items_room_position
  ON public.room_queue_items (room_id, position, created_at);

CREATE INDEX IF NOT EXISTS idx_room_queue_items_added_by
  ON public.room_queue_items (added_by);

ALTER TABLE public.room_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_queue_items REPLICA IDENTITY FULL;

-- -----------------------------------------------------------------------------
-- 2. CONTROL AUTHORITY HELPER
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_control_room_queue(
  p_room_id UUID,
  p_user_id UUID
)
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
    SELECT 1
    FROM public.rooms r
    JOIN public.room_members m ON m.room_id = r.id
    WHERE r.id = p_room_id
      AND m.user_id = p_user_id
      AND NOT (m.user_id = ANY(COALESCE(r.kicked_user_ids, ARRAY[]::UUID[])))
      AND (m.role = 'co-host' OR r.allow_guest_control = true)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_control_room_queue(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_control_room_queue(UUID, UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. RPC: ADD QUEUE ITEM (atomic next position, membership validated)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_room_queue_item(
  p_room_id UUID,
  p_video_id TEXT DEFAULT '',
  p_video_url TEXT DEFAULT '',
  p_video_type TEXT DEFAULT 'youtube',
  p_title TEXT DEFAULT 'Untitled video',
  p_channel_title TEXT DEFAULT NULL,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_duration_seconds INTEGER DEFAULT 0
)
RETURNS public.room_queue_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_next_position INTEGER;
  v_row public.room_queue_items%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to add videos to the queue.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_room_member(p_room_id, v_uid) THEN
    RAISE EXCEPTION 'Only room members can add videos to the queue.'
      USING ERRCODE = '42501';
  END IF;

  IF p_video_type NOT IN ('youtube', 'url', 'upload') THEN
    RAISE EXCEPTION 'Invalid video type.'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(BTRIM(COALESCE(p_video_id, ''))) = 0
     AND char_length(BTRIM(COALESCE(p_video_url, ''))) = 0 THEN
    RAISE EXCEPTION 'A YouTube video ID or video URL is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1
  INTO v_next_position
  FROM public.room_queue_items
  WHERE room_id = p_room_id;

  INSERT INTO public.room_queue_items (
    room_id,
    video_id,
    video_url,
    video_type,
    title,
    channel_title,
    thumbnail_url,
    duration_seconds,
    position,
    added_by
  )
  VALUES (
    p_room_id,
    LEFT(BTRIM(COALESCE(p_video_id, '')), 500),
    LEFT(BTRIM(COALESCE(p_video_url, '')), 2000),
    p_video_type,
    LEFT(COALESCE(NULLIF(BTRIM(p_title), ''), 'Untitled video'), 300),
    LEFT(NULLIF(BTRIM(p_channel_title), ''), 200),
    LEFT(NULLIF(BTRIM(p_thumbnail_url), ''), 2000),
    GREATEST(COALESCE(p_duration_seconds, 0), 0),
    v_next_position,
    v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_room_queue_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_room_queue_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. RPC: REORDER QUEUE (controller only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_room_queue(
  p_room_id UUID,
  p_item_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to reorder the queue.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_room_member(p_room_id, v_uid)
     OR NOT public.can_control_room_queue(p_room_id, v_uid) THEN
    RAISE EXCEPTION 'Only the host or authorized controllers can reorder the queue.'
      USING ERRCODE = '42501';
  END IF;

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.room_queue_items AS q
  SET position = ordered.ordinality - 1
  FROM unnest(p_item_ids) WITH ORDINALITY AS ordered(item_id, ordinality)
  WHERE q.id = ordered.item_id
    AND q.room_id = p_room_id;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_room_queue(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_room_queue(UUID, UUID[]) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. GUARD: only queue position may be updated directly
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_room_queue_item_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.video_id IS DISTINCT FROM OLD.video_id
     OR NEW.video_url IS DISTINCT FROM OLD.video_url
     OR NEW.video_type IS DISTINCT FROM OLD.video_type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.channel_title IS DISTINCT FROM OLD.channel_title
     OR NEW.thumbnail_url IS DISTINCT FROM OLD.thumbnail_url
     OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
     OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only queue position can be updated.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_room_queue_item_update ON public.room_queue_items;
CREATE TRIGGER tr_guard_room_queue_item_update
  BEFORE UPDATE ON public.room_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_room_queue_item_update();

-- -----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "room_queue_items_select_member" ON public.room_queue_items;
CREATE POLICY "room_queue_items_select_member"
  ON public.room_queue_items
  FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "room_queue_items_insert_member" ON public.room_queue_items;
CREATE POLICY "room_queue_items_insert_member"
  ON public.room_queue_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    added_by = auth.uid()
    AND public.is_room_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "room_queue_items_update_controller" ON public.room_queue_items;
CREATE POLICY "room_queue_items_update_controller"
  ON public.room_queue_items
  FOR UPDATE
  TO authenticated
  USING (
    public.is_room_member(room_id, auth.uid())
    AND public.can_control_room_queue(room_id, auth.uid())
  )
  WITH CHECK (
    public.is_room_member(room_id, auth.uid())
    AND public.can_control_room_queue(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "room_queue_items_delete_member_or_controller" ON public.room_queue_items;
CREATE POLICY "room_queue_items_delete_member_or_controller"
  ON public.room_queue_items
  FOR DELETE
  TO authenticated
  USING (
    public.is_room_member(room_id, auth.uid())
    AND (
      public.can_control_room_queue(room_id, auth.uid())
      OR added_by = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_queue_items TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. REALTIME PUBLICATION
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_queue_items;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
