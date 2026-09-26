import type { DatabaseSample, K6Summary, RealtimeWindowRecord } from '../src/analyze.js';
import type { Plateau } from '../src/types.js';

export const plateau: Plateau = { index: 2, users: 10, rampSeconds: 120, holdSeconds: 600, rampDownSeconds: 30, cooldownSeconds: 300 };
export const T0 = Date.parse('2026-09-25T10:00:00.000Z');

export function k6Summary(options: { p95?: number; windowP95?: (window: number) => number; errorRate?: number; windowErrorRate?: (window: number) => number; count?: number } = {}): K6Summary {
  const metrics: K6Summary['metrics'] = {
    http_reqs: { type: 'counter', values: { count: 5_000 } },
    iterations: { type: 'counter', values: { count: 500 } },
    weglue_request_errors: { type: 'rate', values: { rate: options.errorRate ?? 0.001 } },
    weglue_timeouts: { type: 'rate', values: { rate: 0 } },
    weglue_interactive_duration: { type: 'trend', values: { med: 200, 'p(90)': 300, 'p(95)': options.p95 ?? 400, 'p(99)': 600, max: 900, count: options.count ?? 480 } },
    weglue_launch_duration: { type: 'trend', values: { med: 800, 'p(90)': 1000, 'p(95)': 1200, 'p(99)': 1500, max: 2000, count: 10 } },
    'weglue_journey_duration{journey:home}': { type: 'trend', values: { med: 250, 'p(90)': 350, 'p(95)': 420, 'p(99)': 600, max: 800, count: 200 } },
    'weglue_request_errors{journey:home}': { type: 'rate', values: { rate: 0 } },
    'weglue_status{status:429}': { type: 'counter', values: { count: 0 } },
  };
  for (let window = 0; window < 13; window += 1) {
    metrics[`weglue_interactive_duration{window:${window}}`] = { type: 'trend', values: { 'p(95)': options.windowP95?.(window) ?? options.p95 ?? 400, count: 40 } };
    metrics[`weglue_request_errors{window:${window}}`] = { type: 'rate', values: { rate: options.windowErrorRate?.(window) ?? 0 } };
    metrics[`weglue_timeouts{window:${window}}`] = { type: 'rate', values: { rate: 0 } };
  }
  return { plateau: { index: plateau.index, users: plateau.users, rampSeconds: 120, holdSeconds: 600, rampDownSeconds: 30 }, metrics };
}

export function realtimeWindow(window: number, overrides: Partial<RealtimeWindowRecord['joins'][string]> = {}, kind = 'access'): RealtimeWindowRecord {
  return {
    type: 'realtime-window', plateau: plateau.index, window,
    joins: { [kind]: { attempts: 30, subscribed: 30, expectedUnauthorized: 0, unauthorized: 0, errors: 0, timeouts: 0, latenciesMs: Array(30).fill(150), ...overrides } },
    resubscribeMs: [], deliveries: 5, duplicateDeliveries: 0, deliveryLatencyMs: [80, 90, 100, 120, 140], reconnects: 0, eventLoopLagP95Ms: 5,
  };
}

export function dbSamples(fromMs: number, toMs: number, fields: Partial<DatabaseSample> = {}): DatabaseSample[] {
  const samples: DatabaseSample[] = [];
  for (let at = fromMs; at <= toMs; at += 5_000) {
    samples.push({ type: 'database', at: new Date(at).toISOString(), connections: 20, maxConnections: 100, deadlocks: 0, maxBlockedSeconds: 0, pushPending: 0, netQueue: 0, notificationsSinceStart: 0, xactCommit: at / 100, cpuRatio: 0.2, memoryRatio: 0.5, metricsApiAvailable: true, ...fields });
  }
  return samples;
}

export function plateauInput(overrides: Record<string, unknown> = {}) {
  const loadEnd = T0 + 750_000;
  const cooldownEnd = loadEnd + 300_000;
  return {
    plateau,
    summary: k6Summary(),
    realtime: [realtimeWindow(0), realtimeWindow(1)],
    resubscribeIncompleteUsers: 0,
    database: dbSamples(T0 - 900_000, cooldownEnd),
    plateauStart: T0,
    loadEnd,
    cooldownEnd,
    idle: dbSamples(T0 - 900_000, T0 - 1),
    hostCpu: [{ at: new Date(T0 + 1000).toISOString(), ratio: 0.3 }],
    hardStops: [] as string[],
    generatorStops: [] as string[],
    referenceInteractiveP95Ms: 350,
    aborted: false,
    ...overrides,
  };
}
