import { describe, expect, it } from 'vitest';
import { analyzePlateau, type RunAnalysis } from '../src/analyze.js';
import { compareMetric, compareRuns, EXPECTED_149_DELTA, renderMarkdown, type LoadedRun } from '../src/compare.js';
import type { RunManifest } from '../src/manifest.js';
import { k6Summary, plateauInput, realtimeWindow } from './analysis-fixtures.js';

const LEDGER_148 = Array.from({ length: 148 }, (_, index) => String(index + 1).padStart(3, '0'));
const OBJECTS_148 = { 'function:public.a()': 'h1', 'policy:realtime.messages:p': 'h2', 'trigger:public.t:x': 'h3' };

function run(state: '148' | '149', label: string, overrides: { manifest?: Partial<RunManifest>; p95?: number; blockKind?: 'expected' | 'ok' } = {}): LoadedRun {
  const objects = state === '149' ? { ...OBJECTS_148, [EXPECTED_149_DELTA[0]!]: 'n1', [EXPECTED_149_DELTA[1]!]: 'n2' } : OBJECTS_148;
  const manifest = {
    schemaVersion: 1, kind: 'weglue-loadtest-run', runId: `${state}-steady-warm-${label}`, state, scenario: 'steady', cacheMode: 'warm', runLabel: label,
    status: 'completed', startedAt: '', databaseStartedAt: '', applicationContract: '9f16ae84af7b3959141c042bd049f3e47a6a72d1',
    harness: { gitHead: 'abc', sourceSha256: 'src', sourceFiles: 30 },
    migrations: { migration149Sha256: 'm149', migration150Sha256: 'm150' },
    preflight: {
      checkedAt: '', state, ledgerVersions: state === '149' ? [...LEDGER_148, '149'] : LEDGER_148, ledgerSha256: state,
      fingerprint: { sections: { state }, objects }, markers: {}, pushMode: 'dispatch-disabled', cronJobs: [], universityName: 'Load Test U',
      syntheticPushTokens: 0, otherActiveClientBackends: 0, serverVersion: '17.6',
    },
    artifacts: { traceSha256: 'trace', traceFileSha256: 'tracefile', syntheticManifestSha256: 'seed' },
    seed: 1, namespace: 'wg-loadtest-x', controlledConfig: { stagingRef: 'cwwmuxxqxovhcnnardlj' }, controlledConfigSha256: 'cfg',
    tooling: { node: 'v26', k6: 'k6 v1', supabaseJs: '2.110.0', pg: '8.16.3', platform: 'darwin', hostname: 'runner', cpuCount: 8, cpuModel: 'M' },
    plannedPlateaus: [plateauInput().plateau], plateauRuns: [],
    ...overrides.manifest,
  } as RunManifest;
  const block = overrides.blockKind === 'ok'
    ? realtimeWindow(0, { attempts: 10, subscribed: 10, latenciesMs: Array(10).fill(200) }, 'block')
    : realtimeWindow(0, { attempts: 10, subscribed: 0, expectedUnauthorized: 10, latenciesMs: [] }, 'block');
  const plateau = analyzePlateau(plateauInput({ summary: k6Summary({ p95: overrides.p95 ?? 400 }), realtime: [realtimeWindow(0), block] }));
  const analysis: RunAnalysis = { schemaVersion: 1, runId: manifest.runId, status: 'completed', invalid: false, invalidReasons: [], plateaus: [plateau], safeTestedConcurrency: 10, degradationPoint: null, breakingPoint: null };
  return { dir: `/runs/${manifest.runId}`, manifest, analysis };
}

describe('148 → 149 comparison', () => {
  it('accepts a controlled, replicated comparison and reports paired changes with sample counts', () => {
    const report = compareRuns(
      [run('148', 'r1', { p95: 400 }), run('148', 'r2', { p95: 420 })],
      [run('149', 'r1', { p95: 440, blockKind: 'ok' }), run('149', 'r2', { p95: 462, blockKind: 'ok' })],
    );
    expect(report.problems).toEqual([]);
    expect(report.verdict).toBe('VALID');
    expect(report.pairs).toEqual([{ pre: '148-steady-warm-r1', post: '149-steady-warm-r1' }, { pre: '148-steady-warm-r2', post: '149-steady-warm-r2' }]);
    const p95 = report.plateaus[0]!.metrics.find((metric) => metric.metric === 'interactive p95 ms')!;
    expect(p95.pairedPercentChanges).toEqual([10, 10]);
    expect(p95.ci95).toEqual([10, 10]);
    expect(p95.sampleCounts).toEqual({ pre: [480, 480], post: [480, 480] });
    const blocked = report.plateaus[0]!.metrics.find((metric) => metric.metric === 'sync:block subscribed joins')!;
    expect([blocked.preMean, blocked.postMean]).toEqual([0, 10]);
    expect(report.capacity.pre.safeTestedConcurrency).toBe(10);
    expect(renderMarkdown(report)).toContain('148 → 149 comparison — VALID');
  });

  it('is INCONCLUSIVE with a single replicate per state', () => {
    const report = compareRuns([run('148', 'r1')], [run('149', 'r1', { blockKind: 'ok' })]);
    expect(report.verdict).toBe('INCONCLUSIVE');
    expect(report.capacity.pre.safeTestedConcurrency).toBeNull();
  });

  it.each([
    ['action trace', { artifacts: { traceSha256: 'other', traceFileSha256: 'x', syntheticManifestSha256: 'seed' } }],
    ['random seed', { seed: 2 }],
    ['controlled configuration', { controlledConfigSha256: 'different' }],
    ['cache mode', { cacheMode: 'cold' }],
    ['harness source', { harness: { gitHead: 'abc', sourceSha256: 'changed', sourceFiles: 30 } }],
    ['runner host', { tooling: { node: 'v26', k6: 'k6 v1', supabaseJs: '2.110.0', pg: '8.16.3', platform: 'darwin', hostname: 'other', cpuCount: 8, cpuModel: 'M' } }],
  ] as Array<[string, Partial<RunManifest>]>)('rejects a mismatched %s', (name, manifest) => {
    const report = compareRuns([run('148', 'r1'), run('148', 'r2')], [run('149', 'r1', { blockKind: 'ok' }), run('149', 'r2', { blockKind: 'ok', manifest })]);
    expect(report.verdict).toBe('INVALID');
    expect(report.problems.join(' ')).toContain(name);
  });

  it('rejects any environment delta other than exactly migration 149', () => {
    const extra = run('149', 'r1', { blockKind: 'ok' });
    extra.manifest.preflight.fingerprint.objects['trigger:public.notifications:trg_notifications_dispatch_insert'] = 'x';
    expect(compareRuns([run('148', 'r1')], [extra]).problems.join(' ')).toMatch(/Unexpected schema additions/);

    const changed = run('149', 'r1', { blockKind: 'ok' });
    changed.manifest.preflight.fingerprint.objects['function:public.a()'] = 'different';
    expect(compareRuns([run('148', 'r1')], [changed]).problems.join(' ')).toMatch(/changed between 148 and 149: function:public.a\(\)/);

    const with150 = run('149', 'r1', { blockKind: 'ok' });
    with150.manifest.preflight.ledgerVersions = [...with150.manifest.preflight.ledgerVersions, '150'];
    const problems = compareRuns([run('148', 'r1')], [with150]).problems.join(' ');
    expect(problems).toMatch(/not exactly the 148 ledger plus migration 149/);
    expect(problems).toMatch(/Migration 150 is present/);
  });

  it('rejects swapped states, unfinished and invalid runs, and replicate environment drift', () => {
    expect(compareRuns([run('149', 'r1')], [run('149', 'r2')]).problems.join(' ')).toMatch(/is not a 148 run/);
    const interrupted = run('148', 'r1', { manifest: { status: 'interrupted' } });
    expect(compareRuns([interrupted], [run('149', 'r1')]).problems.join(' ')).toMatch(/did not finish cleanly/);
    const invalid = run('148', 'r1');
    invalid.analysis.invalid = true;
    invalid.analysis.invalidReasons = ['generator CPU >= 85%'];
    expect(compareRuns([invalid], [run('149', 'r1')]).problems.join(' ')).toMatch(/is invalid/);
    const drift = run('148', 'r2');
    drift.manifest.preflight.fingerprint.sections = { state: 'drifted' };
    expect(compareRuns([run('148', 'r1'), drift], [run('149', 'r1')]).problems.join(' ')).toMatch(/fingerprint differs between replicates/);
  });

  it('computes percent changes and t-based confidence intervals', () => {
    const metric = compareMetric('m', [100, 200], [110, 260], { pre: [5, 5], post: [5, 5] });
    expect(metric.percentChange).toBeCloseTo(23.333, 2);
    expect(metric.pairedPercentChanges).toEqual([10, 30]);
    expect(metric.pairedMeanPercentChange).toBe(20);
    expect(metric.ci95![0]).toBeCloseTo(20 - 12.706 * 10, 3);
    expect(compareMetric('z', [0], [0], { pre: [1], post: [1] }).percentChange).toBe(0);
    expect(compareMetric('z', [0], [5], { pre: [1], post: [1] }).percentChange).toBeNull();
  });
});
