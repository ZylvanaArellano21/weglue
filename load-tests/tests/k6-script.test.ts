import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateTrace } from '../src/trace.js';
import { manifestFixture } from './fixtures.js';

// Executes the real k6 script against inert k6 modules (tests/k6-stubs).
type K6Module = { options: Record<string, any>; default: () => void; handleSummary: (data: unknown) => Record<string, string> };
let script: K6Module;
let http: { calls: Array<{ method: string; url: string; body: string | null; params: { headers: Record<string, string>; tags: Record<string, string> } }> };
let execution: { state: { vu: number; iteration: number } };
let metrics: { samples: Array<{ name: string; value: number; tags?: Record<string, string> }> };
let k6: { sleeps: number[] };
const dir = mkdtempSync(join(tmpdir(), 'wg-k6-'));

beforeAll(async () => {
  const trace = generateTrace(manifestFixture.namespace, manifestFixture.seed, 10, 5);
  const sessions = { schemaVersion: 2, namespace: manifestFixture.namespace, seed: manifestFixture.seed, stagingRef: manifestFixture.stagingRef, generatedAt: '', sessions: manifestFixture.users.slice(0, 10).map((user) => ({ userIndex: user.index, userId: user.id, accessToken: `token-${user.index}`, refreshToken: 'r', expiresAt: 0 })) };
  const files = { trace: join(dir, 'trace.json'), manifest: join(dir, 'manifest.json'), sessions: join(dir, 'sessions.json') };
  writeFileSync(files.trace, JSON.stringify(trace));
  writeFileSync(files.manifest, JSON.stringify(manifestFixture));
  writeFileSync(files.sessions, JSON.stringify(sessions));
  Object.assign(globalThis, {
    open: (path: string) => readFileSync(path, 'utf8'),
    __ENV: {
      LOADTEST_SUPABASE_URL: 'https://cwwmuxxqxovhcnnardlj.supabase.co',
      LOADTEST_SUPABASE_ANON_KEY: 'anon',
      LOADTEST_NAMESPACE: manifestFixture.namespace,
      LOADTEST_EXPECTED_STATE: '148',
      LOADTEST_REQUESTED_USERS: '10',
      LOADTEST_EFFECTIVE_CEILING: '150',
      LOADTEST_PLATEAU_INDEX: '2',
      LOADTEST_PLATEAU_USERS: '10',
      LOADTEST_PLATEAU_RAMP_SECONDS: '120',
      LOADTEST_PLATEAU_HOLD_SECONDS: '600',
      LOADTEST_PLATEAU_RAMP_DOWN_SECONDS: '30',
      LOADTEST_TRACE_FILE: files.trace,
      LOADTEST_MANIFEST_FILE: files.manifest,
      LOADTEST_SESSIONS_FILE: files.sessions,
      LOADTEST_SUMMARY_FILE: join(dir, 'summary.json'),
    },
  });
  script = (await import('../k6/main.js')) as unknown as K6Module;
  http = (await import('./k6-stubs/http.js')) as unknown as typeof http;
  execution = (await import('./k6-stubs/execution.js')) as unknown as typeof execution;
  metrics = (await import('./k6-stubs/metrics.js')) as unknown as typeof metrics;
  k6 = (await import('./k6-stubs/k6.js')) as unknown as typeof k6;
});

describe('k6 plateau script', () => {
  it('runs exactly one plateau: ramp, hold, ramp-down, with the approved hard stops', () => {
    const scenario = script.options.scenarios.plateau;
    expect(scenario.executor).toBe('ramping-vus');
    expect(scenario.stages).toEqual([{ duration: '120s', target: 10 }, { duration: '600s', target: 10 }, { duration: '30s', target: 0 }]);
    expect(script.options.thresholds.weglue_request_errors[0]).toMatchObject({ threshold: 'rate<=0.05', abortOnFail: true, delayAbortEval: '60s' });
    expect(script.options.thresholds.weglue_timeouts[0]).toMatchObject({ threshold: 'rate<=0.01', abortOnFail: true });
    expect(script.options.thresholds.weglue_interactive_duration[0]).toMatchObject({ threshold: 'p(95)<=5000', abortOnFail: true, delayAbortEval: '120s' });
    expect(script.options.thresholds['weglue_interactive_duration{window:12}']).toEqual(['p(95)>=0']);
    expect(script.options.thresholds['weglue_journey_duration{journey:message-send}']).toEqual(['p(95)>=0']);
  });

  it('maps each VU to its own synthetic session and replays the trace in order', () => {
    execution.state.vu = 4;
    execution.state.iteration = 0;
    http.calls.length = 0;
    script.default();
    expect(http.calls.length).toBeGreaterThan(10); // cold launch fan-out
    for (const call of http.calls) {
      expect(call.url.startsWith('https://cwwmuxxqxovhcnnardlj.supabase.co/rest/v1/')).toBe(true);
      expect(call.params.headers.Authorization).toBe('Bearer token-3');
      expect(call.params.headers.apikey).toBe('anon');
      expect(call.params.tags).toMatchObject({ journey: 'launch', state: '148', window: '2', plateau: '2' });
    }
    expect(metrics.samples.some((sample) => sample.name === 'weglue_launch_duration')).toBe(true);
    expect(k6.sleeps.at(-1)).toBeGreaterThanOrEqual(8);
    expect(k6.sleeps.at(-1)).toBeLessThanOrEqual(20);
  });

  it('sends UUID-tagged synthetic messages', () => {
    let found = false;
    for (let vu = 1; vu <= 10 && !found; vu += 1) {
      for (let iteration = 1; iteration < 5 && !found; iteration += 1) {
        execution.state.vu = vu;
        execution.state.iteration = iteration;
        http.calls.length = 0;
        script.default();
        const send = http.calls.find((call) => call.method === 'POST' && call.url.endsWith('/rest/v1/messages'));
        if (send) {
          const body = JSON.parse(send.body!);
          expect(body.client_tag).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          expect(body.content).toMatch(new RegExp(`^${manifestFixture.namespace}:action:\\d+:cycle:0:t:\\d{13}$`));
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('writes a summary identifying the plateau, trace and state', () => {
    const output = script.handleSummary({ metrics: { http_reqs: { values: { count: 1 } } } });
    const summary = JSON.parse(Object.values(output)[0]!);
    expect(Object.keys(output)[0]).toBe(join(dir, 'summary.json'));
    expect(summary).toMatchObject({ schemaVersion: 2, state: '148', plateau: { index: 2, users: 10 }, namespace: manifestFixture.namespace });
    expect(summary.traceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
