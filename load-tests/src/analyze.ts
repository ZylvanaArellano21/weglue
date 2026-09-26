import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEGRADATION_THRESHOLDS as D, HARD_STOP_THRESHOLDS as T, MEASUREMENT_WINDOW_SECONDS, RECOVERY_TOLERANCE as R } from './constants.js';
import { percentile } from './realtime-topology.js';
import type { Plateau } from './types.js';
import type { RunManifest } from './manifest.js';

export type Classification = 'safe' | 'degraded' | 'broken' | 'invalid' | 'not-run';

type K6Metric = { type: string; values: Record<string, number> };
export type K6Summary = { plateau: { index: number; users: number; rampSeconds: number; holdSeconds: number; rampDownSeconds: number }; metrics: Record<string, K6Metric> };

export type RealtimeWindowRecord = {
  type: 'realtime-window';
  plateau: number;
  window: number;
  joins: Record<string, { attempts: number; subscribed: number; expectedUnauthorized: number; unauthorized: number; errors: number; timeouts: number; latenciesMs: number[] }>;
  resubscribeMs: number[];
  deliveries: number;
  duplicateDeliveries: number;
  deliveryLatencyMs: number[];
  reconnects: number;
  eventLoopLagP95Ms: number;
};

export type DatabaseSample = {
  type: 'database';
  at: string;
  connections: number;
  maxConnections: number;
  deadlocks: number;
  maxBlockedSeconds: number;
  pushPending: number;
  netQueue: number;
  notificationsSinceStart: number;
  xactCommit: number;
  cpuRatio?: number;
  memoryRatio?: number;
  diskIops?: number;
  diskIopsRatio?: number;
  metricsApiAvailable?: boolean;
};

export type RunEvent = { type: string; at: string; plateau?: number; [key: string]: unknown };

export type StatSummary = { count: number; p50: number; p90: number; p95: number; p99: number; max: number };

export type WindowResult = {
  window: number;
  interactiveP95Ms?: number;
  interactiveCount: number;
  errorRate?: number;
  timeoutRate?: number;
  realtimeJoinP95Ms?: number;
  realtimeValidFailureRate?: number;
  realtimeAttempts: number;
  dbCpuRatio?: number;
  dbConnectionRatio?: number;
};

export type PlateauResult = {
  index: number;
  users: number;
  status: 'completed' | 'aborted' | 'not-run';
  classification: Classification;
  reasons: string[];
  http?: {
    requests: number;
    requestsPerSecond: number;
    errorRate: number;
    timeoutRate: number;
    interactive: StatSummary;
    launch: StatSummary;
    journeys: Record<string, StatSummary & { errorRate: number }>;
    status: Record<string, number>;
    iterations: number;
    droppedIterations: number;
    droppedIterationRate: number;
    dataReceivedBytes: number;
    dataSentBytes: number;
    connectingP95Ms: number;
    tlsP95Ms: number;
    writes: number;
  };
  realtime: {
    attempts: number;
    subscribed: number;
    expectedUnauthorized: number;
    validFailures: number;
    validFailureRate: number;
    join: StatSummary;
    byKind: Record<string, { attempts: number; subscribed: number; expectedUnauthorized: number; unauthorized: number; errors: number; timeouts: number; join: StatSummary }>;
    resubscribe: StatSummary;
    resubscribeIncompleteUsers: number;
    reconnects: number;
    deliveries: number;
    duplicateDeliveries: number;
    deliveryLatency: StatSummary;
    maxEventLoopLagP95Ms: number;
  };
  database: {
    samples: number;
    peakConnectionRatio: number;
    peakCpuRatio?: number;
    meanCpuRatio?: number;
    peakMemoryRatio?: number;
    peakDiskIops?: number;
    deadlocksDelta: number;
    maxBlockedSeconds: number;
    peakPushPending: number;
    peakNetQueue: number;
    commitsPerSecond: number;
    notificationsGenerated: number;
    metricsApiAvailable: boolean;
  };
  generator: { peakCpuRatio: number; maxEventLoopLagP95Ms: number };
  recovery?: { recovered: boolean; idleConnections: number; cooldownConnections: number; idleCpuRatio?: number; cooldownCpuRatio?: number };
  windows: WindowResult[];
};

export type RunAnalysis = {
  schemaVersion: 1;
  runId: string;
  status: RunManifest['status'];
  invalid: boolean;
  invalidReasons: string[];
  plateaus: PlateauResult[];
  safeTestedConcurrency: number | null;
  degradationPoint: number | null;
  breakingPoint: number | null;
};

export function summarize(values: number[]): StatSummary {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

function trend(metric: K6Metric | undefined): StatSummary {
  const values = metric?.values ?? {};
  return { count: values.count ?? 0, p50: values.med ?? 0, p90: values['p(90)'] ?? 0, p95: values['p(95)'] ?? 0, p99: values['p(99)'] ?? 0, max: values.max ?? 0 };
}

export function readNdjson<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().startsWith('{')).map((line) => {
    try {
      return JSON.parse(line) as T;
    } catch {
      return undefined;
    }
  }).filter((value): value is T => value !== undefined);
}

/** Hold-phase windows: those lying entirely inside [ramp, ramp + hold). */
export function holdWindows(plateau: Pick<Plateau, 'rampSeconds' | 'holdSeconds'>): number[] {
  const windows: number[] = [];
  for (let window = 0; (window + 1) * MEASUREMENT_WINDOW_SECONDS <= plateau.rampSeconds + plateau.holdSeconds; window += 1) {
    if (window * MEASUREMENT_WINDOW_SECONDS >= plateau.rampSeconds) windows.push(window);
  }
  return windows;
}

function sustained(windows: WindowResult[], breach: (window: WindowResult) => boolean): boolean {
  let streak = 0;
  for (const window of windows) {
    streak = breach(window) ? streak + 1 : 0;
    if (streak >= D.consecutiveWindows) return true;
  }
  return false;
}

export function analyzePlateau(input: {
  plateau: Plateau;
  summary?: K6Summary;
  realtime: RealtimeWindowRecord[];
  resubscribeIncompleteUsers: number;
  database: DatabaseSample[];
  plateauStart?: number;
  loadEnd?: number;
  cooldownEnd?: number;
  idle: DatabaseSample[];
  hostCpu: Array<{ at: string; ratio: number }>;
  hardStops: string[];
  generatorStops: string[];
  referenceInteractiveP95Ms?: number;
  aborted: boolean;
}): PlateauResult {
  const { plateau, summary } = input;
  const reasons: string[] = [...input.hardStops];
  const metrics = summary?.metrics ?? {};

  let http: PlateauResult['http'];
  if (summary) {
    const requests = metrics.http_reqs?.values.count ?? 0;
    const iterations = metrics.iterations?.values.count ?? 0;
    const dropped = metrics.dropped_iterations?.values.count ?? 0;
    const journeys: Record<string, StatSummary & { errorRate: number }> = {};
    const status: Record<string, number> = {};
    for (const [name, metric] of Object.entries(metrics)) {
      const journey = /^weglue_journey_duration\{journey:(.+)\}$/.exec(name)?.[1];
      if (journey) journeys[journey] = { ...trend(metric), errorRate: metrics[`weglue_request_errors{journey:${journey}}`]?.values.rate ?? 0 };
      const code = /^weglue_status\{status:(\d+)\}$/.exec(name)?.[1];
      if (code && (metric.values.count ?? 0) > 0) status[code] = metric.values.count ?? 0;
    }
    const seconds = plateau.rampSeconds + plateau.holdSeconds + plateau.rampDownSeconds;
    http = {
      requests,
      requestsPerSecond: seconds > 0 ? requests / seconds : 0,
      errorRate: metrics.weglue_request_errors?.values.rate ?? 0,
      timeoutRate: metrics.weglue_timeouts?.values.rate ?? 0,
      interactive: trend(metrics.weglue_interactive_duration),
      launch: trend(metrics.weglue_launch_duration),
      journeys,
      status,
      iterations,
      droppedIterations: dropped,
      droppedIterationRate: iterations + dropped > 0 ? dropped / (iterations + dropped) : 0,
      dataReceivedBytes: metrics.data_received?.values.count ?? 0,
      dataSentBytes: metrics.data_sent?.values.count ?? 0,
      connectingP95Ms: metrics.http_req_connecting?.values['p(95)'] ?? 0,
      tlsP95Ms: metrics.http_req_tls_handshaking?.values['p(95)'] ?? 0,
      writes: metrics.weglue_synthetic_writes?.values.count ?? 0,
    };
  }

  // Realtime aggregation across shards and windows.
  const byKind: PlateauResult['realtime']['byKind'] = {};
  const kindLatencies = new Map<string, number[]>();
  const joinLatencies: number[] = [];
  const resubscribe: number[] = [];
  const deliveryLatency: number[] = [];
  let deliveries = 0;
  let duplicates = 0;
  let reconnects = 0;
  let maxLag = 0;
  const windowJoins = new Map<number, { attempts: number; failures: number; latencies: number[] }>();
  for (const record of input.realtime) {
    maxLag = Math.max(maxLag, record.eventLoopLagP95Ms ?? 0);
    resubscribe.push(...record.resubscribeMs);
    deliveryLatency.push(...record.deliveryLatencyMs);
    deliveries += record.deliveries;
    duplicates += record.duplicateDeliveries;
    reconnects += record.reconnects;
    const window = windowJoins.get(record.window) ?? { attempts: 0, failures: 0, latencies: [] };
    for (const [kind, item] of Object.entries(record.joins)) {
      const target = (byKind[kind] ??= { attempts: 0, subscribed: 0, expectedUnauthorized: 0, unauthorized: 0, errors: 0, timeouts: 0, join: summarize([]) });
      target.attempts += item.attempts;
      target.subscribed += item.subscribed;
      target.expectedUnauthorized += item.expectedUnauthorized;
      target.unauthorized += item.unauthorized;
      target.errors += item.errors;
      target.timeouts += item.timeouts;
      kindLatencies.set(kind, [...(kindLatencies.get(kind) ?? []), ...item.latenciesMs]);
      joinLatencies.push(...item.latenciesMs);
      window.attempts += item.attempts - item.expectedUnauthorized;
      window.failures += item.unauthorized + item.errors + item.timeouts;
      window.latencies.push(...item.latenciesMs);
    }
    windowJoins.set(record.window, window);
  }
  for (const [kind, target] of Object.entries(byKind)) target.join = summarize(kindLatencies.get(kind) ?? []);
  const kinds = Object.values(byKind);
  const attempts = kinds.reduce((total, item) => total + item.attempts, 0);
  const expectedUnauthorized = kinds.reduce((total, item) => total + item.expectedUnauthorized, 0);
  const validFailures = kinds.reduce((total, item) => total + item.unauthorized + item.errors + item.timeouts, 0);
  const validAttempts = attempts - expectedUnauthorized;
  const realtime: PlateauResult['realtime'] = {
    attempts,
    subscribed: kinds.reduce((total, item) => total + item.subscribed, 0),
    expectedUnauthorized,
    validFailures,
    validFailureRate: validAttempts > 0 ? validFailures / validAttempts : 0,
    join: summarize(joinLatencies),
    byKind,
    resubscribe: summarize(resubscribe),
    resubscribeIncompleteUsers: input.resubscribeIncompleteUsers,
    reconnects,
    deliveries,
    duplicateDeliveries: duplicates,
    deliveryLatency: summarize(deliveryLatency),
    maxEventLoopLagP95Ms: maxLag,
  };

  // Database samples inside the plateau's load phase.
  const inLoad = input.database.filter((sample) => {
    const at = Date.parse(sample.at);
    return input.plateauStart !== undefined && input.loadEnd !== undefined && at >= input.plateauStart && at <= input.loadEnd;
  });
  const cpu = inLoad.map((sample) => sample.cpuRatio).filter((value): value is number => value !== undefined);
  const first = inLoad[0];
  const last = inLoad[inLoad.length - 1];
  const loadSeconds = first && last ? (Date.parse(last.at) - Date.parse(first.at)) / 1000 : 0;
  const database: PlateauResult['database'] = {
    samples: inLoad.length,
    peakConnectionRatio: Math.max(0, ...inLoad.map((sample) => sample.connections / sample.maxConnections)),
    peakCpuRatio: cpu.length ? Math.max(...cpu) : undefined,
    meanCpuRatio: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : undefined,
    peakMemoryRatio: inLoad.some((sample) => sample.memoryRatio !== undefined) ? Math.max(...inLoad.map((sample) => sample.memoryRatio ?? 0)) : undefined,
    peakDiskIops: inLoad.some((sample) => sample.diskIops !== undefined) ? Math.max(...inLoad.map((sample) => sample.diskIops ?? 0)) : undefined,
    deadlocksDelta: first && last ? last.deadlocks - first.deadlocks : 0,
    maxBlockedSeconds: Math.max(0, ...inLoad.map((sample) => sample.maxBlockedSeconds)),
    peakPushPending: Math.max(0, ...inLoad.map((sample) => sample.pushPending)),
    peakNetQueue: Math.max(0, ...inLoad.map((sample) => sample.netQueue)),
    commitsPerSecond: first && last && loadSeconds > 0 ? (last.xactCommit - first.xactCommit) / loadSeconds : 0,
    notificationsGenerated: first && last ? last.notificationsSinceStart - first.notificationsSinceStart : 0,
    metricsApiAvailable: inLoad.some((sample) => sample.metricsApiAvailable === true),
  };

  const hostInLoad = input.hostCpu.filter((sample) => {
    const at = Date.parse(sample.at);
    return input.plateauStart !== undefined && input.loadEnd !== undefined && at >= input.plateauStart && at <= input.loadEnd;
  });
  const generator = { peakCpuRatio: Math.max(0, ...hostInLoad.map((sample) => sample.ratio)), maxEventLoopLagP95Ms: maxLag };

  // Windowed evaluation (hold windows only).
  const windows: WindowResult[] = holdWindows(plateau).map((window) => {
    const joins = windowJoins.get(window);
    const windowStart = (input.plateauStart ?? 0) + window * MEASUREMENT_WINDOW_SECONDS * 1000;
    const dbWindow = input.database.filter((sample) => {
      const at = Date.parse(sample.at);
      return at >= windowStart && at < windowStart + MEASUREMENT_WINDOW_SECONDS * 1000;
    });
    const windowCpu = dbWindow.map((sample) => sample.cpuRatio).filter((value): value is number => value !== undefined);
    return {
      window,
      interactiveP95Ms: metrics[`weglue_interactive_duration{window:${window}}`]?.values['p(95)'],
      interactiveCount: metrics[`weglue_interactive_duration{window:${window}}`]?.values.count ?? 0,
      errorRate: metrics[`weglue_request_errors{window:${window}}`]?.values.rate,
      timeoutRate: metrics[`weglue_timeouts{window:${window}}`]?.values.rate,
      realtimeAttempts: joins?.attempts ?? 0,
      realtimeJoinP95Ms: joins && joins.latencies.length > 0 ? percentile(joins.latencies, 0.95) : undefined,
      realtimeValidFailureRate: joins && joins.attempts > 0 ? joins.failures / joins.attempts : undefined,
      dbCpuRatio: windowCpu.length ? windowCpu.reduce((a, b) => a + b, 0) / windowCpu.length : undefined,
      dbConnectionRatio: dbWindow.length ? Math.max(...dbWindow.map((sample) => sample.connections / sample.maxConnections)) : undefined,
    };
  });

  // Recovery: last minute of cooldown versus the idle baseline.
  let recovery: PlateauResult['recovery'];
  if (input.loadEnd !== undefined && input.cooldownEnd !== undefined && input.idle.length > 0) {
    const tail = input.database.filter((sample) => {
      const at = Date.parse(sample.at);
      return at >= input.cooldownEnd! - 60_000 && at <= input.cooldownEnd!;
    });
    if (tail.length > 0) {
      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      const idleConnections = mean(input.idle.map((sample) => sample.connections));
      const cooldownConnections = mean(tail.map((sample) => sample.connections));
      const idleCpu = input.idle.map((sample) => sample.cpuRatio).filter((value): value is number => value !== undefined);
      const tailCpu = tail.map((sample) => sample.cpuRatio).filter((value): value is number => value !== undefined);
      const idleCpuRatio = idleCpu.length ? mean(idleCpu) : undefined;
      const cooldownCpuRatio = tailCpu.length ? mean(tailCpu) : undefined;
      const connectionsOk = cooldownConnections <= Math.max(idleConnections * (1 + R.relative), idleConnections + R.connectionSlack);
      const cpuOk = idleCpuRatio === undefined || cooldownCpuRatio === undefined || cooldownCpuRatio <= idleCpuRatio + R.cpuAbsolute;
      recovery = { recovered: connectionsOk && cpuOk, idleConnections, cooldownConnections, idleCpuRatio, cooldownCpuRatio };
    }
  }

  // Classification (approved definitions).
  let classification: Classification = input.aborted && !summary ? 'not-run' : 'safe';
  const invalidReasons = [...input.generatorStops];
  if (realtime.maxEventLoopLagP95Ms > T.generatorEventLoopLagP95Ms) invalidReasons.push('generator event-loop lag p95 > 50ms');
  if ((http?.droppedIterationRate ?? 0) > T.droppedIterationRate) invalidReasons.push('dropped iterations > 1%');
  const broken: string[] = [];
  if (input.hardStops.length > 0) broken.push(...input.hardStops);
  if (http) {
    if (http.errorRate > T.httpErrorRate) broken.push('request errors > 5%');
    if (http.timeoutRate > T.timeoutRate) broken.push('timeouts > 1%');
    if (http.interactive.p95 > T.interactiveP95Ms) broken.push('interactive p95 > 5 s');
    if (http.launch.p95 > T.realtimeColdJoinP95Ms) broken.push('cold launch p95 > 15 s');
  }
  if (realtime.validFailureRate > T.realtimeJoinFailureRate) broken.push('valid Realtime join failures > 2%');
  if (realtime.resubscribe.p95 > T.realtimeResubscribeP95Ms) broken.push('full resubscription p95 > 15 s');
  if (realtime.resubscribeIncompleteUsers > 0) broken.push('users never fully resubscribed');

  const degraded: string[] = [];
  const reference = input.referenceInteractiveP95Ms;
  if (reference !== undefined && sustained(windows, (w) => w.interactiveP95Ms !== undefined && w.interactiveP95Ms > reference * D.p95RatioToReference && w.interactiveP95Ms - reference >= D.p95AbsoluteIncreaseMs)) {
    degraded.push(`interactive p95 > 2× low-load reference (${Math.round(reference)} ms) and ≥250 ms worse for 2 windows`);
  }
  if (sustained(windows, (w) => (w.errorRate ?? 0) >= D.requestErrorRate)) degraded.push('request errors ≥ 1% for 2 windows');
  if (sustained(windows, (w) => w.realtimeAttempts >= 20 && ((w.realtimeJoinP95Ms ?? 0) > D.realtimeJoinP95Ms || (w.realtimeValidFailureRate ?? 0) >= D.realtimeJoinFailureRate))) {
    degraded.push('Realtime join p95 > 2 s or valid join errors ≥ 0.5% for 2 windows');
  }
  if (sustained(windows, (w) => (w.dbCpuRatio ?? 0) >= D.databaseCpuRatio || (w.dbConnectionRatio ?? 0) >= D.databaseConnectionRatio)) degraded.push('database CPU or connections ≥ 70% for 2 windows');
  if ((http?.droppedIterationRate ?? 0) >= D.droppedIterationRate) degraded.push('dropped iterations ≥ 0.5%');
  if (recovery && !recovery.recovered) degraded.push('did not return within 10% of idle health during cooldown');
  if (!recovery && classification !== 'not-run') degraded.push('recovery could not be verified');

  if (classification !== 'not-run') {
    if (invalidReasons.length > 0) {
      classification = 'invalid';
      reasons.push(...invalidReasons);
    } else if (broken.length > 0) {
      classification = 'broken';
      reasons.push(...broken.filter((reason) => !reasons.includes(reason)));
    } else if (degraded.length > 0) {
      classification = 'degraded';
      reasons.push(...degraded);
    }
  }

  return {
    index: plateau.index,
    users: plateau.users,
    status: summary ? (input.aborted ? 'aborted' : 'completed') : 'not-run',
    classification,
    reasons,
    http,
    realtime,
    database,
    generator,
    recovery,
    windows,
  };
}

/** Capacity summary for one run from its ordered plateau results. */
export function capacity(plateaus: PlateauResult[]): Pick<RunAnalysis, 'safeTestedConcurrency' | 'degradationPoint' | 'breakingPoint'> {
  let safeTestedConcurrency: number | null = null;
  let degradationPoint: number | null = null;
  let breakingPoint: number | null = null;
  for (const plateau of plateaus) {
    if (plateau.classification === 'safe' && degradationPoint === null && breakingPoint === null) safeTestedConcurrency = plateau.users;
    if (plateau.classification === 'degraded' && degradationPoint === null) degradationPoint = plateau.users;
    if (plateau.classification === 'broken' && breakingPoint === null) {
      breakingPoint = plateau.users;
      degradationPoint ??= plateau.users;
    }
  }
  return { safeTestedConcurrency, degradationPoint, breakingPoint };
}

/** Analyse a completed run directory produced by the campaign supervisor. */
export function analyzeRun(runDir: string): RunAnalysis {
  const manifest = JSON.parse(readFileSync(resolve(runDir, 'run-manifest.json'), 'utf8')) as RunManifest;
  const events = readNdjson<RunEvent>(resolve(runDir, 'events.ndjson'));
  const database = readNdjson<DatabaseSample>(resolve(runDir, 'observer.ndjson')).filter((sample) => sample.type === 'database');
  const time = (type: string, plateau?: number) => {
    const event = events.find((item) => item.type === type && (plateau === undefined || item.plateau === plateau));
    return event ? Date.parse(event.at) : undefined;
  };
  const idleStart = time('idle-start');
  const idleEnd = time('idle-end');
  const idle = database.filter((sample) => idleStart !== undefined && idleEnd !== undefined && Date.parse(sample.at) >= idleStart && Date.parse(sample.at) <= idleEnd);
  const hostCpu = events.filter((event) => event.type === 'generator-cpu').map((event) => ({ at: event.at, ratio: Number(event.ratio) }));
  const files = existsSync(runDir) ? readdirSync(runDir) : [];

  const results: PlateauResult[] = [];
  let reference: number | undefined;
  for (const plateau of manifest.plannedPlateaus) {
    const summaryPath = resolve(runDir, `k6-summary-p${plateau.index}.json`);
    const summary = existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as K6Summary) : undefined;
    const realtimeRecords = files
      .filter((file) => new RegExp(`^realtime-p${plateau.index}-s\\d+\\.ndjson$`).test(file))
      .flatMap((file) => readNdjson<{ type: string; users?: number }>(resolve(runDir, file)));
    const stopEvents = events.filter((event) => event.type === 'hard-stop' && event.plateau === plateau.index);
    const result = analyzePlateau({
      plateau,
      summary,
      realtime: realtimeRecords.filter((record) => record.type === 'realtime-window') as unknown as RealtimeWindowRecord[],
      resubscribeIncompleteUsers: realtimeRecords.filter((record) => record.type === 'realtime-resubscribe-incomplete').reduce((total, record) => total + (record.users ?? 0), 0),
      database,
      plateauStart: time('plateau-start', plateau.index),
      loadEnd: time('plateau-load-end', plateau.index),
      cooldownEnd: time('plateau-cooldown-end', plateau.index),
      idle,
      hostCpu,
      hardStops: stopEvents.filter((event) => event.source !== 'generator').flatMap((event) => (event.reasons as string[] | undefined) ?? []),
      generatorStops: stopEvents.filter((event) => event.source === 'generator').flatMap((event) => (event.reasons as string[] | undefined) ?? []),
      referenceInteractiveP95Ms: reference,
      aborted: stopEvents.length > 0,
    });
    // The low-load reference is the first plateau with enough interactive samples.
    if (reference === undefined && result.http && result.http.interactive.count >= 20) reference = result.http.interactive.p95;
    results.push(result);
  }
  const invalidReasons = results.filter((plateau) => plateau.classification === 'invalid').flatMap((plateau) => plateau.reasons.map((reason) => `plateau ${plateau.users}: ${reason}`));
  if (manifest.status === 'error') invalidReasons.push(`campaign error: ${manifest.stopReason ?? 'unknown'}`);
  return {
    schemaVersion: 1,
    runId: manifest.runId,
    status: manifest.status,
    invalid: invalidReasons.length > 0,
    invalidReasons,
    plateaus: results,
    ...capacity(results),
  };
}
