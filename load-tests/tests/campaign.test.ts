import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { CAMPAIGN_CONFIRMATION } from '../src/constants.js';
import { generateTrace, writeTrace } from '../src/trace.js';
import type { Plateau } from '../src/types.js';
import { manifestFixture } from './fixtures.js';
import { testEnv } from './helpers.js';

// Fake child processes: behaviour chosen per spawned script.
type Behaviour = { k6Exit: (plateau: number) => number; realtimeLines: (plateau: number) => string[] };
const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
let behaviour: Behaviour;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  kill() {
    this.killed = true;
    this.finish(0);
    return true;
  }
  finish(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    setImmediate(() => this.emit('exit', code));
  }
}

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      spawned.push({ command, args, env: options.env });
      const child = new FakeChild();
      const plateau = Number(options.env.LOADTEST_PLATEAU_INDEX);
      const script = args.find((arg) => arg.endsWith('.js')) ?? '';
      setImmediate(() => {
        if (script.endsWith('observer-worker.js')) return; // runs until killed
        if (script.endsWith('realtime-worker.js')) {
          for (const line of behaviour.realtimeLines(plateau)) child.stdout.write(`${line}\n`);
          child.finish(0);
        } else if (command === 'k6') {
          child.finish(behaviour.k6Exit(plateau));
        }
      });
      return child;
    },
  };
});
vi.mock('../src/preflight.js', () => ({
  runPreflight: async () => ({
    checkedAt: '', state: '148', ledgerVersions: ['001'], ledgerSha256: 'l', fingerprint: { sections: {}, objects: {} }, markers: {},
    pushMode: 'dispatch-disabled', cronJobs: [], universityName: 'Load Test U', syntheticPushTokens: 0, otherActiveClientBackends: 0, serverVersion: '17',
  }),
}));
vi.mock('../src/cleanup.js', () => ({ countRunScopedRows: async () => 0 }));
vi.mock('../src/auth.js', () => ({
  refreshSessionsUntil: async () => ({ refreshed: 0, bundle: { sessions: [] } }),
  assertSessionsCover: () => undefined,
}));
vi.mock('pg', () => ({ default: { Pool: class { query = async () => ({ rows: [{ now: new Date('2026-09-25T00:00:00Z') }] }); end = async () => undefined; } } }));

const plateaus: Plateau[] = [
  { index: 0, users: 1, rampSeconds: 1, holdSeconds: 1, rampDownSeconds: 1, cooldownSeconds: 0 },
  { index: 1, users: 5, rampSeconds: 1, holdSeconds: 1, rampDownSeconds: 1, cooldownSeconds: 0 },
];

function setup(label: string) {
  const dir = mkdtempSync(join(tmpdir(), 'wg-campaign-'));
  const config = { ...loadConfig(testEnv({ LOADTEST_REQUESTED_USERS: '5', LOADTEST_CONFIRM_CAMPAIGN: CAMPAIGN_CONFIRMATION, LOADTEST_RUN_LABEL: label, LOADTEST_RESULTS_DIR: dir })), idleBaselineSeconds: 0 };
  writeTrace(config.traceFile, generateTrace(config.namespace, config.seed, 5, 2));
  writeFileSync(config.manifestFile, JSON.stringify(manifestFixture));
  return config;
}

const repoRoot = resolve(__dirname, '../..');

beforeEach(() => {
  spawned.length = 0;
});

describe('campaign supervisor', () => {
  it('refuses to start without the exact campaign approval', async () => {
    const { runCampaign } = await import('../src/campaign.js');
    const config = { ...setup('noapproval'), campaignApproved: false };
    await expect(runCampaign(config, repoRoot, { plateaus })).rejects.toThrow(/REFUSING LOAD/);
    expect(spawned).toHaveLength(0);
  });

  it('stops on a k6 hard stop, still runs the cooldown, and never starts the next plateau', async () => {
    const { runCampaign } = await import('../src/campaign.js');
    behaviour = { k6Exit: () => 99, realtimeLines: () => [] };
    const config = setup('hardstop');
    const manifest = await runCampaign(config, repoRoot, { plateaus });
    expect(manifest.status).toBe('hard-stop');
    expect(manifest.stopReason).toMatch(/k6 exited with 99/);
    expect(manifest.plateauRuns.map((run) => run.index)).toEqual([0]);
    expect(manifest.plateauRuns[0]!.cooldownEndedAt).toBeDefined();
    const events = readFileSync(join(config.runDir, 'events.ndjson'), 'utf8');
    expect(events).toMatch(/"type":"hard-stop","at":"[^"]+","source":"k6","plateau":0/);
    expect(events).toMatch(/plateau-cooldown-end/);
    expect(spawned.filter((call) => call.command === 'k6')).toHaveLength(1);
    expect(existsSync(join(config.runDir, 'analysis.json'))).toBe(true);
  });

  it('does not advance past a plateau it cannot classify as safe', async () => {
    const { runCampaign } = await import('../src/campaign.js');
    behaviour = { k6Exit: () => 0, realtimeLines: () => [] };
    const config = setup('degraded');
    const manifest = await runCampaign(config, repoRoot, { plateaus });
    // No k6 summary and no observer samples: recovery cannot be verified → degraded.
    expect(manifest.status).toBe('degraded-stop');
    expect(manifest.plateauRuns.map((run) => run.index)).toEqual([0]);
    expect(readFileSync(join(config.runDir, 'events.ndjson'), 'utf8')).toMatch(/"classification":"degraded"/);
  });

  it('gives secrets only to the observer and writes a secret-free manifest', async () => {
    const { runCampaign } = await import('../src/campaign.js');
    behaviour = { k6Exit: () => 99, realtimeLines: () => [JSON.stringify({ type: 'realtime-window', plateau: 0, window: 0, joins: {}, resubscribeMs: [], deliveries: 0, duplicateDeliveries: 0, deliveryLatencyMs: [], reconnects: 0, eventLoopLagP95Ms: 1 })] };
    const config = setup('secrets');
    await runCampaign(config, repoRoot, { plateaus });
    for (const call of spawned) {
      const env = JSON.stringify(call.env);
      const isObserver = call.args.some((arg) => arg.endsWith('observer-worker.js'));
      expect(env.includes('service-role-test-secret'), `${call.command} ${call.args.join(' ')}`).toBe(isObserver);
      expect(env.includes('db-test-secret')).toBe(isObserver);
    }
    const manifestText = readFileSync(join(config.runDir, 'run-manifest.json'), 'utf8');
    for (const secret of ['service-role-test-secret', 'db-test-secret', 'anon-test-key']) expect(manifestText).not.toContain(secret);
    const manifest = JSON.parse(manifestText);
    expect(manifest).toMatchObject({ runId: '148-steady-warm-secrets', applicationContract: '9f16ae84af7b3959141c042bd049f3e47a6a72d1', seed: config.seed, namespace: config.namespace });
    expect(manifest.harness.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.artifacts.traceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.controlledConfigSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(config.runDir, 'realtime-p0-s0.ndjson'), 'utf8')).toContain('realtime-window');
  });

  it('refuses to overwrite an existing run', async () => {
    const { runCampaign } = await import('../src/campaign.js');
    behaviour = { k6Exit: () => 99, realtimeLines: () => [] };
    const config = setup('twice');
    await runCampaign(config, repoRoot, { plateaus });
    await expect(runCampaign(config, repoRoot, { plateaus })).rejects.toThrow(/already exists/);
  });
});
