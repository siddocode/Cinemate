import {
  IVideoStorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
  StorageValidationResult,
} from '@/core/types/storage.types';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';

const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
];

export class SupabaseStorageProvider implements IVideoStorageProvider {
  readonly providerName = 'supabase';
  private bucketName = 'videos';

  validateFile(file: File): StorageValidationResult {
    if (!file) {
      return { isValid: false, error: 'No file provided.' };
    }

    if (file.size > SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES) {
      const maxMb = SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
      return {
        isValid: false,
        error: `File size exceeds the ${maxMb}MB free-tier limit. For longer movies, please use a direct video URL or YouTube.`,
      };
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        isValid: false,
        error: 'Unsupported format. Please upload an MP4, WebM, or MOV video.',
      };
    }

    return { isValid: true };
  }

  async uploadVideo(
    file: File,
    options: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const validation = this.validateFile(file);
    if (!validation.isValid) {
      return {
        url: '',
        filePath: '',
        filename: file.name,
        sizeBytes: file.size,
        provider: 'supabase',
        error: validation.error,
      };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${options.roomId}/${Date.now()}_${sanitizedName}`;
      const cacheControl = options.cacheControlSeconds
        ? `${options.cacheControlSeconds}`
        : `${SYNC_CONSTANTS.CACHE_CONTROL_SECONDS}`; // 7 days (604800s) for CDN range caching

      if (options.onProgress) options.onProgress(20);

      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, file, {
          cacheControl,
          upsert: true,
        });

      if (error || !data) {
        return {
          url: '',
          filePath,
          filename: file.name,
          sizeBytes: file.size,
          provider: 'supabase',
          error: error?.message || 'Failed to upload video to Supabase Storage.',
        };
      }

      if (options.onProgress) options.onProgress(80);

      // Request 6-hour signed URL for private streaming
      const signedUrl = await this.getSignedPlaybackUrl(filePath, 21600);

      let finalUrl = signedUrl || '';
      if (!finalUrl) {
        // Fallback to public URL if bucket was left public
        const { data: publicUrlData } = supabase.storage
          .from(this.bucketName)
          .getPublicUrl(filePath);
        finalUrl = publicUrlData.publicUrl;
      }

      if (options.onProgress) options.onProgress(100);

      return {
        url: finalUrl,
        filePath,
        filename: file.name,
        sizeBytes: file.size,
        provider: 'supabase',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown upload error';
      return {
        url: '',
        filePath: '',
        filename: file.name,
        sizeBytes: file.size,
        provider: 'supabase',
        error: msg,
      };
    }
  }

  async getSignedPlaybackUrl(
    filePath: string,
    expiresInSeconds = 21600
  ): Promise<string | null> {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .createSignedUrl(filePath, expiresInSeconds);

      if (error || !data) {
        console.warn('[Syncora] Error generating signed URL:', error);
        return null;
      }

      return data.signedUrl;
    } catch (err) {
      console.warn('[Syncora] Exception creating signed URL:', err);
      return null;
    }
  }

  async deleteVideo(filePath: string): Promise<boolean> {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.storage
        .from(this.bucketName)
        .remove([filePath]);

      if (error) {
        console.warn(`[Syncora] Failed to delete video object ${filePath}:`, error);
        return false;
      }

      return true;
    } catch (err) {
      console.warn(`[Syncora] Exception deleting video object ${filePath}:`, err);
      return false;
    }
  }
}

