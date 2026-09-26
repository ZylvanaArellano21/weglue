import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import { REALTIME_WARMUP } from './constants.js';
import { baseTopicsFor, joinFailureKey, type TopicSpec } from './realtime-topology.js';
import type { LoadTestConfig, SessionBundle, SyntheticManifest } from './types.js';

export type WarmupLimits = { [K in keyof typeof REALTIME_WARMUP]: number };
export type WarmupJoin = { kind: string; status: string; latencyMs?: number; failure?: string };
export type WarmupRound = { round: number; at: string; passed: boolean; maxJoinMs?: number; joins: WarmupJoin[] };
export type WarmupResult = { phase: string; passed: boolean; startedAt: string; endedAt: string; rounds: WarmupRound[] };

/** Joins every topic on a fresh connection and reports each outcome; always disconnects. */
export type WarmupJoiner = (topics: TopicSpec[], timeoutMs: number) => Promise<WarmupJoin[]>;

/**
 * The warm-up topics: one synthetic user's base topics, except `block`, whose
 * join is denied at 148 and authorised at 149. Leaving it out keeps the gate
 * identical for both states.
 */
export function warmupTopics(session: SessionBundle['sessions'][number], manifest: Pick<SyntheticManifest, 'universityId' | 'clubSizes' | 'conversationIds'>): TopicSpec[] {
  let sequence = 0;
  return baseTopicsFor({ userId: session.userId, userIndex: session.userIndex, archetype: 'browser', manifest, salt: 'warmup', sequence: () => ++sequence })
    .filter((spec) => spec.kind !== 'block');
}

export function warmupRoundPassed(joins: WarmupJoin[], maxJoinMs: number): boolean {
  return joins.length > 0 && joins.every((join) => join.status === 'SUBSCRIBED' && join.latencyMs !== undefined && join.latencyMs <= maxJoinMs);
}

/**
 * Realtime readiness gate. Load may start only after the configured number of
 * consecutive rounds in which every warm-up join subscribes quickly. A cold or
 * unhealthy Realtime service therefore ends the run as "environment not
 * ready" before any measurement, instead of being recorded as a We Glue result.
 */
export async function runRealtimeWarmup(input: {
  phase: string;
  topics: TopicSpec[];
  join: WarmupJoiner;
  limits?: WarmupLimits;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
}): Promise<WarmupResult> {
  const limits = input.limits ?? REALTIME_WARMUP;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? delay;
  const started = now();
  const rounds: WarmupRound[] = [];
  let consecutive = 0;
  while (consecutive < limits.consecutivePasses && !input.shouldStop?.()) {
    if (rounds.length >= limits.maxRounds || now() - started >= limits.maxSeconds * 1000) break;
    const joins = await input.join(input.topics, limits.joinTimeoutMs);
    const passed = warmupRoundPassed(joins, limits.maxJoinMs);
    const latencies = joins.map((join) => join.latencyMs).filter((value): value is number => value !== undefined);
    rounds.push({ round: rounds.length + 1, at: new Date(now()).toISOString(), passed, maxJoinMs: latencies.length ? Math.max(...latencies) : undefined, joins });
    consecutive = passed ? consecutive + 1 : 0;
    if (consecutive < limits.consecutivePasses) await sleep(limits.pauseMs);
  }
  return { phase: input.phase, passed: consecutive >= limits.consecutivePasses, startedAt: new Date(started).toISOString(), endedAt: new Date(now()).toISOString(), rounds };
}

/** Warm-up joiner with the app's client options (supabase-js, private sync topics). */
export function supabaseWarmupJoiner(config: Pick<LoadTestConfig, 'supabaseUrl' | 'anonKey'>, accessToken: () => string): WarmupJoiner {
  return async (topics, timeoutMs) => {
    const client = createClient(config.supabaseUrl, config.anonKey, {
      accessToken: async () => accessToken(),
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const started = performance.now();
    try {
      return await Promise.all(topics.map((spec) => new Promise<WarmupJoin>((resolveJoin) => {
        const channel = spec.mode === 'private-broadcast' ? client.channel(spec.topic, { config: { private: true } }) : client.channel(spec.topic);
        if (spec.mode === 'postgres-changes') for (const binding of spec.bindings) channel.on('postgres_changes' as never, binding as never, () => undefined);
        const timer = setTimeout(() => resolveJoin({ kind: spec.kind, status: 'GATE_TIMEOUT' }), timeoutMs);
        channel.subscribe((status, error) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            resolveJoin({ kind: spec.kind, status, latencyMs: Math.round(performance.now() - started) });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(timer);
            resolveJoin({ kind: spec.kind, status, failure: joinFailureKey(status, error?.message) });
          }
        }, timeoutMs);
      })));
    } finally {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }
  };
}
