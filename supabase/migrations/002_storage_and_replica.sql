-- =============================================================================
-- Migration: 002_storage_and_replica.sql
-- Description: Private video storage bucket with room-scoped access policies,
--              replica identity full, realtime replication, and realtime auth.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REPLICA IDENTITY FOR REALTIME
-- Enables full row payloads on UPDATE/DELETE events for Postgres Changes
-- -----------------------------------------------------------------------------
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_members REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

-- -----------------------------------------------------------------------------
-- 2. REALTIME PUBLICATION SETUP
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
-- 3. PROVISION PRIVATE STORAGE BUCKET
-- Bucket is PRIVATE (public = false). Videos are streamed via time-limited signed URLs.
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

-- -----------------------------------------------------------------------------
-- 4. STORAGE ROW LEVEL SECURITY POLICIES
-- Scoped strictly to the room UUID encoded in the object path: '<room_id>/<file>'
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Room hosts and co-hosts can upload video" ON storage.objects;
DROP POLICY IF EXISTS "Room members can read video files via signed URL" ON storage.objects;
DROP POLICY IF EXISTS "Room host can delete room video files" ON storage.objects;

-- Allow only host or co-host of the corresponding room to upload
CREATE POLICY "Room hosts and co-hosts can upload video"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'videos'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_room_host_or_cohost(((storage.foldername(name))[1])::uuid, auth.uid())
);

-- Allow room members to download / generate signed URLs for room videos
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

-- Allow only the room host to delete uploaded videos
CREATE POLICY "Room host can delete room video files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'videos'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_room_host(((storage.foldername(name))[1])::uuid, auth.uid())
);

-- -----------------------------------------------------------------------------
-- 5. REALTIME PRIVATE CHANNEL AUTHORIZATION
-- Configures authorization for room broadcast and presence topics
-- Topic convention: 'room:<room_id>' or 'room_chat:<room_id>'
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'realtime' AND table_name = 'messages'
  ) THEN
    EXECUTE '
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "Members can receive realtime room messages" ON realtime.messages;
      CREATE POLICY "Members can receive realtime room messages"
      ON realtime.messages FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.room_members
          WHERE room_id::text = regexp_replace(realtime.topic(), ''^(room|room_chat):'', '''')
            AND user_id = auth.uid()
        )
      );

      DROP POLICY IF EXISTS "Members can broadcast realtime room messages" ON realtime.messages;
      CREATE POLICY "Members can broadcast realtime room messages"
      ON realtime.messages FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.room_members
          WHERE room_id::text = regexp_replace(realtime.topic(), ''^(room|room_chat):'', '''')
            AND user_id = auth.uid()
        )
      );
    ';
  END IF;
END $$;

