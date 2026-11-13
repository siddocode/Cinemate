import { QueueVideoInput } from '@/core/types/room.types';

const PENDING_QUEUE_PREFIX = 'syncora.pendingQueue.v1';

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isQueueVideoInput(value: unknown): value is QueueVideoInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<QueueVideoInput>;
  return (
    typeof candidate.title === 'string' &&
    candidate.title.trim().length > 0 &&
    (candidate.videoType === 'youtube' ||
      candidate.videoType === 'url' ||
      candidate.videoType === 'upload') &&
    (typeof candidate.videoId === 'string' || typeof candidate.videoUrl === 'string')
  );
}

export function savePendingQueue(
  roomCode: string,
  items: QueueVideoInput[],
  storage: Storage | null = getStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      `${PENDING_QUEUE_PREFIX}:${roomCode.toUpperCase()}`,
      JSON.stringify(items.slice(0, 30))
    );
  } catch {
    // Session storage may be unavailable in private browsing; queue seeding is optional.
  }
}

export function consumePendingQueue(
  roomCode: string,
  storage: Storage | null = getStorage()
): QueueVideoInput[] {
  if (!storage) return [];
  const key = `${PENDING_QUEUE_PREFIX}:${roomCode.toUpperCase()}`;
  try {
    const raw = storage.getItem(key);
    storage.removeItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueueVideoInput);
  } catch {
    return [];
  }
}
