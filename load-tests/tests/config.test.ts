import { describe, expect, it } from 'vitest';
import { calculateCeiling, controlledConfig, loadConfig, plannedJoinsPerSecond } from '../src/config.js';
import { CAMPAIGN_CONFIRMATION, KNOWN_STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF, WRITE_CONFIRMATION } from '../src/constants.js';
import { testEnv } from './helpers.js';

describe('production-target prevention', () => {
  it('refuses the production project by URL, by ref, or by database URL', () => {
    expect(() => loadConfig(testEnv({ LOADTEST_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }))).toThrow(/REFUSING PRODUCTION TARGET/);
    expect(() => loadConfig(testEnv({ LOADTEST_STAGING_REF: PRODUCTION_PROJECT_REF }))).toThrow(/REFUSING PRODUCTION TARGET/);
    expect(() => loadConfig(testEnv({ LOADTEST_DATABASE_URL: `postgres://postgres.${PRODUCTION_PROJECT_REF}@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres` }))).toThrow(/PRODUCTION/);
  });

  it('accepts only the immutable staging allowlist and a matching URL', () => {
    expect(loadConfig(testEnv()).stagingRef).toBe(KNOWN_STAGING_PROJECT_REF);
    expect(() => loadConfig(testEnv({ LOADTEST_STAGING_REF: 'abcdefghijklmnopqrst', LOADTEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }))).toThrow(/NON-ALLOWLISTED/);
    expect(() => loadConfig(testEnv({ LOADTEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }))).toThrow(/does not match/);
    expect(() => loadConfig(testEnv({ LOADTEST_SUPABASE_URL: `http://${KNOWN_STAGING_PROJECT_REF}.supabase.co` }))).toThrow(/https/);
    expect(() => loadConfig(testEnv({ LOADTEST_SUPABASE_URL: `https://${KNOWN_STAGING_PROJECT_REF}.supabase.co.evil.example` }))).toThrow(/exactly/);
    expect(() => loadConfig(testEnv({ LOADTEST_DATABASE_URL: 'postgres://postgres@db.example.com/postgres' }))).toThrow(/allowlisted staging/);
  });
});

describe('ceiling and join-rate safety', () => {
  it('caps at 150 and 75% of the verified Realtime limit', () => {
    expect(calculateCeiling(1000)).toBe(150);
    expect(calculateCeiling(120)).toBe(90);
    expect(() => calculateCeiling(0)).toThrow();
  });

  it('refuses to silently clamp an over-ceiling request', () => {
    expect(() => loadConfig(testEnv({ LOADTEST_VERIFIED_REALTIME_LIMIT: '100', LOADTEST_REQUESTED_USERS: '76' }))).toThrow(/exceeds approved ceiling 75/);
  });

  it('keeps planned channel joins/second under 75% of the verified limit', () => {
    // 150 users over a 120 s ramp × 12 channels = 15 joins/s.
    expect(plannedJoinsPerSecond(150, 'steady', 1)).toBeCloseTo(15);
    expect(() => loadConfig(testEnv({ LOADTEST_VERIFIED_JOINS_PER_SECOND_LIMIT: '19' }))).toThrow(/joins\/second/);
    expect(loadConfig(testEnv({ LOADTEST_VERIFIED_JOINS_PER_SECOND_LIMIT: '20' })).joinsPerSecondLimit).toBe(20);
    expect(() => loadConfig(testEnv({ LOADTEST_SCENARIO: 'cold-connect', LOADTEST_COLD_CONNECT_RATE: '10' }))).toThrow(/joins\/second/);
    expect(() => loadConfig(testEnv({ LOADTEST_SCENARIO: 'cold-connect', LOADTEST_COLD_CONNECT_RATE: '7' }))).toThrow(/COLD_CONNECT_RATE/);
  });
});

describe('experiment identity', () => {
  it('requires a synthetic namespace, reserved email domain, cache mode, run label and edge inventory', () => {
    expect(() => loadConfig(testEnv({ LOADTEST_NAMESPACE: 'baseline' }))).toThrow(/wg-loadtest/);
    expect(() => loadConfig(testEnv({ LOADTEST_EMAIL_DOMAIN: 'real.edu' }))).toThrow(/reserved \.invalid/);
    expect(() => loadConfig(testEnv({ LOADTEST_CACHE_MODE: undefined }))).toThrow(/CACHE_MODE/);
    expect(() => loadConfig(testEnv({ LOADTEST_RUN_LABEL: 'Run 1' }))).toThrow(/RUN_LABEL/);
    expect(() => loadConfig(testEnv({ LOADTEST_EDGE_FUNCTION_INVENTORY: undefined }))).toThrow(/EDGE_FUNCTION_INVENTORY/);
    expect(() => loadConfig(testEnv({ LOADTEST_EXPECTED_STATE: '150' }))).toThrow(/148 or 149/);
  });

  it('needs the exact approval phrases', () => {
    const loose = loadConfig(testEnv({ LOADTEST_CONFIRM_WRITES: 'yes', LOADTEST_CONFIRM_CAMPAIGN: 'yes' }));
    expect(loose.writeApproved).toBe(false);
    expect(loose.campaignApproved).toBe(false);
    const exact = loadConfig(testEnv({ LOADTEST_CONFIRM_WRITES: WRITE_CONFIRMATION, LOADTEST_CONFIRM_CAMPAIGN: CAMPAIGN_CONFIRMATION }));
    expect(exact.writeApproved).toBe(true);
    expect(exact.campaignApproved).toBe(true);
  });

  it('separates runs by state/scenario/cache/label and keeps sessions out of result folders', () => {
    const config = loadConfig(testEnv());
    expect(config.runDir).toMatch(/runs\/148-steady-warm-r1$/);
    expect(config.sessionsFile).toMatch(/\/private\/sessions\.json$/);
    expect(config.sessionsFile.startsWith(config.runDir)).toBe(false);
  });

  it('controlled configuration differs only by state-independent fields and holds no secrets', () => {
    const pre = controlledConfig(loadConfig(testEnv()));
    const post = controlledConfig(loadConfig(testEnv({ LOADTEST_EXPECTED_STATE: '149', LOADTEST_RUN_LABEL: 'r9' })));
    expect(post).toEqual(pre);
    const serialized = JSON.stringify(pre);
    expect(serialized).not.toContain('service-role-test-secret');
    expect(serialized).not.toContain('db-test-secret');
    expect(serialized).not.toContain('anon-test-key');
  });
});
