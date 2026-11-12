import { isSupabaseConfigured } from '../supabase/config';
import { IVideoStorageProvider, StorageValidationResult } from '@/core/types/storage.types';
import { SupabaseStorageProvider } from '@/core/adapters/storage/SupabaseStorageProvider';
import { LocalStorageProvider } from '@/core/adapters/storage/LocalStorageProvider';
import { bandwidthService } from './bandwidthService';

export interface UploadResult {
  url: string;
  filePath?: string;
  filename: string;
  sizeBytes: number;
  error?: string;
}

export const storageService = {
  /**
   * Lazily resolves the active storage provider.
   */
  getProvider(): IVideoStorageProvider {
    if (isSupabaseConfigured()) {
      return new SupabaseStorageProvider();
    }
    return new LocalStorageProvider();
  },

  /**
   * Validates file size and format against 50MB free-tier constraints.
   */
  validateVideoFile(file: File): StorageValidationResult {
    return this.getProvider().validateFile(file);
  },

  /**
   * Uploads personal video through the active storage provider,
   * enforcing bandwidth quotas, per-user limits, and per-room limits.
   */
  async uploadVideo(
    file: File,
    roomId: string,
    onProgress?: (percent: number) => void,
    userId: string = 'guest'
  ): Promise<UploadResult> {
    const provider = this.getProvider();

    // 1. Quota & Bandwidth Eligibility Check
    const eligibility = await bandwidthService.checkUploadEligibility({
      userId,
      roomId,
      fileSizeBytes: file.size,
    });

    if (!eligibility.allowed) {
      return {
        url: '',
        filename: file.name,
        sizeBytes: file.size,
        error: eligibility.message || 'Upload restricted by bandwidth limits.',
      };
    }

    // 2. Perform provider-specific upload
    const uploadRes = await provider.uploadVideo(file, {
      roomId,
      userId,
      onProgress,
    });

    if (uploadRes.error || !uploadRes.url) {
      return {
        url: '',
        filePath: uploadRes.filePath,
        filename: file.name,
        sizeBytes: file.size,
        error: uploadRes.error || 'Upload failed.',
      };
    }

    // 3. Record upload in tracking service
    await bandwidthService.recordUpload({
      userId,
      roomId,
      filePath: uploadRes.filePath,
      sizeBytes: uploadRes.sizeBytes,
    });

    return {
      url: uploadRes.url,
      filePath: uploadRes.filePath,
      filename: uploadRes.filename,
      sizeBytes: uploadRes.sizeBytes,
    };
  },

  /**
   * Refreshes a signed URL for a private video object and logs egress metrics.
   */
  async getSignedVideoUrl(filePath: string, expiresInSeconds = 21600): Promise<string | null> {
    const provider = this.getProvider();
    const signedUrl = await provider.getSignedPlaybackUrl(filePath, expiresInSeconds);

    if (signedUrl) {
      // Record stream egress estimate (~25MB average buffer allocation per streaming session)
      await bandwidthService.recordEgress({
        filePath,
        bytesServed: 25 * 1024 * 1024,
      });
    }

    return signedUrl;
  },

  /**
   * Idempotently removes a video file from storage.
   */
  async deleteVideo(filePath: string): Promise<boolean> {
    return this.getProvider().deleteVideo(filePath);
  },

  /**
   * Cleans up previous uploaded video files for a room (both Storage objects and usage metrics)
   * when replacing a video or switching to a URL/YouTube source.
   */
  async cleanupRoomVideos(roomId: string, excludePath?: string): Promise<void> {
    bandwidthService.markRoomUploadsDeleted(roomId);

    if (!isSupabaseConfigured() || typeof window === 'undefined') {
      return;
    }

    try {
      await fetch(`/api/rooms/${encodeURIComponent(roomId)}/video`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(excludePath ? { excludePath } : {}),
      });
    } catch {
      // Non-blocking cleanup fallback
    }
  },
};
