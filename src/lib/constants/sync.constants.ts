/**
 * Core synchronization thresholds and timing parameters.
 * Tiered drift strategy:
 *   1. Drift < 0.5s: In sync (deadband)
 *   2. 0.5s <= Drift <= 2.0s: Rate nudge (1.05x / 0.95x)
 *   3. Drift > 2.0s: Hard seek
 */

export const SYNC_CONSTANTS = {
  // Drift thresholds in seconds
  DEADBAND_SECONDS: 0.5,
  MICRO_DRIFT_MAX_SECONDS: 2.0,

  // Playback rate nudging factors
  NUDGE_RATE_AHEAD: 0.95,
  NUDGE_RATE_BEHIND: 1.05,
  NORMAL_PLAYBACK_RATE: 1.0,

  // Timing intervals in milliseconds
  HEARTBEAT_INTERVAL_MS: 2500,
  HOST_GRACE_PERIOD_MS: 30000,
  PRESENCE_PING_INTERVAL_MS: 10000,

  // Video limits
  MAX_UPLOAD_SIZE_BYTES: 50 * 1024 * 1024, // 50MB (Supabase free-tier limit)
} as const;

