import {
  IVideoStorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
  StorageValidationResult,
} from '@/core/types/storage.types';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';

/**
 * Cloudflare R2 Storage Adapter Design Template.
 * Cloudflare R2 charges $0.00 for data egress (zero bandwidth costs).
 * 
 * To activate in the future:
 * 1. Configure R2 S3-compatible client or pre-signed URL worker endpoint.
 * 2. Set NEXT_PUBLIC_STORAGE_PROVIDER=cloudflare-r2 in environment.
 * 3. Zero frontend/sync changes required.
 */
export class CloudflareR2StorageProvider implements IVideoStorageProvider {
  readonly providerName = 'cloudflare-r2';
  private publicEndpoint: string;

  constructor(publicEndpoint = process.env.NEXT_PUBLIC_R2_PUBLIC_ENDPOINT || '') {
    this.publicEndpoint = publicEndpoint;
  }

  validateFile(file: File): StorageValidationResult {
    if (!file) return { isValid: false, error: 'No file provided.' };
    if (file.size > SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES) {
      return { isValid: false, error: 'File size exceeds maximum permitted limit.' };
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
        provider: 'r2',
        error: validation.error,
      };
    }

    try {
      const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${options.roomId}/${Date.now()}_${sanitized}`;

      // In production R2 setup, this calls a Next.js Server Action or Edge function
      // that returns an S3 presigned PUT URL with zero egress fees:
      // const { uploadUrl } = await getR2PresignedUploadUrl(filePath);
      // await fetch(uploadUrl, { method: 'PUT', body: file });

      const playbackUrl = this.publicEndpoint
        ? `${this.publicEndpoint}/${filePath}`
        : `/api/storage/r2/${filePath}`;

      return {
        url: playbackUrl,
        filePath,
        filename: file.name,
        sizeBytes: file.size,
        provider: 'r2',
      };
    } catch (err) {
      return {
        url: '',
        filePath: '',
        filename: file.name,
        sizeBytes: file.size,
        provider: 'r2',
        error: err instanceof Error ? err.message : 'R2 upload failure',
      };
    }
  }

  async getSignedPlaybackUrl(filePath: string): Promise<string | null> {
    if (this.publicEndpoint) {
      return `${this.publicEndpoint}/${filePath}`;
    }
    return `/api/storage/r2/${filePath}`;
  }

  async deleteVideo(filePath: string): Promise<boolean> {
    console.info(`[Syncora R2 Adapter] Deleting object ${filePath}`);
    return true;
  }
}

