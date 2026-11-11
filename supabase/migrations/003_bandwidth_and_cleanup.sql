-- =============================================================================
-- Migration: 003_bandwidth_and_cleanup.sql
-- Description: Bandwidth metrics tracking table, room closure tracking,
--              egress counter RPC, and video expiration queries.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADD CLOSED_AT COLUMN TO ROOMS TABLE
-- Tracks when a watch party is formally ended to trigger 24h cleanup
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rooms' AND column_name = 'closed_at'
  ) THEN
    ALTER TABLE public.rooms ADD COLUMN closed_at TIMESTAMPTZ;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. STORAGE USAGE METRICS TABLE
-- Tracks uploaded video files, estimated egress, and deletion status
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.storage_usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size_bytes BIGINT NOT NULL,
    estimated_egress_bytes BIGINT DEFAULT 0 NOT NULL,
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_storage_metrics_user ON public.storage_usage_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_storage_metrics_room ON public.storage_usage_metrics(room_id);
CREATE INDEX IF NOT EXISTS idx_storage_metrics_deleted ON public.storage_usage_metrics(is_deleted);

-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) FOR STORAGE METRICS
-- -----------------------------------------------------------------------------
ALTER TABLE public.storage_usage_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own storage metrics" ON public.storage_usage_metrics;
CREATE POLICY "Users can view their own storage metrics"
ON public.storage_usage_metrics FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can record storage metrics for own uploads" ON public.storage_usage_metrics;
CREATE POLICY "Authenticated users can record storage metrics for own uploads"
ON public.storage_usage_metrics FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 4. EGRESS INCREMENT RPC
-- Secure counter to accumulate estimated egress per video object
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_video_egress(p_file_path TEXT, p_bytes BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.storage_usage_metrics
  SET estimated_egress_bytes = estimated_egress_bytes + p_bytes
  WHERE file_path = p_file_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_video_egress(TEXT, BIGINT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. EXPIRED VIDEOS QUERY FUNCTION
-- Identifies videos eligible for cleanup:
--   - Rooms closed > 24 hours ago
--   - Inactive rooms last synced > 7 days ago
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_expired_videos()
RETURNS TABLE (
  metric_id UUID,
  file_path TEXT,
  file_size_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.file_path,
    m.file_size_bytes
  FROM public.storage_usage_metrics m
  LEFT JOIN public.rooms r ON m.room_id = r.id
  WHERE m.is_deleted = false
    AND (
      -- 24 hours after room closure
      (r.closed_at IS NOT NULL AND r.closed_at < NOW() - INTERVAL '24 hours')
      -- Or 7 days after room was last active/synced
      OR (r.last_synced_at < NOW() - INTERVAL '7 days')
      -- Or orphaned file with no room record
      OR (r.id IS NULL AND m.created_at < NOW() - INTERVAL '7 days')
    );
END;
$$;

