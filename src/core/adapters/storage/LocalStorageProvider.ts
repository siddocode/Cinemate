import {
  IVideoStorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
  StorageValidationResult,
} from '@/core/types/storage.types';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';

const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
];

export class LocalStorageProvider implements IVideoStorageProvider {
  readonly providerName = 'local';
  private objectUrls: Map<string, string> = new Map();

  validateFile(file: File): StorageValidationResult {
    if (!file) {
      return { isValid: false, error: 'No file provided.' };
    }

    if (file.size > SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES) {
      const maxMb = SYNC_CONSTANTS.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
      return {
        isValid: false,
        error: `File size exceeds the ${maxMb}MB limit.`,
      };
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        isValid: false,
        error: 'Unsupported file format.',
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
        provider: 'local',
        error: validation.error,
      };
    }

    if (options.onProgress) {
      options.onProgress(30);
      await new Promise((r) => setTimeout(r, 100));
      options.onProgress(70);
      await new Promise((r) => setTimeout(r, 100));
      options.onProgress(100);
    }

    const localBlobUrl = URL.createObjectURL(file);
    const mockPath = `${options.roomId}/${Date.now()}_${file.name}`;
    this.objectUrls.set(mockPath, localBlobUrl);

    return {
      url: localBlobUrl,
      filePath: mockPath,
      filename: file.name,
      sizeBytes: file.size,
      provider: 'local',
    };
  }

  async getSignedPlaybackUrl(filePath: string): Promise<string | null> {
    return this.objectUrls.get(filePath) || null;
  }

  async deleteVideo(filePath: string): Promise<boolean> {
    const existing = this.objectUrls.get(filePath);
    if (existing) {
      URL.revokeObjectURL(existing);
      this.objectUrls.delete(filePath);
    }
    return true;
  }
}

