import { describe, expect, it } from 'vitest';
import { THINK_TIME_MAX_MS, THINK_TIME_MIN_MS } from '../src/constants.js';
import { ARCHETYPE_JOURNEYS, assignArchetypes, generateTrace, verifyTrace } from '../src/trace.js';

describe('deterministic action traces', () => {
  it('generates byte-identical traces and hashes for the same inputs', () => {
    expect(generateTrace('wg-loadtest-repeat', 12345, 20)).toEqual(generateTrace('wg-loadtest-repeat', 12345, 20));
    expect(generateTrace('wg-loadtest-repeat', 12345, 20).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the seed and detects tampering', () => {
    const first = generateTrace('wg-loadtest-repeat', 12345, 5);
    const second = generateTrace('wg-loadtest-repeat', 12346, 5);
    expect(first.sha256).not.toBe(second.sha256);
    first.actions[1]!.thinkTimeMs += 1;
    expect(() => verifyTrace(first)).toThrow(/hash mismatch/);
  });

  it('uses the approved 8–20 s think time (≈14 s mean)', () => {
    const trace = generateTrace('wg-loadtest-pacing', 99, 150);
    const times = trace.actions.map((action) => action.thinkTimeMs);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(THINK_TIME_MIN_MS);
    expect(Math.max(...times)).toBeLessThanOrEqual(THINK_TIME_MAX_MS);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    expect(mean).toBeGreaterThan(13_800);
    expect(mean).toBeLessThan(14_200);
  });

  it('starts every user with a cold launch and never repeats launch afterwards', () => {
    const trace = generateTrace('wg-loadtest-launch', 7, 25, 10);
    for (let user = 0; user < 25; user += 1) {
      const actions = trace.actions.filter((action) => action.userIndex === user);
      expect(actions[0]!.journey).toBe('launch');
      expect(actions.slice(1).some((action) => action.journey === 'launch')).toBe(false);
    }
  });
});

describe('workload archetypes', () => {
  it('matches the approved 60/25/15 mix at the ceiling and for every plateau prefix', () => {
    const archetypes = assignArchetypes(150);
    const count = (users: number, type: string) => archetypes.slice(0, users).filter((value) => value === type).length;
    expect([count(150, 'browser'), count(150, 'social'), count(150, 'communicator')]).toEqual([90, 38, 22]);
    for (const users of [5, 10, 25, 50, 75, 100]) {
      expect(Math.abs(count(users, 'browser') - users * 0.6)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(users, 'social') - users * 0.25)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(users, 'communicator') - users * 0.15)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps each archetype on its own journeys', () => {
    const trace = generateTrace('wg-loadtest-mix', 3, 100, 60);
    for (const action of trace.actions) {
      if (action.journey === 'launch') continue;
      const allowed = ARCHETYPE_JOURNEYS[trace.archetypes[action.userIndex]!].map((item) => item.name);
      expect(allowed).toContain(action.journey);
    }
    const writes = trace.actions.filter((action) => action.journey === 'message-send' || action.journey === 'social-write').length;
    const ratio = writes / trace.actions.length;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });
});
