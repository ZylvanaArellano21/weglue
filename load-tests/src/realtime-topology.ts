import { conversationIndexFor } from '../k6/lib/journeys.js';
import type { Archetype, ExperimentState, SyntheticManifest } from './types.js';

export type TopicKind = 'access' | 'university' | 'message-inbox' | 'block' | 'message' | 'message-inbox-conv' | 'notifications' | 'club-sync';

export type PostgresBinding = { event: '*' | 'INSERT' | 'UPDATE' | 'DELETE'; schema: 'public'; table: string; filter?: string };

export type TopicSpec =
  | { kind: TopicKind; topic: string; mode: 'private-broadcast' }
  | { kind: TopicKind; topic: string; mode: 'postgres-changes'; bindings: PostgresBinding[] };

/**
 * The always-on channels of one signed-in student at the contract commit, plus
 * the open-thread topic for communicators. `salt`/`sequence` mirror
 * createSafeChannel's unique suffix for public postgres_changes channels.
 */
export function baseTopicsFor(input: {
  userId: string;
  userIndex: number;
  archetype: Archetype;
  manifest: Pick<SyntheticManifest, 'universityId' | 'clubSizes' | 'conversationIds'>;
  salt: string;
  sequence: () => number;
}): TopicSpec[] {
  const { userId, manifest } = input;
  const topics: TopicSpec[] = [
    { kind: 'access', topic: `sync:access:${userId}`, mode: 'private-broadcast' },
    { kind: 'university', topic: `sync:university:${manifest.universityId}`, mode: 'private-broadcast' },
    { kind: 'message-inbox', topic: `sync:message-inbox:${userId}`, mode: 'private-broadcast' },
    { kind: 'block', topic: `sync:block:${userId}`, mode: 'private-broadcast' },
    {
      kind: 'notifications',
      topic: `notifications:${userId}:${input.salt}:${input.sequence()}`,
      mode: 'postgres-changes',
      bindings: [
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      ],
    },
    {
      kind: 'club-sync',
      topic: `club-sync:${input.salt}:${input.sequence()}`,
      mode: 'postgres-changes',
      bindings: [
        { event: '*', schema: 'public', table: 'club_members', filter: `user_id=eq.${userId}` },
        { event: 'UPDATE', schema: 'public', table: 'clubs' },
        { event: '*', schema: 'public', table: 'conversation_channels' },
        { event: '*', schema: 'public', table: 'channel_posters' },
      ],
    },
  ];
  if (input.archetype === 'communicator') {
    const index = conversationIndexFor(manifest, input.userIndex, input.userIndex);
    topics.push({ kind: 'message', topic: `sync:message:${manifest.conversationIds[index]}`, mode: 'private-broadcast' });
  }
  return topics;
}

export function bannerTopic(conversationId: string, epoch: number): TopicSpec {
  return { kind: 'message-inbox-conv', topic: `sync:message-inbox-conv:${conversationId}:${epoch}`, mode: 'private-broadcast' };
}

export type JoinOutcome = 'subscribed' | 'expected-unauthorized' | 'unauthorized' | 'error' | 'timeout';

/**
 * At 148 there is no receive policy for `sync:block:<uid>` (it arrives in
 * migration 149), so its Unauthorized join is the expected, measured outcome
 * and is excluded from the valid-join failure rate. Everywhere else — and for
 * `sync:block` at 149 — Unauthorized is a real failure.
 */
export function classifyJoin(status: string, errorMessage: string | undefined, kind: TopicKind, state: ExperimentState): JoinOutcome {
  if (status === 'SUBSCRIBED') return 'subscribed';
  if (status === 'TIMED_OUT') return 'timeout';
  if (/unauthorized/i.test(errorMessage ?? '')) return state === '148' && kind === 'block' ? 'expected-unauthorized' : 'unauthorized';
  return 'error';
}

/** The app's reconnect ladder (packages/shared jitteredReconnectAfterMs). */
export function jitteredReconnectAfterMs(tries: number, random: () => number = Math.random): number {
  const ladder = [1000, 2000, 5000, 10000];
  const base = ladder[tries - 1] ?? 10000;
  return Math.round(base * (1 + random() * 0.5));
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0;
}

/** Send time embedded in campaign message content (`…:t:<epoch-ms>`). */
export function sentAtFromPreview(preview: unknown, namespace: string): number | undefined {
  if (typeof preview !== 'string' || !preview.startsWith(`${namespace}:action:`)) return undefined;
  const match = /:t:(\d{13})$/.exec(preview);
  return match ? Number(match[1]) : undefined;
}

/** Status and message of a failed join, with identifiers removed so failures group. */
export function joinFailureKey(status: string, errorMessage: string | undefined): string {
  const message = (errorMessage ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').trim();
  return (message ? `${status}: ${message}` : status).slice(0, 160);
}

export type RealtimeTotals = { validAttempts: number; validFailures: number; latencies: number[]; resubscribe: number[] };

/** Realtime hard stops. Rates and percentiles fire only with enough samples to mean something. */
export function realtimeHardStopReasons(
  totals: RealtimeTotals,
  eventLoopLagP95Ms: number,
  limits: { realtimeJoinFailureRate: number; realtimeFailureMinAttempts: number; realtimeColdJoinP95Ms: number; realtimeResubscribeP95Ms: number; realtimeP95MinSamples: number; generatorEventLoopLagP95Ms: number },
): string[] {
  const reasons: string[] = [];
  const failureRate = totals.validAttempts > 0 ? totals.validFailures / totals.validAttempts : 0;
  if (totals.validAttempts >= limits.realtimeFailureMinAttempts && failureRate > limits.realtimeJoinFailureRate) {
    reasons.push(`valid Realtime join failure rate ${(failureRate * 100).toFixed(2)}% > ${limits.realtimeJoinFailureRate * 100}%`);
  }
  if (totals.latencies.length >= limits.realtimeP95MinSamples && percentile(totals.latencies, 0.95) > limits.realtimeColdJoinP95Ms) {
    reasons.push(`Realtime cold join p95 > ${limits.realtimeColdJoinP95Ms}ms`);
  }
  if (totals.resubscribe.length >= limits.realtimeP95MinSamples && percentile(totals.resubscribe, 0.95) > limits.realtimeResubscribeP95Ms) {
    reasons.push(`full resubscription p95 > ${limits.realtimeResubscribeP95Ms}ms`);
  }
  if (eventLoopLagP95Ms > limits.generatorEventLoopLagP95Ms) reasons.push(`generator event-loop lag p95 ${eventLoopLagP95Ms.toFixed(1)}ms > ${limits.generatorEventLoopLagP95Ms}ms (run invalid: generator-bound)`);
  return reasons;
}
