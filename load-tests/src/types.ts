export type ExperimentState = '148' | '149';
export type CacheMode = 'cold' | 'warm';
export type Scenario = 'steady' | 'cold-connect' | 'reconnect';
export type Archetype = 'browser' | 'social' | 'communicator';

export type LoadTestConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
  databaseUrl?: string;
  stagingRef: string;
  universityId: string;
  emailDomain: string;
  namespace: string;
  seed: number;
  requestedUsers: number;
  syntheticUsers: number;
  realtimeLimit: number;
  joinsPerSecondLimit: number;
  effectiveCeiling: number;
  state: ExperimentState;
  scenario: Scenario;
  coldConnectRate: number;
  cacheMode: CacheMode;
  runLabel: string;
  idleBaselineSeconds: number;
  authSignInIntervalMs: number;
  diskIopsLimit?: number;
  edgeFunctionInventory: string;
  resultsDir: string;
  runDir: string;
  traceFile: string;
  manifestFile: string;
  sessionsFile: string;
  writeApproved: boolean;
  campaignApproved: boolean;
};

export type SyntheticManifest = {
  schemaVersion: 2;
  namespace: string;
  seed: number;
  stagingRef: string;
  universityId: string;
  universityName: string;
  createdAt: string;
  // Database clock at the end of seeding. Everything a synthetic user owns
  // that was created after this instant is run-generated and resettable.
  seededAt: string;
  users: Array<{ index: number; id: string; email: string; password: string }>;
  clubIds: string[];
  clubSizes: number[];
  eventIds: string[];
  postIds: string[];
  // Trigger-created Members conversation and its main channel, per club.
  conversationIds: string[];
  channelIds: string[];
  messageIds: string[];
};

export type SessionBundle = {
  schemaVersion: 2;
  namespace: string;
  seed: number;
  stagingRef: string;
  generatedAt: string;
  sessions: Array<{ userIndex: number; userId: string; accessToken: string; refreshToken: string; expiresAt: number }>;
};

export type JourneyName =
  | 'launch'
  | 'home'
  | 'events'
  | 'discover'
  | 'club'
  | 'notifications'
  | 'inbox'
  | 'thread'
  | 'message-send'
  | 'social-write';

export type TraceAction = {
  sequence: number;
  userIndex: number;
  journey: JourneyName;
  entityIndex: number;
  thinkTimeMs: number;
  clientTag: string;
};

export type ActionTrace = {
  schemaVersion: 2;
  applicationContract: string;
  namespace: string;
  seed: number;
  users: number;
  iterationsPerUser: number;
  archetypes: Archetype[];
  actions: TraceAction[];
  sha256: string;
};

export type Plateau = {
  index: number;
  users: number;
  rampSeconds: number;
  holdSeconds: number;
  rampDownSeconds: number;
  cooldownSeconds: number;
};

export type MetricSnapshot = {
  sampleSeconds: number;
  httpRequests: number;
  httpErrors: number;
  timeouts: number;
  interactiveP95Ms: number;
  realtimeJoins: number;
  realtimeJoinFailures: number;
  realtimeColdJoinP95Ms: number;
  realtimeResubscribeP95Ms: number;
  databaseCpuRatio?: number;
  databaseMemoryRatio?: number;
  databaseConnectionRatio?: number;
  databaseDiskIopsRatio?: number;
  deadlocks?: number;
  longestBlockingQuerySeconds?: number;
  unexpectedQueueBacklog?: number;
  generatorCpuRatio?: number;
  generatorEventLoopLagP95Ms?: number;
  attemptedIterations?: number;
  droppedIterations?: number;
  providerQuotaError?: boolean;
  nonSyntheticWriteDetected?: boolean;
};
