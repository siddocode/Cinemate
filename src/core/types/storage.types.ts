/**
 * Provider-independent video storage abstractions for Syncora.
 * Allows seamless migration between Supabase Storage, Cloudflare R2, AWS S3, or Local storage
 * without altering UI or room synchronization logic.
 */

export interface StorageUploadOptions {
  roomId: string;
  userId: string;
  onProgress?: (percent: number) => void;
  cacheControlSeconds?: number;
}

export interface StorageUploadResult {
  url: string;
  filePath: string;
  filename: string;
  sizeBytes: number;
  provider: 'supabase' | 'r2' | 's3' | 'local';
  error?: string;
}

export interface StorageValidationResult {
  isValid: boolean;
  error?: string;
}

export interface IVideoStorageProvider {
  /**
   * Identifies the underlying storage provider (e.g., 'supabase', 'cloudflare-r2', 'local').
   */
  readonly providerName: string;

  /**
   * Validates file size and format constraints before upload.
   */
  validateFile(file: File): StorageValidationResult;

  /**
   * Uploads a video file to the storage provider and returns an initial access URL.
   */
  uploadVideo(file: File, options: StorageUploadOptions): Promise<StorageUploadResult>;

  /**
   * Generates a time-limited signed URL for streaming or downloading a private video object.
   */
  getSignedPlaybackUrl(filePath: string, expiresInSeconds?: number): Promise<string | null>;

  /**
   * Deletes a video object from storage. Must be idempotent and safe to retry.
   */
  deleteVideo(filePath: string): Promise<boolean>;
}

