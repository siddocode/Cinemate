/**
 * Room code generation and normalization.
 * Generates memorable alphanumeric codes (e.g. "SYNC-8492")
 */

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude easily confused characters (0, O, 1, I)
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SYNC-${code}`;
}

export function normalizeRoomCode(input: string): string {
  const cleaned = input.trim().toUpperCase();
  if (cleaned.startsWith('SYNC-')) {
    return cleaned;
  }
  return `SYNC-${cleaned}`;
}

