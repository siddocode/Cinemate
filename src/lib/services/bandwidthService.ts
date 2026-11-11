import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export interface BandwidthMetrics {
  totalStorageBytes: number;
  estimatedMonthlyEgressBytes: number;
  monthlyUploadCount: number;
  isSoftWarning: boolean;
  isHardBlocked: boolean;
  userActiveUploadsCount: number;
}

export interface UploadEligibility {
  allowed: boolean;
  reason?: 'MONTHLY_BANDWIDTH_LIMIT_EXCEEDED' | 'USER_QUOTA_EXCEEDED' | 'ROOM_QUOTA_EXCEEDED' | 'FILE_TOO_LARGE';
  message?: string;
  currentEgressBytes?: number;
}

// In-memory tracking fallback when Supabase is not configured or metrics table is pending
interface TrackedVideo {
  filePath: string;
  roomId: string;
  userId: string;
  sizeBytes: number;
  estimatedEgressBytes: number;
  createdAt: number;
  isDeleted: boolean;
}

const memoryTrackedVideos: Map<string, TrackedVideo> = new Map();
let memoryMonthlyEgressBytes = 0;

export const bandwidthService = {
  /**
   * Evaluates whether a user/room is eligible to upload a new personal video
   * based on per-user quotas, per-room limits, and monthly bandwidth thresholds.
   */
  async checkUploadEligibility(params: {
    userId: string;
    roomId: string;
    fileSizeBytes: number;
  }): Promise<UploadEligibility> {
    // 1. File size check
    if (params.fileSizeBytes > SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES) {
      return {
        allowed: false,
        reason: 'FILE_TOO_LARGE',
        message: 'File size exceeds 50MB. Please use YouTube or a direct video URL for larger files.',
      };
    }

    const metrics = await this.getMetrics(params.userId);

    // 2. Monthly safe bandwidth hard ceiling check (1.8 GB / 90% of free tier)
    if (metrics.estimatedMonthlyEgressBytes >= SYNC_CONSTANTS.HARD_CEILING_EGRESS_BYTES) {
      return {
        allowed: false,
        reason: 'MONTHLY_BANDWIDTH_LIMIT_EXCEEDED',
        message: 'Monthly personal video storage bandwidth safe limit reached (~1.8GB / 2.0GB). Personal video uploads are temporarily paused to protect against billing. YouTube and direct video links remain unlimited!',
        currentEgressBytes: metrics.estimatedMonthlyEgressBytes,
      };
    }

    // 3. Per-user active upload quota check (Max 3 videos)
    if (metrics.userActiveUploadsCount >= SYNC_CONSTANTS.MAX_ACTIVE_UPLOADS_PER_USER) {
      return {
        allowed: false,
        reason: 'USER_QUOTA_EXCEEDED',
        message: `You have reached your active upload limit (${SYNC_CONSTANTS.MAX_ACTIVE_UPLOADS_PER_USER} videos). Older videos are automatically cleaned up 24h after watch parties.`,
      };
    }

    // 4. Per-room active upload limit check (Max 1 active uploaded video per room)
    const roomUploadsCount = await this.getRoomActiveUploadCount(params.roomId);
    if (roomUploadsCount >= SYNC_CONSTANTS.MAX_ACTIVE_UPLOADS_PER_ROOM) {
      return {
        allowed: false,
        reason: 'ROOM_QUOTA_EXCEEDED',
        message: 'This watch party already has an active uploaded video. Replacing videos will be supported after the current session ends.',
      };
    }

    return { allowed: true };
  },

  /**
   * Records a new video upload in the tracking system.
   */
  async recordUpload(params: {
    userId: string;
    roomId: string;
    filePath: string;
    sizeBytes: number;
  }): Promise<void> {
    const now = Date.now();
    memoryTrackedVideos.set(params.filePath, {
      filePath: params.filePath,
      roomId: params.roomId,
      userId: params.userId,
      sizeBytes: params.sizeBytes,
      estimatedEgressBytes: params.sizeBytes, // Initial upload counts as 1 read projection
      createdAt: now,
      isDeleted: false,
    });
    memoryMonthlyEgressBytes += params.sizeBytes;

    if (!isSupabaseConfigured()) return;

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('storage_usage_metrics').insert({
        room_id: params.roomId,
        user_id: params.userId,
        file_path: params.filePath,
        file_size_bytes: params.sizeBytes,
        estimated_egress_bytes: params.sizeBytes,
      });
    } catch {
      // Metrics table might be pending migration; memory fallback ensures smooth continuity
    }
  },

  /**
   * Records estimated egress consumption when a video stream or signed URL is requested.
   */
  async recordEgress(params: { filePath?: string; bytesServed: number }): Promise<void> {
    memoryMonthlyEgressBytes += params.bytesServed;

    if (params.filePath && memoryTrackedVideos.has(params.filePath)) {
      const item = memoryTrackedVideos.get(params.filePath)!;
      item.estimatedEgressBytes += params.bytesServed;
    }

    if (!isSupabaseConfigured()) return;

    try {
      const supabase = getSupabaseBrowserClient();
      if (params.filePath) {
        await supabase.rpc('increment_video_egress', {
          p_file_path: params.filePath,
          p_bytes: params.bytesServed,
        });
      }
    } catch {
      // Non-fatal tracking increment
    }
  },

  /**
   * Retrieves overall bandwidth and storage metrics.
   */
  async getMetrics(userId?: string): Promise<BandwidthMetrics> {
    let totalStorage = 0;
    let userActiveUploads = 0;
    let uploadCount = 0;

    memoryTrackedVideos.forEach((video) => {
      if (!video.isDeleted) {
        totalStorage += video.sizeBytes;
        uploadCount += 1;
        if (userId && video.userId === userId) {
          userActiveUploads += 1;
        }
      }
    });

    // Check Supabase metrics if available
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from('storage_usage_metrics')
          .select('file_size_bytes, estimated_egress_bytes, user_id, is_deleted');

        if (!error && data && data.length > 0) {
          totalStorage = 0;
          let dbEgress = 0;
          userActiveUploads = 0;
          uploadCount = 0;

          data.forEach((row) => {
            if (!row.is_deleted) {
              totalStorage += Number(row.file_size_bytes || 0);
              uploadCount += 1;
              if (userId && row.user_id === userId) {
                userActiveUploads += 1;
              }
            }
            dbEgress += Number(row.estimated_egress_bytes || 0);
          });

          if (dbEgress > 0) {
            memoryMonthlyEgressBytes = dbEgress;
          }
        }
      } catch {
        // Fallback to in-memory metrics
      }
    }

    const estimatedEgress = memoryMonthlyEgressBytes;
    const isSoftWarning = estimatedEgress >= SYNC_CONSTANTS.SOFT_WARNING_EGRESS_BYTES;
    const isHardBlocked = estimatedEgress >= SYNC_CONSTANTS.HARD_CEILING_EGRESS_BYTES;

    return {
      totalStorageBytes: totalStorage,
      estimatedMonthlyEgressBytes: estimatedEgress,
      monthlyUploadCount: uploadCount,
      isSoftWarning,
      isHardBlocked,
      userActiveUploadsCount: userActiveUploads,
    };
  },

  /**
   * Retrieves active upload count for a given room.
   */
  async getRoomActiveUploadCount(roomId: string): Promise<number> {
    let count = 0;
    memoryTrackedVideos.forEach((video) => {
      if (video.roomId === roomId && !video.isDeleted) {
        count += 1;
      }
    });

    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        const { count: dbCount, error } = await supabase
          .from('storage_usage_metrics')
          .select('id', { count: 'exact', head: true })
          .eq('room_id', roomId)
          .eq('is_deleted', false);

        if (!error && typeof dbCount === 'number') {
          return dbCount;
        }
      } catch {
        // Fallback
      }
    }

    return count;
  },

  /**
   * Video Lifecycle Cleanup:
   * Deletes files 24 hours after room closure or 7 days for abandoned rooms.
   * Safe to retry and ensures actual Storage objects are deleted.
   */
  async runVideoCleanup(): Promise<{
    deletedCount: number;
    freedBytes: number;
    errors: string[];
  }> {
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;
    const errors: string[] = [];

    // Local in-memory cleanup
    memoryTrackedVideos.forEach((video) => {
      const ageMs = now - video.createdAt;
      if (!video.isDeleted && ageMs > SYNC_CONSTANTS.VIDEO_EXPIRY_ABANDONED_ROOM_MS) {
        video.isDeleted = true;
        deletedCount += 1;
        freedBytes += video.sizeBytes;
      }
    });

    if (!isSupabaseConfigured()) {
      return { deletedCount, freedBytes, errors };
    }

    try {
      const supabase = getSupabaseBrowserClient();

      // Find candidate expired videos from database:
      // 1. Rooms that have been closed > 24 hours ago
      // 2. Inactive rooms where last_synced_at is > 7 days ago
      const cutoff24h = new Date(now - SYNC_CONSTANTS.VIDEO_EXPIRY_AFTER_ROOM_CLOSE_MS).toISOString();
      const cutoff7d = new Date(now - SYNC_CONSTANTS.VIDEO_EXPIRY_ABANDONED_ROOM_MS).toISOString();

      type ExpiredRecord = {
        id: string;
        file_path: string;
        file_size_bytes: number;
        rooms: { last_synced_at?: string; closed_at?: string } | null;
      };

      const { data: expiredRecords, error } = await supabase
        .from('storage_usage_metrics')
        .select('id, file_path, file_size_bytes, rooms(last_synced_at, closed_at)')
        .eq('is_deleted', false);

      if (error || !expiredRecords || expiredRecords.length === 0) {
        return { deletedCount, freedBytes, errors };
      }

      for (const record of expiredRecords as unknown as ExpiredRecord[]) {
        const roomData = record.rooms;
        const isClosedExpired = Boolean(roomData?.closed_at && roomData.closed_at < cutoff24h);
        const isAbandonedExpired = Boolean(roomData?.last_synced_at && roomData.last_synced_at < cutoff7d);
        const isExpired = isClosedExpired || isAbandonedExpired || !roomData;

        if (isExpired) {
          // Idempotent Storage deletion
          const { error: storageErr } = await supabase.storage
            .from('videos')
            .remove([record.file_path]);

          if (storageErr) {
            errors.push(`Storage deletion error on ${record.file_path}: ${storageErr.message}`);
          } else {
            deletedCount += 1;
            freedBytes += Number(record.file_size_bytes || 0);

            // Mark deleted in database
            await supabase
              .from('storage_usage_metrics')
              .update({ is_deleted: true, deleted_at: new Date().toISOString() })
              .eq('id', record.id);
          }
        }
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : 'Unknown cleanup failure');
    }

    return { deletedCount, freedBytes, errors };
  },

  /**
   * Marks in-memory tracked uploads for a deleted room as removed.
   */
  markRoomUploadsDeleted(roomId: string): void {
    memoryTrackedVideos.forEach((video) => {
      if (video.roomId === roomId) {
        video.isDeleted = true;
      }
    });
  },
};
