-- =============================================================================
-- Migration: 004_fix_rls_recursion.sql
-- Description: Fix infinite recursion (error 42P17) in room_members and rooms RLS policies.
--              Introduces SECURITY DEFINER helper functions to break cyclic policy evaluation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SECURITY DEFINER HELPER FUNCTIONS
-- Bypasses RLS internally to safely check room membership without infinite recursion
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

-- -----------------------------------------------------------------------------
-- 2. RECREATE ROOMS POLICIES WITHOUT DIRECT RECURSION
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Rooms are viewable by members or host" ON public.rooms;
CREATE POLICY "Rooms are viewable by members or host"
ON public.rooms FOR SELECT
TO authenticated
USING (
  NOT is_private
  OR host_id = auth.uid()
  OR public.is_room_member(id, auth.uid())
);

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

-- -----------------------------------------------------------------------------
-- 3. RECREATE ROOM MEMBERS POLICIES (ELIMINATES 42P17 SELF-RECURSION)
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- 4. RECREATE CHAT MESSAGES POLICIES
-- -----------------------------------------------------------------------------

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
-- 5. RECREATE STORAGE POLICIES
-- -----------------------------------------------------------------------------

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
-- 6. ENSURE SAFE ROOM CODE LOOKUP RPC EXISTS
-- Allows looking up a private room by exact code before joining room_members
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

GRANT EXECUTE ON FUNCTION public.lookup_room_by_code(TEXT) TO authenticated, anon;

