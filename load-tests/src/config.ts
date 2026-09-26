import { resolve } from 'node:path';
import {
  CAMPAIGN_CONFIRMATION,
  COLD_CONNECT_RATES,
  DEFAULT_IDLE_BASELINE_SECONDS,
  DEFAULT_SEED,
  KNOWN_STAGING_PROJECT_REF,
  MAX_APPROVED_USERS,
  MAX_CHANNELS_PER_USER,
  PLATEAU_RAMP_SECONDS,
  PRODUCTION_PROJECT_REF,
  REALTIME_LIMIT_FRACTION,
  SYNTHETIC_PREFIX,
  WRITE_CONFIRMATION,
} from './constants.js';
import type { CacheMode, ExperimentState, LoadTestConfig, Scenario } from './types.js';

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function positiveInteger(env: Environment, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function optionalInteger(env: Environment, name: string, fallback: number, min: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

export function projectRefFromUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('LOADTEST_SUPABASE_URL must be a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('LOADTEST_SUPABASE_URL must use https');
  const match = /^([a-z]{20})\.supabase\.co$/.exec(url.hostname.toLowerCase());
  if (!match?.[1]) throw new Error('LOADTEST_SUPABASE_URL must be exactly https://<20-letter-ref>.supabase.co');
  return match[1];
}

export function calculateCeiling(realtimeLimit: number): number {
  if (!Number.isInteger(realtimeLimit) || realtimeLimit < 1) {
    throw new Error('LOADTEST_VERIFIED_REALTIME_LIMIT must be a positive integer');
  }
  return Math.min(MAX_APPROVED_USERS, Math.floor(realtimeLimit * REALTIME_LIMIT_FRACTION));
}

/** Peak planned channel joins/second for a scenario's user-arrival rate. */
export function plannedJoinsPerSecond(requestedUsers: number, scenario: Scenario, coldConnectRate: number): number {
  const arrivalsPerSecond = scenario === 'cold-connect' ? coldConnectRate : requestedUsers / PLATEAU_RAMP_SECONDS;
  return arrivalsPerSecond * MAX_CHANNELS_PER_USER;
}

export function loadConfig(env: Environment = process.env): LoadTestConfig {
  const supabaseUrl = required(env, 'LOADTEST_SUPABASE_URL').replace(/\/$/, '');
  const stagingRef = required(env, 'LOADTEST_STAGING_REF').toLowerCase();
  const actualRef = projectRefFromUrl(supabaseUrl);
  if (actualRef === PRODUCTION_PROJECT_REF || stagingRef === PRODUCTION_PROJECT_REF) {
    throw new Error(`REFUSING PRODUCTION TARGET: ${PRODUCTION_PROJECT_REF}`);
  }
  if (stagingRef !== KNOWN_STAGING_PROJECT_REF) {
    throw new Error(`REFUSING NON-ALLOWLISTED TARGET: expected staging ref ${KNOWN_STAGING_PROJECT_REF}`);
  }
  if (actualRef !== stagingRef) throw new Error(`Target URL ref ${actualRef} does not match LOADTEST_STAGING_REF ${stagingRef}`);

  const namespace = required(env, 'LOADTEST_NAMESPACE');
  if (!namespace.startsWith(SYNTHETIC_PREFIX) || !/^[a-z0-9-]{12,64}$/.test(namespace)) {
    throw new Error(`LOADTEST_NAMESPACE must match ${SYNTHETIC_PREFIX}* and contain only lowercase letters, digits, and hyphens`);
  }
  const state = required(env, 'LOADTEST_EXPECTED_STATE');
  if (state !== '148' && state !== '149') throw new Error('LOADTEST_EXPECTED_STATE must be 148 or 149');

  const realtimeLimit = positiveInteger(env, 'LOADTEST_VERIFIED_REALTIME_LIMIT');
  const joinsPerSecondLimit = positiveInteger(env, 'LOADTEST_VERIFIED_JOINS_PER_SECOND_LIMIT');
  const requestedUsers = positiveInteger(env, 'LOADTEST_REQUESTED_USERS');
  const syntheticUsers = Number(env.LOADTEST_SYNTHETIC_USERS ?? 250);
  if (!Number.isInteger(syntheticUsers) || syntheticUsers < Math.max(5, requestedUsers) || syntheticUsers > 500) {
    throw new Error('LOADTEST_SYNTHETIC_USERS must be an integer from max(5, requested users) through 500');
  }
  const effectiveCeiling = calculateCeiling(realtimeLimit);
  if (requestedUsers > effectiveCeiling) {
    throw new Error(`Requested ${requestedUsers} users exceeds approved ceiling ${effectiveCeiling}`);
  }

  const scenario = (env.LOADTEST_SCENARIO?.trim() || 'steady') as Scenario;
  if (!['steady', 'cold-connect', 'reconnect'].includes(scenario)) throw new Error('LOADTEST_SCENARIO must be steady, cold-connect, or reconnect');
  const coldConnectRate = optionalInteger(env, 'LOADTEST_COLD_CONNECT_RATE', 1, 1);
  if (!(COLD_CONNECT_RATES as readonly number[]).includes(coldConnectRate)) {
    throw new Error(`LOADTEST_COLD_CONNECT_RATE must be one of ${COLD_CONNECT_RATES.join(', ')}`);
  }
  const joinBudget = Math.floor(joinsPerSecondLimit * REALTIME_LIMIT_FRACTION);
  const plannedJoins = plannedJoinsPerSecond(requestedUsers, scenario, coldConnectRate);
  if (plannedJoins > joinBudget) {
    throw new Error(`Planned ${plannedJoins.toFixed(1)} channel joins/second exceeds 75% of the verified joins/second limit (${joinBudget})`);
  }

  const cacheMode = (env.LOADTEST_CACHE_MODE?.trim() || '') as CacheMode;
  if (cacheMode !== 'cold' && cacheMode !== 'warm') throw new Error('LOADTEST_CACHE_MODE must be cold or warm');
  const runLabel = required(env, 'LOADTEST_RUN_LABEL');
  if (!/^[a-z0-9-]{1,32}$/.test(runLabel)) throw new Error('LOADTEST_RUN_LABEL must be 1–32 lowercase letters, digits, or hyphens');
  const edgeFunctionInventory = required(env, 'LOADTEST_EDGE_FUNCTION_INVENTORY');

  const databaseUrl = env.LOADTEST_DATABASE_URL?.trim();
  if (databaseUrl?.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('REFUSING PRODUCTION DATABASE URL');
  }
  if (databaseUrl && !databaseUrl.toLowerCase().includes(stagingRef)) {
    throw new Error('LOADTEST_DATABASE_URL does not identify the allowlisted staging project');
  }
  const emailDomain = required(env, 'LOADTEST_EMAIL_DOMAIN').toLowerCase();
  if (!emailDomain.endsWith('.invalid')) throw new Error('LOADTEST_EMAIL_DOMAIN must use the reserved .invalid TLD');
  const base = resolve(env.LOADTEST_RESULTS_DIR?.trim() || 'load-tests/results', namespace);
  const seed = Number(env.LOADTEST_SEED ?? DEFAULT_SEED);
  if (!Number.isSafeInteger(seed) || seed < 1) throw new Error('LOADTEST_SEED must be a positive safe integer');
  const diskIopsRaw = env.LOADTEST_DISK_IOPS_LIMIT?.trim();
  const diskIopsLimit = diskIopsRaw ? Number(diskIopsRaw) : undefined;
  if (diskIopsLimit !== undefined && (!Number.isInteger(diskIopsLimit) || diskIopsLimit < 1)) throw new Error('LOADTEST_DISK_IOPS_LIMIT must be a positive integer');
  return {
    supabaseUrl,
    anonKey: required(env, 'LOADTEST_SUPABASE_ANON_KEY'),
    serviceRoleKey: env.LOADTEST_SUPABASE_SERVICE_ROLE_KEY?.trim(),
    databaseUrl,
    stagingRef,
    universityId: required(env, 'LOADTEST_UNIVERSITY_ID'),
    emailDomain,
    namespace,
    seed,
    requestedUsers,
    syntheticUsers,
    realtimeLimit,
    joinsPerSecondLimit,
    effectiveCeiling,
    state: state as ExperimentState,
    scenario,
    coldConnectRate,
    cacheMode,
    runLabel,
    idleBaselineSeconds: optionalInteger(env, 'LOADTEST_IDLE_BASELINE_SECONDS', DEFAULT_IDLE_BASELINE_SECONDS, 60),
    authSignInIntervalMs: optionalInteger(env, 'LOADTEST_AUTH_SIGNIN_INTERVAL_MS', 10_000, 250),
    diskIopsLimit,
    edgeFunctionInventory,
    resultsDir: base,
    runDir: resolve(base, 'runs', `${state}-${scenario}-${cacheMode}-${runLabel}`),
    traceFile: resolve(base, 'action-trace.json'),
    manifestFile: resolve(base, 'synthetic-manifest.json'),
    sessionsFile: resolve(base, 'private', 'sessions.json'),
    writeApproved: env.LOADTEST_CONFIRM_WRITES === WRITE_CONFIRMATION,
    campaignApproved: env.LOADTEST_CONFIRM_CAMPAIGN === CAMPAIGN_CONFIRMATION,
  };
}

export function assertWriteApproved(config: LoadTestConfig): void {
  if (!config.writeApproved) throw new Error(`REFUSING WRITE: set LOADTEST_CONFIRM_WRITES=${WRITE_CONFIRMATION} after staging verification`);
}

export function assertCampaignApproved(config: LoadTestConfig): void {
  if (!config.campaignApproved) {
    throw new Error(`REFUSING LOAD: separate campaign approval is required; then set LOADTEST_CONFIRM_CAMPAIGN=${CAMPAIGN_CONFIRMATION}`);
  }
}

/** Non-secret configuration that must be identical between compared runs. */
export function controlledConfig(config: LoadTestConfig): Record<string, string | number | undefined> {
  return {
    stagingRef: config.stagingRef,
    universityId: config.universityId,
    emailDomain: config.emailDomain,
    namespace: config.namespace,
    seed: config.seed,
    requestedUsers: config.requestedUsers,
    syntheticUsers: config.syntheticUsers,
    realtimeLimit: config.realtimeLimit,
    joinsPerSecondLimit: config.joinsPerSecondLimit,
    effectiveCeiling: config.effectiveCeiling,
    scenario: config.scenario,
    coldConnectRate: config.coldConnectRate,
    cacheMode: config.cacheMode,
    idleBaselineSeconds: config.idleBaselineSeconds,
    diskIopsLimit: config.diskIopsLimit,
    edgeFunctionInventory: config.edgeFunctionInventory,
  };
}
