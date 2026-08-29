import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadTestConfig } from './config.js';
import type { Metrics } from './metrics.js';
import type { ObservationRun } from './observability.js';

export type RunResult = {
  schemaVersion: 1;
  scenario: string;
  startedAt: string;
  endedAt: string;
  config: { supabaseUrl: string; universityId: string; seedNamespace: string };
  metrics: { samples: Metrics['samples']; counters: Record<string, number>; tables: Record<string, ReturnType<Metrics['table']>>; errors: Record<string, number> };
  observations: ObservationRun;
  details: Record<string, unknown>;
};

export function writeResult(config: LoadTestConfig, result: RunResult): string {
  mkdirSync(config.resultsDir, { recursive: true });
  const safeName = result.scenario.replace(/[^a-z0-9_-]+/gi, '-');
  const stamp = result.startedAt.replace(/[:.]/g, '-');
  const file = join(config.resultsDir, `${stamp}-${safeName}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return file;
}

export function finalizeResult(
  config: LoadTestConfig,
  scenario: string,
  startedAt: string,
  metrics: Metrics,
  observations: ObservationRun,
  details: Record<string, unknown> = {},
): string {
  const names = [...new Set(metrics.samples.map((sample) => sample.name))];
  const result: RunResult = {
    schemaVersion: 1,
    scenario,
    startedAt,
    endedAt: new Date().toISOString(),
    config: { supabaseUrl: config.supabaseUrl, universityId: config.universityId, seedNamespace: config.seedNamespace },
    metrics: {
      samples: metrics.samples,
      counters: Object.fromEntries(metrics.counters),
      tables: Object.fromEntries(names.map((name) => [name, metrics.table(name)])),
      errors: metrics.errorClasses(),
    },
    observations,
    details,
  };
  return writeResult(config, result);
}
