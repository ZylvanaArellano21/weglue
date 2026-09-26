import { monitorEventLoopDelay } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { HARD_STOP_THRESHOLDS, BANNER_JOIN_STAGGER_MS, MEASUREMENT_WINDOW_SECONDS } from './constants.js';
import { targetUsersAt } from './ramp.js';
import {
  bannerTopic,
  baseTopicsFor,
  classifyJoin,
  jitteredReconnectAfterMs,
  percentile,
  sentAtFromPreview,
  type JoinOutcome,
  type TopicKind,
  type TopicSpec,
} from './realtime-topology.js';
import type { ActionTrace, ExperimentState, Plateau, SessionBundle, SyntheticManifest } from './types.js';

// One process = one shard of one plateau. It exits 0 when the plateau's load
// phase ends, or 42 when a Realtime/generator hard stop trips.

const env = process.env;
for (const name of Object.keys(env)) {
  if (/SERVICE_ROLE|DATABASE_URL/i.test(name)) throw new Error(`Realtime worker must not receive privileged variable ${name}`);
}
const url = env.LOADTEST_SUPABASE_URL;
const anonKey = env.LOADTEST_SUPABASE_ANON_KEY;
const namespace = env.LOADTEST_NAMESPACE;
const state = env.LOADTEST_EXPECTED_STATE as ExperimentState;
if (!url || !anonKey || !namespace || (state !== '148' && state !== '149')) throw new Error('Realtime worker environment is incomplete');
const shardIndex = Number(env.LOADTEST_SHARD_INDEX ?? 0);
const shardCount = Number(env.LOADTEST_SHARD_COUNT ?? 1);
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardIndex < 0 || shardIndex >= shardCount) throw new Error('Invalid Realtime shard configuration');
const plateau: Plateau = {
  index: Number(env.LOADTEST_PLATEAU_INDEX),
  users: Number(env.LOADTEST_PLATEAU_USERS),
  rampSeconds: Number(env.LOADTEST_PLATEAU_RAMP_SECONDS),
  holdSeconds: Number(env.LOADTEST_PLATEAU_HOLD_SECONDS),
  rampDownSeconds: Number(env.LOADTEST_PLATEAU_RAMP_DOWN_SECONDS),
  cooldownSeconds: 0,
};
const reconnectWave = env.LOADTEST_SCENARIO === 'reconnect';

const bundle = JSON.parse(readFileSync(env.LOADTEST_SESSIONS_FILE!, 'utf8')) as SessionBundle;
const manifest = JSON.parse(readFileSync(env.LOADTEST_MANIFEST_FILE!, 'utf8')) as SyntheticManifest;
const trace = JSON.parse(readFileSync(env.LOADTEST_TRACE_FILE!, 'utf8')) as ActionTrace;
if (bundle.namespace !== namespace || manifest.namespace !== namespace || trace.namespace !== namespace) throw new Error('Realtime artifact identity mismatch');
const sessions = bundle.sessions.filter((session) => session.userIndex < plateau.users && session.userIndex % shardCount === shardIndex);

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
const salt = randomBytes(3).toString('hex');
let topicSequence = 0;

type ChannelState = { spec: TopicSpec; channel: RealtimeChannel; joined: boolean; startedAt: number; outcome?: JoinOutcome };
type ActiveUser = { userIndex: number; userId: string; client: SupabaseClient; channels: ChannelState[]; timers: NodeJS.Timeout[]; dropAt?: number; pendingResubscribe?: Set<ChannelState> };
type WindowStats = {
  joins: Record<string, { attempts: number; subscribed: number; expectedUnauthorized: number; unauthorized: number; errors: number; timeouts: number; latenciesMs: number[] }>;
  resubscribeMs: number[];
  deliveries: number;
  duplicateDeliveries: number;
  deliveryLatencyMs: number[];
  reconnects: number;
};

const started = performance.now();
const active = new Map<number, ActiveUser>();
const seenDeliveries = new Set<string>();
const windows = new Map<number, WindowStats>();
let stopped = false;
// Running plateau totals for hard stops (valid joins exclude the expected 148 block denial).
const totals = { validAttempts: 0, validFailures: 0, latencies: [] as number[], resubscribe: [] as number[] };

function windowIndex(): number {
  return Math.floor((performance.now() - started) / 1000 / MEASUREMENT_WINDOW_SECONDS);
}

function stats(): WindowStats {
  const index = windowIndex();
  let value = windows.get(index);
  if (!value) {
    value = { joins: {}, resubscribeMs: [], deliveries: 0, duplicateDeliveries: 0, deliveryLatencyMs: [], reconnects: 0 };
    windows.set(index, value);
  }
  return value;
}

function joinStats(kind: TopicKind) {
  const current = stats();
  current.joins[kind] ??= { attempts: 0, subscribed: 0, expectedUnauthorized: 0, unauthorized: 0, errors: 0, timeouts: 0, latenciesMs: [] };
  return current.joins[kind]!;
}

function onDelivery(user: ActiveUser, topic: string, payload: { preview?: unknown; message_id?: unknown } | undefined): void {
  const current = stats();
  const key = `${user.userId}:${String(payload?.message_id ?? '')}:${topic}`;
  if (payload?.message_id && seenDeliveries.has(key)) current.duplicateDeliveries += 1;
  else if (payload?.message_id) seenDeliveries.add(key);
  const sentAt = sentAtFromPreview(payload?.preview, namespace!);
  if (sentAt !== undefined) {
    current.deliveries += 1;
    current.deliveryLatencyMs.push(Date.now() - sentAt);
  }
}

function subscribe(user: ActiveUser, spec: TopicSpec): void {
  const channel = spec.mode === 'private-broadcast'
    ? user.client.channel(spec.topic, { config: { private: true } })
    : user.client.channel(spec.topic);
  const entry: ChannelState = { spec, channel, joined: false, startedAt: performance.now() };
  if (spec.mode === 'private-broadcast') {
    channel.on('broadcast', { event: 'new_message' }, (message) => onDelivery(user, spec.topic, (message as { payload?: { preview?: unknown; message_id?: unknown } }).payload));
    channel.on('broadcast', { event: 'invalidate' }, () => undefined);
  } else {
    for (const binding of spec.bindings) channel.on('postgres_changes' as never, binding as never, () => undefined);
  }
  joinStats(spec.kind).attempts += 1;
  totals.validAttempts += 1;
  channel.subscribe((status, error) => {
    if (stopped) return;
    const outcome = classifyJoin(status, error?.message, spec.kind, state);
    const current = joinStats(spec.kind);
    if (outcome === 'subscribed') {
      if (!entry.joined) {
        entry.joined = true;
        current.subscribed += 1;
        const latency = performance.now() - entry.startedAt;
        current.latenciesMs.push(latency);
        totals.latencies.push(latency);
      }
      if (user.pendingResubscribe?.delete(entry) && user.pendingResubscribe.size === 0 && user.dropAt !== undefined) {
        const resubscribe = performance.now() - user.dropAt;
        stats().resubscribeMs.push(resubscribe);
        totals.resubscribe.push(resubscribe);
        user.dropAt = undefined;
        user.pendingResubscribe = undefined;
      }
      return;
    }
    // Errors raised by a deliberate network drop are part of the reconnect
    // measurement, not join failures.
    if (user.dropAt !== undefined && entry.joined) return;
    if (outcome === 'expected-unauthorized') {
      current.expectedUnauthorized += 1;
      totals.validAttempts -= 1;
    } else {
      if (outcome === 'unauthorized') current.unauthorized += 1;
      else if (outcome === 'timeout') current.timeouts += 1;
      else current.errors += 1;
      totals.validFailures += 1;
    }
    entry.outcome = outcome;
    if (outcome === 'expected-unauthorized' || outcome === 'unauthorized') {
      // Same as the app: an RLS denial is permanent, so stop rejoining.
      void user.client.removeChannel(channel);
    }
  });
  user.channels.push(entry);
}

async function subscribeBannerTopics(user: ActiveUser, accessToken: string): Promise<void> {
  // Same inputs the app uses (getMyChats → banner_broadcast_active/banner_epoch).
  const response = await fetch(`${url}/rest/v1/conversation_participants?select=conversation_id,conversations!inner(banner_broadcast_active,banner_epoch)&user_id=eq.${user.userId}`, {
    headers: { apikey: anonKey!, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`banner topic lookup failed with HTTP ${response.status}`);
  const rows = (await response.json()) as Array<{ conversation_id: string; conversations: { banner_broadcast_active: boolean | null; banner_epoch: number | null } }>;
  rows
    .filter((row) => row.conversations?.banner_broadcast_active && row.conversations.banner_epoch != null)
    .forEach((row, index) => {
      user.timers.push(setTimeout(() => {
        if (active.get(user.userIndex) === user) subscribe(user, bannerTopic(row.conversation_id, row.conversations.banner_epoch!));
      }, (index + 1) * BANNER_JOIN_STAGGER_MS));
    });
}

function activate(session: SessionBundle['sessions'][number]): void {
  if (active.has(session.userIndex)) return;
  const client = createClient(url!, anonKey!, {
    accessToken: async () => session.accessToken,
    realtime: { reconnectAfterMs: (tries: number) => jitteredReconnectAfterMs(tries) },
  });
  const user: ActiveUser = { userIndex: session.userIndex, userId: session.userId, client, channels: [], timers: [] };
  active.set(session.userIndex, user);
  const archetype = trace.archetypes[session.userIndex] ?? 'browser';
  for (const spec of baseTopicsFor({ userId: session.userId, userIndex: session.userIndex, archetype, manifest, salt, sequence: () => ++topicSequence })) {
    subscribe(user, spec);
  }
  void subscribeBannerTopics(user, session.accessToken).catch((error) => {
    process.stderr.write(`Realtime worker ${shardIndex}: ${String(error)}\n`);
    joinStats('message-inbox-conv').errors += 1;
  });
}

async function deactivate(userIndex: number): Promise<void> {
  const user = active.get(userIndex);
  if (!user) return;
  active.delete(userIndex);
  user.timers.forEach(clearTimeout);
  await user.client.removeAllChannels();
  await user.client.realtime.disconnect();
}

/** Simulated shared-network drop: close the socket without a clean disconnect. */
function dropConnection(user: ActiveUser): void {
  const socket = (user.client.realtime as unknown as { socketAdapter?: { getSocket?: () => { conn?: { close: (code?: number, reason?: string) => void } | null } } })
    .socketAdapter?.getSocket?.();
  const conn = socket?.conn;
  if (!conn) throw new Error('Realtime socket is not available for the reconnect wave');
  user.dropAt = performance.now();
  user.pendingResubscribe = new Set(user.channels.filter((entry) => entry.joined));
  stats().reconnects += 1;
  conn.close(4000, 'loadtest-shared-network-drop');
}

let reconnectWaveDone = false;
async function reconcile(): Promise<void> {
  const elapsed = (performance.now() - started) / 1000;
  const target = targetUsersAt(elapsed, plateau);
  for (const session of sessions) {
    if (session.userIndex < target) activate(session);
    else if (active.has(session.userIndex)) await deactivate(session.userIndex);
  }
  if (reconnectWave && !reconnectWaveDone && elapsed >= plateau.rampSeconds + plateau.holdSeconds / 2) {
    reconnectWaveDone = true;
    for (const user of active.values()) dropConnection(user);
  }
  if (elapsed >= plateau.rampSeconds + plateau.holdSeconds + plateau.rampDownSeconds) await shutdown(0);
}

function summarize(index: number, value: WindowStats) {
  const joins = Object.fromEntries(Object.entries(value.joins).map(([kind, item]) => [kind, {
    attempts: item.attempts,
    subscribed: item.subscribed,
    expectedUnauthorized: item.expectedUnauthorized,
    unauthorized: item.unauthorized,
    errors: item.errors,
    timeouts: item.timeouts,
    latenciesMs: item.latenciesMs.map((ms) => Math.round(ms)),
  }]));
  return {
    type: 'realtime-window',
    plateau: plateau.index,
    shardIndex,
    window: index,
    activeUsers: active.size,
    joins,
    resubscribeMs: value.resubscribeMs.map((ms) => Math.round(ms)),
    deliveries: value.deliveries,
    duplicateDeliveries: value.duplicateDeliveries,
    deliveryLatencyMs: value.deliveryLatencyMs,
    reconnects: value.reconnects,
    eventLoopLagP95Ms: loopDelay.percentile(95) / 1_000_000,
    at: new Date().toISOString(),
  };
}

function flushCompletedWindows(includeCurrent: boolean): void {
  const current = windowIndex();
  for (const [index, value] of [...windows.entries()].sort((a, b) => a[0] - b[0])) {
    if (index < current || includeCurrent) {
      process.stdout.write(`${JSON.stringify(summarize(index, value))}\n`);
      windows.delete(index);
    }
  }
}

function evaluateHardStops(): string[] {
  const reasons: string[] = [];
  const failureRate = totals.validAttempts > 0 ? totals.validFailures / totals.validAttempts : 0;
  if (totals.validAttempts >= 50 && failureRate > HARD_STOP_THRESHOLDS.realtimeJoinFailureRate) reasons.push(`valid Realtime join failure rate ${(failureRate * 100).toFixed(2)}% > 2%`);
  if (percentile(totals.latencies, 0.95) > HARD_STOP_THRESHOLDS.realtimeColdJoinP95Ms) reasons.push('Realtime cold join p95 > 15000ms');
  if (percentile(totals.resubscribe, 0.95) > HARD_STOP_THRESHOLDS.realtimeResubscribeP95Ms) reasons.push('full resubscription p95 > 15000ms');
  const lag = loopDelay.percentile(95) / 1_000_000;
  if (lag > HARD_STOP_THRESHOLDS.generatorEventLoopLagP95Ms) reasons.push(`generator event-loop lag p95 ${lag.toFixed(1)}ms > 50ms (run invalid: generator-bound)`);
  return reasons;
}

const reconcileTimer = setInterval(() => void reconcile().catch((error) => fatal(error)), 1_000);
const metricsTimer = setInterval(() => {
  flushCompletedWindows(false);
  const reasons = evaluateHardStops();
  if (reasons.length > 0) {
    process.stderr.write(`HARD STOP (realtime shard ${shardIndex}): ${reasons.join('; ')}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'hard-stop', source: 'realtime', shardIndex, plateau: plateau.index, reasons, at: new Date().toISOString() })}\n`);
    void shutdown(42);
  }
}, 5_000);
void reconcile().catch((error) => fatal(error));

function fatal(error: unknown): void {
  process.stderr.write(`Realtime worker ${shardIndex} failed: ${String(error)}\n`);
  void shutdown(1);
}

async function shutdown(code: number): Promise<void> {
  if (stopped) return;
  stopped = true;
  const incomplete = [...active.values()].filter((user) => user.dropAt !== undefined).length;
  if (incomplete > 0) process.stdout.write(`${JSON.stringify({ type: 'realtime-resubscribe-incomplete', plateau: plateau.index, shardIndex, users: incomplete, at: new Date().toISOString() })}\n`);
  clearInterval(reconcileTimer);
  clearInterval(metricsTimer);
  flushCompletedWindows(true);
  loopDelay.disable();
  await Promise.all([...active.keys()].map(deactivate)).catch(() => undefined);
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown(130));
