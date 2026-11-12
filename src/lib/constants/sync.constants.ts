/**
 * Core synchronization thresholds, timing parameters, and Free-tier resource limits.
 *
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
  // Increased heartbeat to 3500ms (3.5s) to save ~30% Realtime messages while staying well within deadband
  HEARTBEAT_INTERVAL_MS: 3500,
  HOST_GRACE_PERIOD_MS: 30000,
  PRESENCE_PING_INTERVAL_MS: 10000,

  // Video and bandwidth limits (Supabase Free-Tier Optimization)
  MAX_UPLOAD_SIZE_BYTES: 50 * 1024 * 1024, // 50MB single-file cap
  CACHE_CONTROL_SECONDS: 604800, // 7 days edge CDN range cache (reduces origin egress)

  // Supabase Free-Tier Monthly Bandwidth Guardrails
  FREE_TIER_MONTHLY_EGRESS_LIMIT_BYTES: 2 * 1024 * 1024 * 1024, // 2 GB
  FREE_TIER_STORAGE_LIMIT_BYTES: 1 * 1024 * 1024 * 1024, // 1 GB
  SOFT_WARNING_EGRESS_BYTES: 1.5 * 1024 * 1024 * 1024, // 1.5 GB (75% threshold)
  HARD_CEILING_EGRESS_BYTES: 1.8 * 1024 * 1024 * 1024, // 1.8 GB (90% threshold - disables personal uploads)

  // Quotas & Participant Caps
  MAX_ACTIVE_UPLOADS_PER_USER: 3, // Max 3 active uploaded video files per user
  MAX_ACTIVE_UPLOADS_PER_ROOM: 1, // Max 1 active video uploaded per room at a time
  MAX_ROOM_PARTICIPANTS: 4, // Prevents viral link viewer stampedes causing egress spikes

  // Video Lifecycle & Cleanup
  VIDEO_EXPIRY_AFTER_ROOM_CLOSE_MS: 24 * 60 * 60 * 1000, // 24 hours after room closure
  VIDEO_EXPIRY_ABANDONED_ROOM_MS: 7 * 24 * 60 * 60 * 1000, // 7 days for inactive rooms
} as const;

export const CALL_CONSTANTS = {
  // Voice call hard limit (matches 4-viewer room cap for 4-way audio mesh)
  MAX_CALL_PARTICIPANTS: 4,

  // Slot lease & heartbeat timing (matches SQL 60s TTL in 006_voice_call_authorization.sql)
  CALL_SLOT_TTL_SECONDS: 60,
  CALL_HEARTBEAT_INTERVAL_MS: 20_000,

  // Refresh TURN credentials before server-issued TTL expires
  TURN_REFRESH_BUFFER_SECONDS: 120,
  DEFAULT_TURN_TTL_SECONDS: 3600,

  // Signaling payload bounds & per-peer inbound rate guard
  MAX_SDP_BYTES: 16_384,
  MAX_ICE_BYTES: 1024,
  MAX_SIGNAL_EVENT_BYTES: 20_480,
  MAX_SIGNALS_PER_SECOND: 30,

  // Audio-only WebRTC monitoring & recovery timings
  SPEAKING_LEVEL_THRESHOLD: 18,
  SPEAKING_HOLD_MS: 350,
  ICE_DISCONNECT_GRACE_MS: 3500,
} as const;
