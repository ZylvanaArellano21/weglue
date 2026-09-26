import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { HARD_STOP_THRESHOLDS as T } from './constants.js';
import { hostCounters, HostTracker, parsePrometheus, SustainedCondition } from './prometheus.js';
import { OBSERVER_SQL } from './observer-sql.js';
import type { SyntheticManifest } from './types.js';

// The only long-running privileged process: it holds the staging database URL
// and (optionally) the service-role key for the Metrics API scrape. It never
// generates load. It runs for the whole campaign — idle baseline, plateaus and
// cooldowns — writing one NDJSON sample every 5 s, and exits 42 on a hard stop.

const connectionString = process.env.LOADTEST_DATABASE_URL;
const stopFile = process.env.LOADTEST_EXTERNAL_STOP_FILE;
const manifestFile = process.env.LOADTEST_MANIFEST_FILE;
const runStartedAt = process.env.LOADTEST_RUN_STARTED_AT;
const supabaseUrl = process.env.LOADTEST_SUPABASE_URL;
const metricsKey = process.env.LOADTEST_SUPABASE_SERVICE_ROLE_KEY;
const diskIopsLimit = process.env.LOADTEST_DISK_IOPS_LIMIT ? Number(process.env.LOADTEST_DISK_IOPS_LIMIT) : undefined;
if (!connectionString || !stopFile || !manifestFile || !runStartedAt || !supabaseUrl) throw new Error('Observer worker environment is incomplete');
const externalStopFile: string = stopFile;
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as SyntheticManifest;
const syntheticIds = manifest.users.map((user) => user.id);

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, application_name: 'weglue-loadtest-observer' });
let baselineDeadlocks = 0;
let stopped = false;
let metricsWarned = false;
const connectionPressure = new SustainedCondition(T.databasePressureWindowSeconds * 1_000);
const memoryPressure = new SustainedCondition(T.databasePressureWindowSeconds * 1_000);
const hostTracker = new HostTracker(diskIopsLimit);
const cpuPressure = new SustainedCondition(T.databaseCpuWindowSeconds * 1_000);
const iopsPressure = new SustainedCondition(T.databaseDiskIopsWindowSeconds * 1_000);

async function scrapeHost(): Promise<Record<string, number | boolean | undefined>> {
  if (!metricsKey) return { metricsApiAvailable: false };
  try {
    const response = await fetch(`${supabaseUrl}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${metricsKey}`).toString('base64')}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const tracked = hostTracker.update(hostCounters(parsePrometheus(await response.text()), Date.now()));
    return { metricsApiAvailable: true, ...tracked };
  } catch (error) {
    if (!metricsWarned) process.stderr.write(`Observer: Metrics API unavailable (${String(error)}); dashboard watch is mandatory\n`);
    metricsWarned = true;
    return { metricsApiAvailable: false };
  }
}

async function sample(): Promise<void> {
  if (existsSync(externalStopFile)) throw new Error('External operator hard stop requested');
  const result = await pool.query(OBSERVER_SQL, [syntheticIds, runStartedAt, manifest.conversationIds]);
  const row = result.rows[0] as Record<string, string | number>;
  if (!row) throw new Error('Database observer returned no row');
  const host = await scrapeHost();
  const now = Date.now();
  const metrics = {
    type: 'database',
    at: new Date(now).toISOString(),
    connections: Number(row.connections),
    maxConnections: Number(row.max_connections),
    activeConnections: Number(row.active_connections),
    idleConnections: Number(row.idle_connections),
    lockWaiting: Number(row.lock_waiting),
    deadlocks: Number(row.deadlocks),
    xactCommit: Number(row.xact_commit),
    xactRollback: Number(row.xact_rollback),
    tempBytes: Number(row.temp_bytes),
    maxBlockedSeconds: Number(row.max_blocked_seconds),
    longestTransactionSeconds: Number(row.longest_transaction_seconds),
    pushPending: Number(row.push_pending),
    pushOldestPendingSeconds: Number(row.push_oldest_pending_seconds),
    netQueue: Number(row.net_queue),
    notificationsSinceStart: Number(row.notifications_since_start),
    nonSyntheticRecipients: Number(row.non_synthetic_recipients),
    foreignConversationWrites: Number(row.foreign_conversation_writes),
    ...host,
  };
  process.stdout.write(`${JSON.stringify(metrics)}\n`);

  const reasons: string[] = [];
  const connectionRatio = metrics.connections / metrics.maxConnections;
  if (connectionPressure.update(connectionRatio >= T.databaseConnectionRatio, now)) reasons.push('database connections >= 85% for 60s');
  if (metrics.deadlocks > baselineDeadlocks) reasons.push('new database deadlock');
  if (metrics.maxBlockedSeconds > T.blockingQuerySeconds) reasons.push('blocked query older than 30s');
  if (metrics.netQueue > T.netQueueDepth) reasons.push(`pg_net request queue ${metrics.netQueue} > ${T.netQueueDepth}`);
  if (metrics.nonSyntheticRecipients > 0) reasons.push('synthetic actors notified a non-synthetic user');
  if (metrics.foreignConversationWrites > 0) reasons.push('synthetic users wrote outside the manifest conversations');
  if (cpuPressure.update((host.cpuRatio as number | undefined ?? 0) >= T.databaseCpuRatio, now)) reasons.push('database CPU >= 90% for 2 minutes');
  if (memoryPressure.update((host.memoryRatio as number | undefined ?? 0) >= T.databaseMemoryRatio, now)) reasons.push('database memory >= 90% for 60s');
  if (iopsPressure.update((host.diskIopsRatio as number | undefined ?? 0) >= T.databaseDiskIopsRatio, now)) reasons.push('disk IOPS >= 95% of limit for 2 minutes');
  if (reasons.length > 0) {
    process.stdout.write(`${JSON.stringify({ type: 'hard-stop', source: 'observer', reasons, at: new Date().toISOString() })}\n`);
    throw new Error(reasons.join('; '));
  }
}

try {
  const initial = await pool.query<{ deadlocks: string }>('select coalesce(sum(deadlocks), 0)::text as deadlocks from pg_stat_database');
  baselineDeadlocks = Number(initial.rows[0]?.deadlocks ?? 0);
} catch (error) {
  process.stderr.write(`Observer startup failed: ${String(error)}\n`);
  process.exit(42);
}

let sampling = false;
const timer = setInterval(() => {
  if (sampling) return;
  sampling = true;
  void sample()
    .catch((error) => {
      process.stderr.write(`HARD STOP (observer): ${String(error)}\n`);
      void shutdown(42);
    })
    .finally(() => {
      sampling = false;
    });
}, 5_000);

async function shutdown(code: number): Promise<void> {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  await pool.end().catch(() => undefined);
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown(0));
