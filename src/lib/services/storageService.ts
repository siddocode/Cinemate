import { getSupabaseBrowserClient } from '../supabase/client';
import { isSupabaseConfigured } from '../supabase/config';
import { SYNC_CONSTANTS } from '../constants/sync.constants';

const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
];

export interface UploadResult {
  url: string;
  filename: string;
  sizeBytes: number;
  error?: string;
}

export const storageService = {
  /**
   * Validates file size and format against 50MB free-tier constraints.
   */
  validateVideoFile(file: File): { isValid: boolean; error?: string } {
    if (!file) {
      return { isValid: false, error: 'No file provided.' };
    }

    if (file.size > SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES) {
      const maxMb = SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
      return {
        isValid: false,
        error: `File size exceeds the ${maxMb}MB limit. For longer movies or larger files, please paste a direct video URL.`,
      };
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        isValid: false,
        error: 'Unsupported file format. Please upload an MP4, WebM, or MOV video.',
      };
    }

    return { isValid: true };
  },

  /**
   * Uploads personal video to Supabase Storage bucket 'videos'
   * or falls back to browser Blob URL for local development.
   */
  async uploadVideo(
    file: File,
    roomId: string,
    onProgress?: (percent: number) => void
  ): Promise<UploadResult> {
    const validation = this.validateVideoFile(file);
    if (!validation.isValid) {
      return { url: '', filename: file.name, sizeBytes: file.size, error: validation.error };
    }

    // Dev Fallback Mode: generate object URL
    if (!isSupabaseConfigured()) {
      if (onProgress) {
        onProgress(30);
        await new Promise((r) => setTimeout(r, 150));
        onProgress(70);
        await new Promise((r) => setTimeout(r, 150));
        onProgress(100);
      }
      const localBlobUrl = URL.createObjectURL(file);
      return {
        url: localBlobUrl,
        filename: file.name,
        sizeBytes: file.size,
      };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${roomId}/${Date.now()}_${sanitizedName}`;

      if (onProgress) onProgress(20);

      const { data, error } = await supabase.storage
        .from('videos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (error || !data) {
        return {
          url: '',
          filename: file.name,
          sizeBytes: file.size,
          error: error?.message || 'Failed to upload video to storage.',
        };
      }

      if (onProgress) onProgress(80);

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('videos')
        .getPublicUrl(filePath);

      if (onProgress) onProgress(100);

      return {
        url: publicUrlData.publicUrl,
        filename: file.name,
        sizeBytes: file.size,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown upload error';
      return {
        url: '',
        filename: file.name,
        sizeBytes: file.size,
        error: msg,
      };
    }
  },
};

