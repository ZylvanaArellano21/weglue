import { describe, expect, it } from 'vitest';
import { assertSessionsCover } from '../src/auth.js';
import { cpuRatio } from '../src/campaign.js';
import { KNOWN_STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF } from '../src/constants.js';
import { HARD_STOP_THRESHOLDS } from '../src/constants.js';
import { assertCronIsolation, assertMigrationMarkers, assertNoUnlistedCronRuns, classifyPushDispatch } from '../src/preflight.js';
import { hostCounters, hostRatios, HostTracker, parsePrometheus, SustainedCondition } from '../src/prometheus.js';
import { buildPlateaus, buildRampLevels, campaignSeconds, targetUsersAt } from '../src/ramp.js';
import { baseTopicsFor, classifyJoin, jitteredReconnectAfterMs, joinFailureKey, realtimeHardStopReasons, sentAtFromPreview } from '../src/realtime-topology.js';
import { manifestFixture } from './fixtures.js';

const none = { migration149Function: false, migration149Policy: false, migration150InsertTrigger: false, migration150UpdateTrigger: false };

describe('environment state guards', () => {
  it('requires 149 objects to be absent at 148, present at 149, and 150 objects absent always', () => {
    expect(() => assertMigrationMarkers(none, '148')).not.toThrow();
    expect(() => assertMigrationMarkers({ ...none, migration149Policy: true }, '148')).toThrow(/149 objects are present/);
    expect(() => assertMigrationMarkers({ ...none, migration149Function: true, migration149Policy: true }, '149')).not.toThrow();
    expect(() => assertMigrationMarkers({ ...none, migration149Function: true }, '149')).toThrow(/missing/);
    // Ledger says 148 but migration 150's triggers exist (seen on a real local stack).
    expect(() => assertMigrationMarkers({ ...none, migration150InsertTrigger: true }, '148')).toThrow(/migration 150/);
    expect(() => assertMigrationMarkers({ migration149Function: true, migration149Policy: true, migration150InsertTrigger: false, migration150UpdateTrigger: true }, '149')).toThrow(/migration 150/);
  });

  it('never lets staging push dispatch reach production or a foreign project', () => {
    expect(classifyPushDispatch(null)).toBe('dispatch-disabled');
    expect(classifyPushDispatch(`https://${KNOWN_STAGING_PROJECT_REF}.supabase.co/functions/v1/send-push`)).toBe('staging-dispatch');
    expect(() => classifyPushDispatch(`https://${PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/send-push`)).toThrow(/PRODUCTION/);
    expect(() => classifyPushDispatch('https://example.com/push')).toThrow(/allowlisted staging/);
  });

  it('refuses active cron jobs that call production or another project', () => {
    const prod = { jobname: 'sync-store-versions', active: true, command: `select net.http_post(url := 'https://${PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/sync-store-versions')` };
    expect(() => assertCronIsolation([prod])).toThrow(/PRODUCTION/);
    expect(() => assertCronIsolation([{ ...prod, active: false }])).not.toThrow();
    expect(() => assertCronIsolation([{ ...prod, command: "select net.http_post(url := 'https://abcdefghijklmnopqrst.supabase.co/x')" }])).toThrow(/non-staging/);
    expect(() => assertCronIsolation([{ jobname: 'dispatch-push', active: true, command: 'select public.invoke_push_dispatch()' }])).not.toThrow();
  });

  it('refuses a stale pg_cron scheduler that runs jobs absent from cron.job', () => {
    expect(() => assertNoUnlistedCronRuns([{ jobid: 5, command: 'SELECT public.invoke_push_dispatch();' }], [1, 4, 5])).not.toThrow();
    expect(() => assertNoUnlistedCronRuns([{ jobid: 8, command: 'SELECT public.process_notification_fanout();' }], [1, 4, 5])).toThrow(/absent from cron.job.*#8/);
  });

  it('requires sessions that outlive the plateau', () => {
    const token = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.x`;
    const sessions = Array.from({ length: 5 }, (_, userIndex) => ({ userIndex, userId: `u${userIndex}`, accessToken: token(2_000), refreshToken: 'r', expiresAt: 2_000 }));
    const bundle = { schemaVersion: 2 as const, namespace: 'n', seed: 1, stagingRef: 's', generatedAt: '', sessions };
    expect(() => assertSessionsCover(bundle, 5, 1_999)).not.toThrow();
    expect(() => assertSessionsCover(bundle, 5, 2_001)).toThrow(/expire/);
    expect(() => assertSessionsCover(bundle, 6, 1_000)).toThrow(/at least 6/);
  });
});

describe('approved concurrency ramp', () => {
  it('uses the approved levels, holds, two-minute ramps and five-minute cooldowns', () => {
    expect(buildRampLevels(150)).toEqual([1, 5, 10, 25, 50, 75, 100, 150]);
    expect(buildRampLevels(90)).toEqual([1, 5, 10, 25, 50, 75, 90]);
    const plateaus = buildPlateaus(150);
    expect(plateaus.map((plateau) => plateau.holdSeconds)).toEqual([300, 300, 600, 600, 600, 600, 600, 900]);
    expect(plateaus.every((plateau) => plateau.rampSeconds === 120 && plateau.cooldownSeconds === 300)).toBe(true);
    expect(buildPlateaus(90).at(-1)!.holdSeconds).toBe(900);
    expect(campaignSeconds(plateaus)).toBe(4_500 + 8 * (120 + 30 + 300));
  });

  it('ramps linearly, holds, then ramps down to zero', () => {
    const plateau = buildPlateaus(150)[7]!;
    expect(targetUsersAt(0, plateau)).toBe(1);
    expect(targetUsersAt(60, plateau)).toBe(75);
    expect(targetUsersAt(120, plateau)).toBe(150);
    expect(targetUsersAt(120 + 899, plateau)).toBe(150);
    expect(targetUsersAt(120 + 900 + 15, plateau)).toBe(75);
    expect(targetUsersAt(120 + 900 + 30, plateau)).toBe(0);
  });

  it('cold-connect scenarios ramp at the configured arrival rate', () => {
    expect(buildPlateaus(150, 'cold-connect', 5).at(-1)!.rampSeconds).toBe(30);
    expect(buildPlateaus(150, 'cold-connect', 1).at(-1)!.rampSeconds).toBe(150);
  });
});

describe('Realtime topology and join classification', () => {
  it('reproduces the app channels: four private broadcasts, two public postgres_changes, thread for communicators', () => {
    let sequence = 0;
    const topics = baseTopicsFor({ userId: 'u1', userIndex: 3, archetype: 'browser', manifest: manifestFixture, salt: 'abc', sequence: () => ++sequence });
    expect(topics.filter((topic) => topic.mode === 'private-broadcast').map((topic) => topic.topic)).toEqual([
      'sync:access:u1', `sync:university:${manifestFixture.universityId}`, 'sync:message-inbox:u1', 'sync:block:u1',
    ]);
    const publicTopics = topics.filter((topic) => topic.mode === 'postgres-changes');
    expect(publicTopics.map((topic) => topic.topic)).toEqual(['notifications:u1:abc:1', 'club-sync:abc:2']);
    const communicator = baseTopicsFor({ userId: 'u1', userIndex: 3, archetype: 'communicator', manifest: manifestFixture, salt: 'abc', sequence: () => ++sequence });
    expect(communicator.find((topic) => topic.kind === 'message')?.topic).toMatch(/^sync:message:40000000-/);
  });

  it('treats the 148 sync:block denial as expected and every other denial as a failure', () => {
    expect(classifyJoin('SUBSCRIBED', undefined, 'block', '148')).toBe('subscribed');
    expect(classifyJoin('CHANNEL_ERROR', 'Unauthorized: You do not have permissions', 'block', '148')).toBe('expected-unauthorized');
    expect(classifyJoin('CHANNEL_ERROR', 'Unauthorized: You do not have permissions', 'block', '149')).toBe('unauthorized');
    expect(classifyJoin('CHANNEL_ERROR', 'Unauthorized', 'access', '148')).toBe('unauthorized');
    expect(classifyJoin('CHANNEL_ERROR', 'boom', 'block', '148')).toBe('error');
    expect(classifyJoin('TIMED_OUT', undefined, 'university', '149')).toBe('timeout');
  });

  it('reconnects on the app ladder with ±50% jitter', () => {
    expect(jitteredReconnectAfterMs(1, () => 0)).toBe(1_000);
    expect(jitteredReconnectAfterMs(1, () => 0.999)).toBeLessThanOrEqual(1_500);
    expect(jitteredReconnectAfterMs(3, () => 0.5)).toBe(6_250);
    expect(jitteredReconnectAfterMs(9, () => 0)).toBe(10_000);
  });

  it('reads the send time only from campaign messages', () => {
    expect(sentAtFromPreview('wg-loadtest-x:action:1:cycle:0:t:1790000000000', 'wg-loadtest-x')).toBe(1_790_000_000_000);
    expect(sentAtFromPreview('hello :t:1790000000000', 'wg-loadtest-x')).toBeUndefined();
  });
});

describe('infrastructure observation', () => {
  const scrape = (idle: number, total: number, available: number, ops: number) => `
# HELP node_cpu_seconds_total x
node_cpu_seconds_total{cpu="0",mode="idle"} ${idle}
node_cpu_seconds_total{cpu="0",mode="user"} ${total - idle}
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes ${available}
node_disk_reads_completed_total{device="nvme0n1"} ${ops / 2}
node_disk_writes_completed_total{device="nvme0n1"} ${ops / 2}
`;

  it('derives CPU, memory and IOPS ratios from node_exporter series', () => {
    const first = hostCounters(parsePrometheus(scrape(100, 200, 400, 1_000)), 0);
    const second = hostCounters(parsePrometheus(scrape(110, 250, 300, 2_000)), 5_000);
    const ratios = hostRatios(first, second, 400);
    expect(ratios.cpuRatio).toBeCloseTo(0.8);
    expect(ratios.memoryRatio).toBeCloseTo(0.7);
    expect(ratios.diskIops).toBeCloseTo(200);
    expect(ratios.diskIopsRatio).toBeCloseTo(0.5);
  });

  it('reports missing series as unavailable instead of guessing', () => {
    expect(hostRatios(undefined, hostCounters(parsePrometheus('up 1'), 0))).toEqual({});
  });

  it('only fires sustained conditions after the full window', () => {
    const condition = new SustainedCondition(60_000);
    expect(condition.update(true, 0)).toBe(false);
    expect(condition.update(true, 59_000)).toBe(false);
    expect(condition.update(true, 60_000)).toBe(true);
    expect(condition.update(false, 61_000)).toBe(false);
    expect(condition.update(true, 62_000)).toBe(false);
  });

  it('computes generator CPU from os.cpus deltas', () => {
    const snapshot = (idle: number, user: number) => [{ model: 'x', speed: 1, times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
    expect(cpuRatio(snapshot(100, 100), snapshot(110, 190))).toBeCloseTo(0.9);
  });
});

describe('cached Metrics API counters', () => {
  const at = (seconds: number, cpuIdle: number, cpuTotal: number, diskOps: number) => ({ at: seconds * 1000, cpuIdleSeconds: cpuIdle, cpuTotalSeconds: cpuTotal, diskOps, memTotalBytes: 100, memAvailableBytes: 40 });

  it('computes rates only across observed refreshes and carries the last value forward', () => {
    const tracker = new HostTracker(3000);
    // Counters refresh once a minute; the observer scrapes every 5 s.
    expect(tracker.update(at(0, 100, 200, 1000))).toMatchObject({ hostCountersRefreshed: true, memoryRatio: 0.6 });
    expect(tracker.update(at(5, 100, 200, 1000)).cpuRatio).toBeUndefined();
    // First refresh spans an unknown part of a cache period: not reported.
    expect(tracker.update(at(60, 130, 260, 7000)).cpuRatio).toBeUndefined();
    const second = tracker.update(at(120, 157, 320, 13000));
    expect(second.cpuRatio).toBeCloseTo(0.55);
    expect(second.diskIops).toBeCloseTo(100);
    expect(second.diskIopsRatio).toBeCloseTo(100 / 3000);
    // Between refreshes the last real measurement is carried, never dropped to 0.
    const carried = tracker.update(at(125, 157, 320, 13000));
    expect(carried).toMatchObject({ hostCountersRefreshed: false, hostSampleAgeSeconds: 5 });
    expect(carried.cpuRatio).toBeCloseTo(0.55);
    expect(carried.diskIops).toBeCloseTo(100);
  });

  it('lets a sustained CPU condition hold across cached scrapes', () => {
    const tracker = new HostTracker();
    const cpu = new SustainedCondition(120_000);
    tracker.update(at(0, 0, 0, 0));
    tracker.update(at(60, 5, 60, 0));
    let fired = false;
    for (let second = 120; second <= 300; second += 5) {
      const refresh = second % 60 === 0;
      const minute = Math.floor(second / 60);
      const sample = tracker.update(at(refresh ? second : minute * 60, 5 + (minute - 1) * 3, minute * 60, 0));
      fired ||= cpu.update((sample.cpuRatio ?? 0) >= 0.9, second * 1000);
    }
    expect(fired).toBe(true);
  });
});

describe('Realtime hard stops and failure evidence', () => {
  const none = { validAttempts: 0, validFailures: 0, latencies: [] as number[], resubscribe: [] as number[] };

  it('does not hard-stop a p95 or a failure rate that rests on too few samples', () => {
    expect(realtimeHardStopReasons({ ...none, validAttempts: 6, validFailures: 5, latencies: [18_870] }, 5, HARD_STOP_THRESHOLDS)).toEqual([]);
  });

  it('hard-stops once enough samples show the breach', () => {
    const slow = Array(20).fill(16_000);
    expect(realtimeHardStopReasons({ ...none, validAttempts: 20, latencies: slow }, 5, HARD_STOP_THRESHOLDS)).toEqual(['Realtime cold join p95 > 15000ms']);
    expect(realtimeHardStopReasons({ ...none, validAttempts: 50, validFailures: 2 }, 5, HARD_STOP_THRESHOLDS)).toEqual(['valid Realtime join failure rate 4.00% > 2%']);
    expect(realtimeHardStopReasons({ ...none, resubscribe: slow }, 5, HARD_STOP_THRESHOLDS)).toEqual(['full resubscription p95 > 15000ms']);
    expect(realtimeHardStopReasons(none, 80, HARD_STOP_THRESHOLDS)[0]).toMatch(/generator-bound/);
  });

  it('groups join failures by status and message without identifiers', () => {
    expect(joinFailureKey('CHANNEL_ERROR', 'Unauthorized: You do not have permissions to read from this Channel topic: sync:access:9c5b9b74-16f1-4e50-94d2-33a5bdabcf34'))
      .toBe('CHANNEL_ERROR: Unauthorized: You do not have permissions to read from this Channel topic: sync:access:<uuid>');
    expect(joinFailureKey('TIMED_OUT', undefined)).toBe('TIMED_OUT');
  });
});
