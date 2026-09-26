import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, type WriteStream } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { analyzeRun, analyzePlateau, readNdjson, type DatabaseSample, type K6Summary, type RealtimeWindowRecord, type RunEvent } from './analyze.js';
import { assertSessionsCover, refreshSessionsUntil } from './auth.js';
import { countRunScopedRows } from './cleanup.js';
import { assertCampaignApproved } from './config.js';
import { HARD_STOP_THRESHOLDS as T } from './constants.js';
import { assertManifestHasNoSecrets, buildRunManifest, type RunManifest } from './manifest.js';
import { runPreflight } from './preflight.js';
import { SustainedCondition } from './prometheus.js';
import { buildPlateaus, plateauLoadSeconds } from './ramp.js';
import { readManifest } from './synthetic.js';
import { readTrace } from './trace.js';
import type { LoadTestConfig, Plateau } from './types.js';

export const REALTIME_USERS_PER_SHARD = 25;
const PRIVILEGED_VARIABLES = ['LOADTEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LOADTEST_DATABASE_URL', 'DATABASE_URL'];

/** Environment for load workers (k6 and Realtime): anon key + synthetic sessions only. */
export function buildPublicWorkerEnv(config: LoadTestConfig, stopFile: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Only non-secret process basics are inherited; no LOADTEST_* or SUPABASE_* passthrough.
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'K6_NO_USAGE_REPORT']) if (source[name] !== undefined) env[name] = source[name];
  Object.assign(env, {
    K6_NO_USAGE_REPORT: 'true',
    LOADTEST_SUPABASE_URL: config.supabaseUrl,
    LOADTEST_SUPABASE_ANON_KEY: config.anonKey,
    LOADTEST_STAGING_REF: config.stagingRef,
    LOADTEST_NAMESPACE: config.namespace,
    LOADTEST_EXPECTED_STATE: config.state,
    LOADTEST_SCENARIO: config.scenario,
    LOADTEST_REQUESTED_USERS: String(config.requestedUsers),
    LOADTEST_EFFECTIVE_CEILING: String(config.effectiveCeiling),
    LOADTEST_TRACE_FILE: config.traceFile,
    LOADTEST_MANIFEST_FILE: config.manifestFile,
    LOADTEST_SESSIONS_FILE: config.sessionsFile,
    LOADTEST_EXTERNAL_STOP_FILE: stopFile,
  });
  for (const name of PRIVILEGED_VARIABLES) delete env[name];
  return env;
}

export function plateauEnv(plateau: Plateau): Record<string, string> {
  return {
    LOADTEST_PLATEAU_INDEX: String(plateau.index),
    LOADTEST_PLATEAU_USERS: String(plateau.users),
    LOADTEST_PLATEAU_RAMP_SECONDS: String(plateau.rampSeconds),
    LOADTEST_PLATEAU_HOLD_SECONDS: String(plateau.holdSeconds),
    LOADTEST_PLATEAU_RAMP_DOWN_SECONDS: String(plateau.rampDownSeconds),
  };
}

/** Observer environment: the only child that receives the database URL and service key. */
export function buildObserverEnv(config: LoadTestConfig, stopFile: string, runStartedAt: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ']) if (source[name] !== undefined) env[name] = source[name];
  return {
    ...env,
    LOADTEST_DATABASE_URL: config.databaseUrl,
    LOADTEST_SUPABASE_URL: config.supabaseUrl,
    LOADTEST_SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    LOADTEST_DISK_IOPS_LIMIT: config.diskIopsLimit === undefined ? undefined : String(config.diskIopsLimit),
    LOADTEST_EXTERNAL_STOP_FILE: stopFile,
    LOADTEST_MANIFEST_FILE: config.manifestFile,
    LOADTEST_RUN_STARTED_AT: runStartedAt,
  };
}

/** Host CPU utilisation between two os.cpus() snapshots. */
export function cpuRatio(previous: ReturnType<typeof cpus>, current: ReturnType<typeof cpus>): number {
  let idle = 0;
  let total = 0;
  current.forEach((cpu, index) => {
    const before = previous[index];
    if (!before) return;
    const times = (value: typeof cpu.times) => value.user + value.nice + value.sys + value.idle + value.irq;
    idle += cpu.times.idle - before.times.idle;
    total += times(cpu.times) - times(before.times);
  });
  return total > 0 ? 1 - idle / total : 0;
}

type Recorder = { entries: RunEvent[]; event: (type: string, fields?: Record<string, unknown>) => void; close: () => Promise<void> };

/** Appends events to disk and keeps them in memory, so decisions never race the file flush. */
function recorder(path: string): Recorder {
  const stream = createWriteStream(path, { flags: 'a' });
  const entries: RunEvent[] = [];
  return {
    entries,
    event: (type, fields = {}) => {
      const entry = { type, at: new Date().toISOString(), ...fields } as RunEvent;
      entries.push(entry);
      stream.write(`${JSON.stringify(entry)}\n`);
    },
    close: () => new Promise((resolvePromise) => stream.end(resolvePromise)),
  };
}

/** Copies a child's NDJSON stdout to a file and hands each complete line to `onLine`. */
function pipeTo(child: ChildProcess, file: WriteStream, label: string, onLine?: (line: string) => void): void {
  let pending = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    file.write(chunk);
    if (!onLine) return;
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(onLine);
  });
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk.toString()}`));
}

async function databaseNow(config: LoadTestConfig): Promise<string> {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const result = await pool.query<{ now: Date }>('select clock_timestamp() as now');
    return result.rows[0]!.now.toISOString();
  } finally {
    await pool.end();
  }
}

function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) resolvePromise(child.exitCode);
    else child.once('exit', (code) => resolvePromise(code));
  });
}

export async function runCampaign(config: LoadTestConfig, repoRoot = process.cwd(), options: { plateaus?: Plateau[] } = {}): Promise<RunManifest> {
  assertCampaignApproved(config);
  if (!config.databaseUrl || !config.serviceRoleKey) throw new Error('The campaign supervisor requires LOADTEST_DATABASE_URL and the service-role key for the observer');
  const preflight = await runPreflight(config, repoRoot);
  const trace = readTrace(config.traceFile);
  if (trace.namespace !== config.namespace || trace.seed !== config.seed || trace.users !== config.requestedUsers) throw new Error('Trace/config mismatch');
  readManifest(config.manifestFile, config);
  const leftover = await countRunScopedRows(config);
  if (leftover > 0) throw new Error(`REFUSING LOAD: ${leftover} run-generated rows remain from an earlier run; run reset-actions first`);
  if (existsSync(resolve(config.runDir, 'run-manifest.json'))) throw new Error(`Run ${config.runDir} already exists; choose a new LOADTEST_RUN_LABEL`);
  mkdirSync(config.runDir, { recursive: true });

  // `options.plateaus` exists only so the supervisor can be exercised by tests with short schedules.
  const plateaus = options.plateaus ?? buildPlateaus(config.requestedUsers, config.scenario, config.coldConnectRate);
  const databaseStartedAt = await databaseNow(config);
  const manifest = buildRunManifest({ config, repoRoot, preflight, traceSha256: trace.sha256, plateaus, databaseStartedAt });
  const writeManifest = () => {
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    assertManifestHasNoSecrets(serialized, [config.serviceRoleKey, config.databaseUrl, config.anonKey]);
    writeFileSync(resolve(config.runDir, 'run-manifest.json'), serialized, { encoding: 'utf8', mode: 0o600 });
  };
  writeManifest();

  const stopFile = resolve(config.runDir, 'EXTERNAL_HARD_STOP');
  if (existsSync(stopFile)) unlinkSync(stopFile);
  const events = recorder(resolve(config.runDir, 'events.ndjson'));
  const observerLog = createWriteStream(resolve(config.runDir, 'observer.ndjson'), { flags: 'a' });
  const children = new Set<ChildProcess>();
  let stopReason: string | undefined;
  let status: RunManifest['status'] = 'completed';
  const stop = (reason: string, nextStatus: RunManifest['status']) => {
    if (stopReason) return;
    stopReason = reason;
    status = nextStatus;
    for (const child of children) if (child.exitCode === null) child.kill('SIGINT');
  };
  let currentPlateau: number | undefined;
  let finished = false;
  const onSignal = () => stop('operator interrupt (SIGINT/SIGTERM)', 'interrupted');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  // The observer runs for the whole campaign.
  const observer = spawn(process.execPath, [resolve(repoRoot, 'load-tests/dist/src/observer-worker.js')], {
    cwd: repoRoot,
    env: buildObserverEnv(config, stopFile, databaseStartedAt),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observerStopReasons: string[] = [];
  pipeTo(observer, observerLog, 'observer', (line) => {
    if (!line.includes('"hard-stop"')) return;
    try {
      observerStopReasons.push(...((JSON.parse(line) as { reasons?: string[] }).reasons ?? []));
    } catch {
      // Partial or non-JSON line: the stderr copy still reaches the operator.
    }
  });
  void exitOf(observer).then((code) => {
    if (code === 42) {
      const reasons = observerStopReasons;
      events.event('hard-stop', { source: 'observer', plateau: currentPlateau, reasons: reasons.length ? reasons : ['observer hard stop'] });
      stop(`observer hard stop: ${reasons.join('; ')}`, 'hard-stop');
    } else if (!stopReason && !finished) {
      stop(`observer exited unexpectedly (${code})`, 'error');
    }
  });

  // Generator CPU watchdog (the run is invalid, not the system broken).
  let previousCpu = cpus();
  const generatorPressure = new SustainedCondition(T.generatorCpuWindowSeconds * 1_000);
  const cpuTimer = setInterval(() => {
    const snapshot = cpus();
    const ratio = cpuRatio(previousCpu, snapshot);
    previousCpu = snapshot;
    events.event('generator-cpu', { ratio, plateau: currentPlateau });
    if (generatorPressure.update(ratio >= T.generatorCpuRatio, Date.now())) {
      events.event('hard-stop', { source: 'generator', plateau: currentPlateau, reasons: ['generator CPU >= 85% (run invalid: generator-bound)'] });
      stop('generator CPU >= 85%: run invalid', 'hard-stop');
    }
  }, 5_000);

  const sleepUnlessStopped = async (seconds: number) => {
    const until = Date.now() + seconds * 1000;
    while (!stopReason && Date.now() < until) await delay(Math.min(1_000, until - Date.now()));
  };

  try {
    events.event('idle-start');
    await sleepUnlessStopped(config.idleBaselineSeconds);
    events.event('idle-end');
    let reference: number | undefined;

    for (const plateau of plateaus) {
      if (stopReason) break;
      currentPlateau = plateau.index;
      // Token refresh happens here, outside every measurement window.
      const requiredUntil = Math.floor(Date.now() / 1000) + plateauLoadSeconds(plateau) + 300;
      const { refreshed, bundle } = await refreshSessionsUntil(config, requiredUntil, Math.random);
      assertSessionsCover(bundle, plateau.users, requiredUntil);
      const run: RunManifest['plateauRuns'][number] = { index: plateau.index, users: plateau.users, startedAt: new Date().toISOString(), sessionsRefreshed: refreshed, exits: {} };
      manifest.plateauRuns.push(run);
      writeManifest();
      events.event('plateau-start', { plateau: plateau.index, users: plateau.users });

      const publicEnv = { ...buildPublicWorkerEnv(config, stopFile), ...plateauEnv(plateau) };
      const loadChildren: Array<{ label: string; child: ChildProcess }> = [];
      const shards = Math.ceil(plateau.users / REALTIME_USERS_PER_SHARD);
      for (let shard = 0; shard < shards; shard += 1) {
        const child = spawn(process.execPath, [resolve(repoRoot, 'load-tests/dist/src/realtime-worker.js')], {
          cwd: repoRoot,
          env: { ...publicEnv, LOADTEST_SHARD_INDEX: String(shard), LOADTEST_SHARD_COUNT: String(shards) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        pipeTo(child, createWriteStream(resolve(config.runDir, `realtime-p${plateau.index}-s${shard}.ndjson`), { flags: 'a' }), `realtime-${shard}`);
        loadChildren.push({ label: `realtime-${shard}`, child });
      }
      const k6 = spawn('k6', [
        'run', '--quiet',
        '--out', `json=${resolve(config.runDir, `k6-p${plateau.index}.json.gz`)}`,
        resolve(repoRoot, 'load-tests/k6/main.js'),
      ], { cwd: repoRoot, env: { ...publicEnv, LOADTEST_SUMMARY_FILE: resolve(config.runDir, `k6-summary-p${plateau.index}.json`) }, stdio: ['ignore', 'inherit', 'inherit'] });
      loadChildren.push({ label: 'k6', child: k6 });
      for (const { child } of loadChildren) children.add(child);

      await Promise.all(loadChildren.map(async ({ label, child }) => {
        const code = await exitOf(child);
        run.exits[label] = code;
        children.delete(child);
        if (code !== 0 && !stopReason) {
          const reasons = label === 'k6' ? [`k6 threshold abort or failure (exit ${code})`] : [`${label} hard stop or failure (exit ${code})`];
          events.event('hard-stop', { source: label, plateau: plateau.index, reasons });
          stop(`${label} exited with ${code}`, 'hard-stop');
        }
      }));
      run.loadEndedAt = new Date().toISOString();
      events.event('plateau-load-end', { plateau: plateau.index });
      writeManifest();

      // Cooldown always runs (even after a stop) so recovery is observed.
      const stoppedBeforeCooldown = stopReason;
      const until = Date.now() + plateau.cooldownSeconds * 1000;
      while (Date.now() < until && observer.exitCode === null) await delay(Math.min(1_000, until - Date.now()));
      run.cooldownEndedAt = new Date().toISOString();
      events.event('plateau-cooldown-end', { plateau: plateau.index });
      writeManifest();
      if (stoppedBeforeCooldown || stopReason) break;

      // Do not advance past a degraded plateau.
      const summaryPath = resolve(config.runDir, `k6-summary-p${plateau.index}.json`);
      const allEvents = events.entries;
      const at = (type: string, index?: number) => {
        const event = allEvents.find((item) => item.type === type && (index === undefined || item.plateau === index));
        return event ? Date.parse(event.at) : undefined;
      };
      const database = readNdjson<DatabaseSample>(resolve(config.runDir, 'observer.ndjson')).filter((row) => row.type === 'database');
      const idleStart = at('idle-start');
      const idleEnd = at('idle-end');
      const result = analyzePlateau({
        plateau,
        summary: existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as K6Summary) : undefined,
        realtime: Array.from({ length: shards }, (_, shard) => readNdjson<RealtimeWindowRecord>(resolve(config.runDir, `realtime-p${plateau.index}-s${shard}.ndjson`))).flat().filter((row) => row.type === 'realtime-window'),
        resubscribeIncompleteUsers: 0,
        database,
        plateauStart: at('plateau-start', plateau.index),
        loadEnd: at('plateau-load-end', plateau.index),
        cooldownEnd: at('plateau-cooldown-end', plateau.index),
        idle: database.filter((row) => idleStart !== undefined && idleEnd !== undefined && Date.parse(row.at) >= idleStart && Date.parse(row.at) <= idleEnd),
        hostCpu: allEvents.filter((event) => event.type === 'generator-cpu').map((event) => ({ at: event.at, ratio: Number(event.ratio) })),
        hardStops: [],
        generatorStops: [],
        referenceInteractiveP95Ms: reference,
        aborted: false,
      });
      if (reference === undefined && result.http && result.http.interactive.count >= 20) reference = result.http.interactive.p95;
      events.event('plateau-classified', { plateau: plateau.index, classification: result.classification, reasons: result.reasons });
      if (result.classification !== 'safe') {
        stop(`plateau ${plateau.users} classified ${result.classification}: ${result.reasons.join('; ')}`, result.classification === 'degraded' ? 'degraded-stop' : 'hard-stop');
      }
    }
  } catch (error) {
    stop(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    finished = true;
    clearInterval(cpuTimer);
    for (const child of children) if (child.exitCode === null) child.kill('SIGINT');
    if (observer.exitCode === null) observer.kill('SIGINT');
    await exitOf(observer);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    events.event('campaign-end', { status, stopReason });
    await events.close();
    await new Promise((resolvePromise) => observerLog.end(resolvePromise));
    manifest.status = status;
    manifest.stopReason = stopReason;
    manifest.endedAt = new Date().toISOString();
    writeManifest();
  }
  const analysis = analyzeRun(config.runDir);
  writeFileSync(resolve(config.runDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  return manifest;
}
