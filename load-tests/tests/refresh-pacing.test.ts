import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, maxRefreshSeconds, tokenRefreshIntervalMs } from '../src/config.js';
import { TOKEN_REFRESH_JITTER_MS, TOKEN_REFRESH_WINDOW_SECONDS } from '../src/constants.js';
import { testEnv } from './helpers.js';

vi.mock('../src/supabase.js', () => ({
  userClient: () => ({
    auth: {
      refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
        const userId = refresh_token.replace('refresh-', '');
        return { error: null, data: { session: { user: { id: userId }, access_token: `access-${userId}`, refresh_token: `refresh-${userId}`, expires_at: 9_999_999_999 } } };
      },
    },
  }),
}));

const { refreshSessionsUntil } = await import('../src/auth.js');

/** Largest number of refreshes that land inside any rolling window. */
function maxInWindow(times: number[], windowMs: number): number {
  let best = 0;
  for (let start = 0, end = 0; end < times.length; end += 1) {
    while ((times[end] ?? 0) - (times[start] ?? 0) >= windowMs) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

describe('session-refresh pacing', () => {
  it('derives the spacing from 75% of the verified per-IP refresh limit', () => {
    expect(tokenRefreshIntervalMs(150)).toBe(2_703);
    expect(loadConfig(testEnv()).tokenRefreshIntervalMs).toBe(2_703);
    expect(() => loadConfig(testEnv({ LOADTEST_VERIFIED_TOKEN_REFRESH_LIMIT: undefined }))).toThrow(/TOKEN_REFRESH_LIMIT/);
    expect(() => tokenRefreshIntervalMs(2)).toThrow(/too low/);
  });

  it('keeps 150 refreshes within 75% of the limit in every 5-minute window, even with zero jitter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weglue-refresh-'));
    const config = loadConfig(testEnv({ LOADTEST_RESULTS_DIR: dir }));
    const sessions = Array.from({ length: 150 }, (_, index) => ({ userIndex: index, userId: `u${index}`, accessToken: 'a', refreshToken: `refresh-u${index}`, expiresAt: 0 }));
    mkdirSync(dirname(config.sessionsFile), { recursive: true });

    for (const jitter of [0, 0.999]) {
      writeFileSync(config.sessionsFile, JSON.stringify({ schemaVersion: 2, namespace: config.namespace, seed: config.seed, stagingRef: config.stagingRef, generatedAt: '', sessions }));
      let clock = 0;
      const times = [0];
      const result = await refreshSessionsUntil(config, 1, () => jitter, async (ms) => { clock += ms; times.push(clock); });
      expect(result.refreshed).toBe(150);
      expect(maxInWindow(times, TOKEN_REFRESH_WINDOW_SECONDS * 1000)).toBeLessThanOrEqual(112);
      expect(clock / 1000).toBeLessThanOrEqual(maxRefreshSeconds(config, 150));
    }
    expect(maxRefreshSeconds(config, 150)).toBe(Math.ceil((149 * (2_703 + TOKEN_REFRESH_JITTER_MS)) / 1000));
  });
});
