import { describe, expect, it } from 'vitest';
import { REALTIME_WARMUP } from '../src/constants.js';
import { runRealtimeWarmup, warmupRoundPassed, warmupTopics, type WarmupJoin } from '../src/realtime-warmup.js';
import { manifestFixture } from './fixtures.js';

const session = { userIndex: 0, userId: '00000000-0000-4000-8000-00000000000a', accessToken: 'a', refreshToken: 'r', expiresAt: 0 };
const limits = { ...REALTIME_WARMUP, pauseMs: 0, maxRounds: 8 };
const ok = (ms: number): WarmupJoin => ({ kind: 'access', status: 'SUBSCRIBED', latencyMs: ms });

describe('Realtime warm-up gate', () => {
  it('uses the base topics except block, so 148 and 149 run the identical gate', () => {
    const kinds = warmupTopics(session, manifestFixture).map((topic) => topic.kind);
    expect(kinds).toEqual(['access', 'university', 'message-inbox', 'notifications', 'club-sync']);
  });

  it('passes a round only when every join subscribes within the limit', () => {
    expect(warmupRoundPassed([ok(300), ok(1_999)], 2_000)).toBe(true);
    expect(warmupRoundPassed([ok(300), ok(2_001)], 2_000)).toBe(false);
    expect(warmupRoundPassed([ok(300), { kind: 'university', status: 'CHANNEL_ERROR', failure: 'Unauthorized' }], 2_000)).toBe(false);
    expect(warmupRoundPassed([], 2_000)).toBe(false);
  });

  it('needs consecutive passing rounds; a bad round resets the count', async () => {
    const script = [[ok(9_000)], [ok(400)], [ok(400)], [ok(4_000)], [ok(400)], [ok(350)], [ok(300)]];
    let call = 0;
    const result = await runRealtimeWarmup({ phase: 'test', topics: [], join: async () => script[call++]!, limits });
    expect(result.passed).toBe(true);
    expect(result.rounds.map((round) => round.passed)).toEqual([false, true, true, false, true, true, true]);
    expect(result.rounds.at(-1)?.maxJoinMs).toBe(300);
  });

  it('fails after the round limit without ever reporting a pass', async () => {
    const result = await runRealtimeWarmup({ phase: 'test', topics: [], join: async () => [ok(9_000)], limits });
    expect(result).toMatchObject({ passed: false });
    expect(result.rounds).toHaveLength(8);
  });

  it('stops early when the supervisor is stopping', async () => {
    let calls = 0;
    const result = await runRealtimeWarmup({ phase: 'test', topics: [], join: async () => { calls += 1; return [ok(400)]; }, limits, shouldStop: () => calls >= 1 });
    expect(result.passed).toBe(false);
    expect(result.rounds).toHaveLength(1);
  });
});
