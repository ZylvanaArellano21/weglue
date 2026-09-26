export const APPLICATION_CONTRACT_COMMIT = '9f16ae84af7b3959141c042bd049f3e47a6a72d1';
export const PRODUCTION_PROJECT_REF = 'yoozrnosmqtaiksgcixc';
export const KNOWN_STAGING_PROJECT_REF = 'cwwmuxxqxovhcnnardlj';
export const MIGRATION_149_FILE = '149_realtime_sync_block_auth.sql';
export const MIGRATION_149_SHA256 = '7e2a3b8636b6edddcb2a1e6795808474c16c8a0c492406a2eeb510d3e4bbb666';
export const MIGRATION_150_FILE = '150_dispatch_push_statement_wakeup.sql';
export const MIGRATION_150_SHA256 = '79e45736327273ce344450f56eb247ab6ad3a92790115cb8bebf1e3f2f224eb4';

export const MAX_APPROVED_USERS = 150;
export const REALTIME_LIMIT_FRACTION = 0.75;
export const DEFAULT_RAMP = [1, 5, 10, 25, 50, 75, 100, 150] as const;

// Approved plateau schedule: 1 and 5 users hold 5 minutes, 10–100 hold 10
// minutes, and the campaign ceiling holds 15 minutes. Every plateau ramps over
// two minutes and is followed by a five-minute idle cooldown.
export const PLATEAU_HOLD_SECONDS: Readonly<Record<number, number>> = Object.freeze({
  1: 300,
  5: 300,
  10: 600,
  25: 600,
  50: 600,
  75: 600,
  100: 600,
  150: 900,
});
export const CEILING_PLATEAU_HOLD_SECONDS = 900;
export const PLATEAU_RAMP_SECONDS = 120;
export const PLATEAU_RAMP_DOWN_SECONDS = 30;
export const PLATEAU_COOLDOWN_SECONDS = 300;
export const DEFAULT_IDLE_BASELINE_SECONDS = 900;
export const MEASUREMENT_WINDOW_SECONDS = 60;

// Approved action pacing: uniformly random 8–20 s (≈14 s mean).
export const THINK_TIME_MIN_MS = 8_000;
export const THINK_TIME_MAX_MS = 20_000;

// Approved archetype mix.
export const ARCHETYPE_MIX = Object.freeze({ browser: 0.6, social: 0.25, communicator: 0.15 });

export const WRITE_CONFIRMATION = 'I_ACKNOWLEDGE_SYNTHETIC_STAGING_WRITES_ONLY';
export const CAMPAIGN_CONFIRMATION = 'I_HAVE_SEPARATE_APPROVAL_TO_RUN_THE_STAGING_CAMPAIGN';

export const SYNTHETIC_PREFIX = 'wg-loadtest-';
export const SYNTHETIC_EMAIL_LOCAL_PREFIX = 'wg-loadtest-';
export const DEFAULT_SEED = 1481492026;

// Channel topology of a signed-in student at the contract commit. The four
// private-broadcast topics (lib/realtime.ts subscribeBroadcast*) and the two
// public postgres_changes channels (createSafeChannel) are always held.
// Communicators additionally hold `sync:message:<conversation>` (open thread),
// and every user holds `sync:message-inbox-conv:<conversation>:<epoch>` for each
// conversation the backend has switched to conversation-scoped banners.
export const BASE_PRIVATE_TOPIC_KINDS = ['access', 'university', 'message-inbox', 'block'] as const;
export const POSTGRES_CHANGES_TOPIC_KINDS = ['notifications', 'club-sync'] as const;
export const BASE_CHANNELS_PER_USER = BASE_PRIVATE_TOPIC_KINDS.length + POSTGRES_CHANGES_TOPIC_KINDS.length;
// Upper bound used for join-rate planning: base + open thread + up to five
// conversation-scoped banner topics (one per seeded club conversation).
export const MAX_CHANNELS_PER_USER = BASE_CHANNELS_PER_USER + 1 + 5;
export const BANNER_JOIN_STAGGER_MS = 180;
// Planned cold-connect arrival rates (new users/second), capped at 10.
export const COLD_CONNECT_RATES = [1, 3, 5, 10] as const;

export const HARD_STOP_THRESHOLDS = Object.freeze({
  httpErrorRate: 0.05,
  httpErrorWindowSeconds: 60,
  timeoutRate: 0.01,
  timeoutWindowSeconds: 60,
  interactiveP95Ms: 5_000,
  interactiveWindowSeconds: 120,
  realtimeColdJoinP95Ms: 15_000,
  realtimeResubscribeP95Ms: 15_000,
  realtimeJoinFailureRate: 0.02,
  databaseCpuRatio: 0.9,
  databaseCpuWindowSeconds: 120,
  databaseMemoryRatio: 0.9,
  databaseConnectionRatio: 0.85,
  databasePressureWindowSeconds: 60,
  databaseDiskIopsRatio: 0.95,
  databaseDiskIopsWindowSeconds: 120,
  blockingQuerySeconds: 30,
  generatorCpuRatio: 0.85,
  generatorCpuWindowSeconds: 15,
  generatorEventLoopLagP95Ms: 50,
  droppedIterationRate: 0.01,
  netQueueDepth: 500,
});

// Approved degradation definition (evaluated over two consecutive windows).
export const DEGRADATION_THRESHOLDS = Object.freeze({
  p95RatioToReference: 2,
  p95AbsoluteIncreaseMs: 250,
  requestErrorRate: 0.01,
  realtimeJoinP95Ms: 2_000,
  realtimeJoinFailureRate: 0.005,
  databaseCpuRatio: 0.7,
  databaseConnectionRatio: 0.7,
  droppedIterationRate: 0.005,
  consecutiveWindows: 2,
});

// Recovery: cooldown must return to within 10% of idle health.
export const RECOVERY_TOLERANCE = Object.freeze({ relative: 0.1, connectionSlack: 2, cpuAbsolute: 0.1 });
