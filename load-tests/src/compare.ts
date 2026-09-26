import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeRun, type PlateauResult, type RunAnalysis } from './analyze.js';
import { MIGRATION_149_MARKERS } from './preflight.js';
import type { RunManifest } from './manifest.js';

export type LoadedRun = { dir: string; manifest: RunManifest; analysis: RunAnalysis };

export function loadRun(dir: string): LoadedRun {
  const manifestPath = resolve(dir, 'run-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`No run-manifest.json in ${dir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
  const analysisPath = resolve(dir, 'analysis.json');
  const analysis = existsSync(analysisPath) ? (JSON.parse(readFileSync(analysisPath, 'utf8')) as RunAnalysis) : analyzeRun(dir);
  return { dir, manifest, analysis };
}

// Variables that must be identical across every compared run (both states).
export const CONTROLLED_VARIABLES: ReadonlyArray<{ name: string; get: (run: RunManifest) => unknown }> = Object.freeze([
  { name: 'applicationContract', get: (run) => run.applicationContract },
  { name: 'harness source', get: (run) => run.harness.sourceSha256 },
  { name: 'migration 149 artifact', get: (run) => run.migrations.migration149Sha256 },
  { name: 'migration 150 artifact', get: (run) => run.migrations.migration150Sha256 },
  { name: 'action trace', get: (run) => run.artifacts.traceSha256 },
  { name: 'synthetic manifest', get: (run) => run.artifacts.syntheticManifestSha256 },
  { name: 'random seed', get: (run) => run.seed },
  { name: 'namespace', get: (run) => run.namespace },
  { name: 'controlled configuration', get: (run) => run.controlledConfigSha256 },
  { name: 'scenario', get: (run) => run.scenario },
  { name: 'cache mode', get: (run) => run.cacheMode },
  { name: 'plateau schedule', get: (run) => JSON.stringify(run.plannedPlateaus) },
  { name: 'staging project', get: (run) => run.controlledConfig.stagingRef },
  { name: 'push mode', get: (run) => run.preflight.pushMode },
  { name: 'k6 version', get: (run) => run.tooling.k6 },
  { name: 'supabase-js version', get: (run) => run.tooling.supabaseJs },
  { name: 'Node.js version', get: (run) => run.tooling.node },
  { name: 'runner host', get: (run) => `${run.tooling.hostname}|${run.tooling.cpuModel}|${run.tooling.cpuCount}` },
  { name: 'database server version', get: (run) => run.preflight.serverVersion },
]);

export const EXPECTED_149_DELTA = Object.freeze([
  `function:${MIGRATION_149_MARKERS.function}`,
  `policy:${MIGRATION_149_MARKERS.policy}`,
]);

export type Compatibility = { compatible: boolean; problems: string[] };

/** Every reason the requested comparison is not a valid 148 → 149 experiment. */
export function checkCompatibility(pre: LoadedRun[], post: LoadedRun[]): Compatibility {
  const problems: string[] = [];
  if (pre.length === 0 || post.length === 0) problems.push('At least one 148 run and one 149 run are required');
  for (const run of pre) if (run.manifest.state !== '148') problems.push(`${run.manifest.runId} is not a 148 run`);
  for (const run of post) if (run.manifest.state !== '149') problems.push(`${run.manifest.runId} is not a 149 run`);
  const all = [...pre, ...post];
  for (const run of all) {
    if (run.manifest.status === 'running' || run.manifest.status === 'error' || run.manifest.status === 'interrupted' || run.manifest.status === 'environment-not-ready') problems.push(`${run.manifest.runId} did not finish cleanly (${run.manifest.status})`);
    if (run.analysis.invalid) problems.push(`${run.manifest.runId} is invalid: ${run.analysis.invalidReasons.join('; ')}`);
  }
  const reference = all[0]?.manifest;
  if (reference) {
    for (const variable of CONTROLLED_VARIABLES) {
      const expected = JSON.stringify(variable.get(reference));
      for (const run of all.slice(1)) {
        if (JSON.stringify(variable.get(run.manifest)) !== expected) problems.push(`Controlled variable differs: ${variable.name} (${reference.runId} vs ${run.manifest.runId})`);
      }
    }
  }
  // Replicates within one state must see an identical environment.
  for (const group of [pre, post]) {
    const first = group[0]?.manifest;
    for (const run of group.slice(1)) {
      if (first && run.manifest.preflight.ledgerSha256 !== first.preflight.ledgerSha256) problems.push(`Ledger differs between replicates ${first.runId} and ${run.manifest.runId}`);
      if (first && JSON.stringify(run.manifest.preflight.fingerprint.sections) !== JSON.stringify(first.preflight.fingerprint.sections)) problems.push(`Schema/function/config fingerprint differs between replicates ${first.runId} and ${run.manifest.runId}`);
    }
  }
  // Across states: the ledger gains exactly 149 and the schema gains exactly 149's objects.
  const pre0 = pre[0]?.manifest;
  const post0 = post[0]?.manifest;
  if (pre0 && post0) {
    const expectedLedger = [...pre0.preflight.ledgerVersions, '149'].sort().join(',');
    if ([...post0.preflight.ledgerVersions].sort().join(',') !== expectedLedger) problems.push('149 ledger is not exactly the 148 ledger plus migration 149');
    if (post0.preflight.ledgerVersions.includes('150') || pre0.preflight.ledgerVersions.includes('150')) problems.push('Migration 150 is present in a compared ledger');
    const before = pre0.preflight.fingerprint.objects;
    const after = post0.preflight.fingerprint.objects;
    const added = Object.keys(after).filter((key) => !(key in before)).sort();
    const removed = Object.keys(before).filter((key) => !(key in after)).sort();
    const changed = Object.keys(before).filter((key) => key in after && before[key] !== after[key]).sort();
    if (JSON.stringify(added) !== JSON.stringify([...EXPECTED_149_DELTA].sort())) problems.push(`Unexpected schema additions between 148 and 149: ${added.join(', ') || '(none)'}`);
    if (removed.length > 0) problems.push(`Schema objects removed between 148 and 149: ${removed.join(', ')}`);
    if (changed.length > 0) problems.push(`Schema objects changed between 148 and 149: ${changed.join(', ')}`);
  }
  return { compatible: problems.length === 0, problems };
}

const T_975: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228 };

export type MetricComparison = {
  metric: string;
  pre: Array<number | null>;
  post: Array<number | null>;
  preMean: number | null;
  postMean: number | null;
  percentChange: number | null;
  pairedPercentChanges: Array<number | null>;
  pairedMeanPercentChange: number | null;
  ci95: [number, number] | null;
  sampleCounts: { pre: number[]; post: number[] };
};

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  if (before === 0) return after === 0 ? 0 : null;
  return ((after - before) / Math.abs(before)) * 100;
}

export function compareMetric(metric: string, pre: Array<number | null>, post: Array<number | null>, counts: { pre: number[]; post: number[] }): MetricComparison {
  const preValues = pre.filter((value): value is number => value !== null);
  const postValues = post.filter((value): value is number => value !== null);
  const pairs = Math.min(pre.length, post.length);
  const paired = Array.from({ length: pairs }, (_, index) => pct(pre[index] ?? null, post[index] ?? null));
  const pairedValues = paired.filter((value): value is number => value !== null);
  const pairedMean = mean(pairedValues);
  let ci95: [number, number] | null = null;
  if (pairedValues.length >= 2 && pairedMean !== null) {
    const variance = pairedValues.reduce((total, value) => total + (value - pairedMean) ** 2, 0) / (pairedValues.length - 1);
    const t = T_975[pairedValues.length - 1] ?? 1.96;
    const margin = t * Math.sqrt(variance / pairedValues.length);
    ci95 = [pairedMean - margin, pairedMean + margin];
  }
  const preMean = mean(preValues);
  const postMean = mean(postValues);
  return { metric, pre, post, preMean, postMean, percentChange: pct(preMean, postMean), pairedPercentChanges: paired, pairedMeanPercentChange: pairedMean, ci95, sampleCounts: counts };
}

type Extractor = { metric: string; value: (plateau: PlateauResult) => number | undefined; count: (plateau: PlateauResult) => number };

export const PLATEAU_METRICS: Extractor[] = [
  { metric: 'interactive p50 ms', value: (p) => p.http?.interactive.p50, count: (p) => p.http?.interactive.count ?? 0 },
  { metric: 'interactive p95 ms', value: (p) => p.http?.interactive.p95, count: (p) => p.http?.interactive.count ?? 0 },
  { metric: 'interactive p99 ms', value: (p) => p.http?.interactive.p99, count: (p) => p.http?.interactive.count ?? 0 },
  { metric: 'cold launch p95 ms', value: (p) => p.http?.launch.p95, count: (p) => p.http?.launch.count ?? 0 },
  { metric: 'request error rate', value: (p) => p.http?.errorRate, count: (p) => p.http?.requests ?? 0 },
  { metric: 'timeout rate', value: (p) => p.http?.timeoutRate, count: (p) => p.http?.requests ?? 0 },
  { metric: 'requests per second', value: (p) => p.http?.requestsPerSecond, count: (p) => p.http?.requests ?? 0 },
  { metric: 'Realtime join p95 ms', value: (p) => p.realtime.join.p95, count: (p) => p.realtime.join.count },
  { metric: 'Realtime valid join failure rate', value: (p) => p.realtime.validFailureRate, count: (p) => p.realtime.attempts - p.realtime.expectedUnauthorized },
  { metric: 'sync:block subscribed joins', value: (p) => p.realtime.byKind.block?.subscribed ?? 0, count: (p) => p.realtime.byKind.block?.attempts ?? 0 },
  { metric: 'sync:block expected-unauthorized joins', value: (p) => p.realtime.byKind.block?.expectedUnauthorized ?? 0, count: (p) => p.realtime.byKind.block?.attempts ?? 0 },
  { metric: 'sync:block join p95 ms', value: (p) => (p.realtime.byKind.block?.join.count ? p.realtime.byKind.block.join.p95 : undefined), count: (p) => p.realtime.byKind.block?.join.count ?? 0 },
  { metric: 'full resubscription p95 ms', value: (p) => (p.realtime.resubscribe.count ? p.realtime.resubscribe.p95 : undefined), count: (p) => p.realtime.resubscribe.count },
  { metric: 'Realtime delivery latency p95 ms', value: (p) => (p.realtime.deliveryLatency.count ? p.realtime.deliveryLatency.p95 : undefined), count: (p) => p.realtime.deliveryLatency.count },
  { metric: 'database peak connection ratio', value: (p) => p.database.peakConnectionRatio, count: (p) => p.database.samples },
  { metric: 'database mean CPU ratio', value: (p) => p.database.meanCpuRatio, count: (p) => p.database.samples },
  { metric: 'database peak CPU ratio', value: (p) => p.database.peakCpuRatio, count: (p) => p.database.samples },
  { metric: 'database commits per second', value: (p) => p.database.commitsPerSecond, count: (p) => p.database.samples },
  { metric: 'notifications generated', value: (p) => p.database.notificationsGenerated, count: (p) => p.database.samples },
  { metric: 'peak pending push queue', value: (p) => p.database.peakPushPending, count: (p) => p.database.samples },
];

function journeyExtractors(runs: LoadedRun[]): Extractor[] {
  const journeys = new Set<string>();
  for (const run of runs) for (const plateau of run.analysis.plateaus) for (const journey of Object.keys(plateau.http?.journeys ?? {})) journeys.add(journey);
  return [...journeys].sort().map((journey) => ({
    metric: `journey ${journey} p95 ms`,
    value: (plateau: PlateauResult) => plateau.http?.journeys[journey]?.p95,
    count: (plateau: PlateauResult) => plateau.http?.journeys[journey]?.count ?? 0,
  }));
}

export type CapacityVerdict = { safeTestedConcurrency: number | null; degradationPoint: number | null; breakingPoint: number | null; replicatesAgree: boolean };

/** Safe = safe in EVERY replicate; degradation/breaking = earliest across replicates. */
export function stateCapacity(runs: LoadedRun[]): CapacityVerdict {
  const levels = [...new Set(runs.flatMap((run) => run.analysis.plateaus.map((plateau) => plateau.users)))].sort((a, b) => a - b);
  let safe: number | null = null;
  for (const users of levels) {
    const allSafe = runs.every((run) => run.analysis.plateaus.find((plateau) => plateau.users === users)?.classification === 'safe');
    if (!allSafe) break;
    safe = users;
  }
  const earliest = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value !== null);
    return present.length ? Math.min(...present) : null;
  };
  const safes = runs.map((run) => run.analysis.safeTestedConcurrency);
  return {
    safeTestedConcurrency: runs.length >= 2 ? safe : null,
    degradationPoint: earliest(runs.map((run) => run.analysis.degradationPoint)),
    breakingPoint: earliest(runs.map((run) => run.analysis.breakingPoint)),
    replicatesAgree: new Set(safes).size <= 1,
  };
}

export type ComparisonReport = {
  schemaVersion: 1;
  generatedAt: string;
  verdict: 'VALID' | 'INVALID' | 'INCONCLUSIVE';
  problems: string[];
  notes: string[];
  pairs: Array<{ pre: string; post: string }>;
  capacity: { pre: CapacityVerdict; post: CapacityVerdict };
  plateaus: Array<{ users: number; classifications: { pre: string[]; post: string[] }; metrics: MetricComparison[] }>;
};

export function compareRuns(pre: LoadedRun[], post: LoadedRun[]): ComparisonReport {
  const compatibility = checkCompatibility(pre, post);
  const sortRuns = (runs: LoadedRun[]) => [...runs].sort((a, b) => a.manifest.runLabel.localeCompare(b.manifest.runLabel));
  const preRuns = sortRuns(pre);
  const postRuns = sortRuns(post);
  const notes: string[] = [];
  if (preRuns.length < 2 || postRuns.length < 2) notes.push('Fewer than two replicates per state: safe tested concurrency is not established and no confidence interval is reported.');
  if (preRuns.length !== postRuns.length) notes.push('Unequal replicate counts: only the first min(n) runs are paired.');
  if ([...preRuns, ...postRuns].some((run) => !run.analysis.plateaus.some((plateau) => plateau.database.metricsApiAvailable))) {
    notes.push('Supabase Metrics API data is missing for at least one run; CPU/memory/IOPS conclusions rely on the operator dashboard record.');
  }
  const levels = [...new Set([...preRuns, ...postRuns].flatMap((run) => run.analysis.plateaus.map((plateau) => plateau.users)))].sort((a, b) => a - b);
  const extractors = [...PLATEAU_METRICS, ...journeyExtractors([...preRuns, ...postRuns])];
  const plateaus = levels.map((users) => {
    const find = (run: LoadedRun) => run.analysis.plateaus.find((plateau) => plateau.users === users);
    const metrics = extractors.map((extractor) => {
      const read = (runs: LoadedRun[]) => runs.map((run) => {
        const plateau = find(run);
        return plateau && plateau.status !== 'not-run' ? (extractor.value(plateau) ?? null) : null;
      });
      const counts = (runs: LoadedRun[]) => runs.map((run) => {
        const plateau = find(run);
        return plateau ? extractor.count(plateau) : 0;
      });
      return compareMetric(extractor.metric, read(preRuns), read(postRuns), { pre: counts(preRuns), post: counts(postRuns) });
    });
    return {
      users,
      classifications: { pre: preRuns.map((run) => find(run)?.classification ?? 'not-run'), post: postRuns.map((run) => find(run)?.classification ?? 'not-run') },
      metrics,
    };
  });
  const verdict = !compatibility.compatible ? 'INVALID' : preRuns.length < 2 || postRuns.length < 2 ? 'INCONCLUSIVE' : 'VALID';
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    problems: compatibility.problems,
    notes,
    pairs: Array.from({ length: Math.min(preRuns.length, postRuns.length) }, (_, index) => ({ pre: preRuns[index]!.manifest.runId, post: postRuns[index]!.manifest.runId })),
    capacity: { pre: stateCapacity(preRuns), post: stateCapacity(postRuns) },
    plateaus,
  };
}

/** Markdown rendering of the key rows for human review. */
export function renderMarkdown(report: ComparisonReport): string {
  const lines = [`# 148 → 149 comparison — ${report.verdict}`, ''];
  if (report.problems.length) lines.push('## Invalidating problems', '', ...report.problems.map((problem) => `- ${problem}`), '');
  if (report.notes.length) lines.push('## Notes', '', ...report.notes.map((note) => `- ${note}`), '');
  lines.push('## Capacity', '', '| State | Safe tested concurrency | Degradation point | Breaking point | Replicates agree |', '|---|---|---|---|---|');
  for (const [state, value] of [['148', report.capacity.pre], ['149', report.capacity.post]] as const) {
    lines.push(`| ${state} | ${value.safeTestedConcurrency ?? '—'} | ${value.degradationPoint ?? '—'} | ${value.breakingPoint ?? '—'} | ${value.replicatesAgree ? 'yes' : 'no'} |`);
  }
  lines.push('', `Pairs: ${report.pairs.map((pair) => `${pair.pre} ↔ ${pair.post}`).join(', ') || '(none)'}`, '');
  const fmt = (value: number | null) => (value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(3));
  for (const plateau of report.plateaus) {
    lines.push(`## ${plateau.users} users (148: ${plateau.classifications.pre.join('/')}; 149: ${plateau.classifications.post.join('/')})`, '', '| Metric | 148 mean | 149 mean | Δ% | Paired Δ% (95% CI) | Samples 148 / 149 |', '|---|---|---|---|---|---|');
    for (const metric of plateau.metrics) {
      const ci = metric.ci95 ? ` (${metric.ci95[0].toFixed(1)} … ${metric.ci95[1].toFixed(1)})` : '';
      lines.push(`| ${metric.metric} | ${fmt(metric.preMean)} | ${fmt(metric.postMean)} | ${fmt(metric.percentChange)} | ${fmt(metric.pairedMeanPercentChange)}${ci} | ${metric.sampleCounts.pre.join(',')} / ${metric.sampleCounts.post.join(',')} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
