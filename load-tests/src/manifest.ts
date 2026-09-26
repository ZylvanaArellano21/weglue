import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { cpus, hostname, platform, release } from 'node:os';
import { resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { APPLICATION_CONTRACT_COMMIT, MIGRATION_149_FILE, MIGRATION_150_FILE } from './constants.js';
import { controlledConfig } from './config.js';
import { sha256File } from './contract.js';
import type { PreflightReport } from './preflight.js';
import type { WarmupResult } from './realtime-warmup.js';
import type { LoadTestConfig, Plateau } from './types.js';

export type RunManifest = {
  schemaVersion: 1;
  kind: 'weglue-loadtest-run';
  runId: string;
  state: LoadTestConfig['state'];
  scenario: LoadTestConfig['scenario'];
  cacheMode: LoadTestConfig['cacheMode'];
  runLabel: string;
  status: 'running' | 'completed' | 'degraded-stop' | 'hard-stop' | 'environment-not-ready' | 'error' | 'interrupted';
  stopReason?: string;
  startedAt: string;
  databaseStartedAt: string;
  endedAt?: string;
  applicationContract: string;
  harness: { gitHead: string; sourceSha256: string; sourceFiles: number };
  migrations: { migration149Sha256: string; migration150Sha256: string };
  preflight: PreflightReport;
  artifacts: { traceSha256: string; traceFileSha256: string; syntheticManifestSha256: string };
  seed: number;
  namespace: string;
  controlledConfig: Record<string, string | number | undefined>;
  controlledConfigSha256: string;
  tooling: { node: string; k6: string; supabaseJs: string; pg: string; platform: string; hostname: string; cpuCount: number; cpuModel: string };
  plannedPlateaus: Plateau[];
  // Realtime readiness gate results, in order (before the idle baseline and each plateau).
  warmups?: WarmupResult[];
  plateauRuns: Array<{ index: number; users: number; startedAt: string; loadEndedAt?: string; cooldownEndedAt?: string; sessionsRefreshed: number; exits: Record<string, number | null> }>;
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function listFiles(root: string, dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return listFiles(root, path);
    return [relative(root, path)];
  });
}

/** Hash of every harness source file that shapes the workload (not dist/ or results/). */
export function harnessSourceHash(loadTestsRoot: string): { sha256: string; files: number } {
  const files = ['src', 'k6'].flatMap((dir) => listFiles(loadTestsRoot, resolve(loadTestsRoot, dir))).concat(['package.json']).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file}\0`).update(readFileSync(resolve(loadTestsRoot, file))).update('\0');
  return { sha256: hash.digest('hex'), files: files.length };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function packageVersion(name: string, from: string): string {
  try {
    const require = createRequire(resolve(from, 'package.json'));
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

export function k6Version(): string {
  try {
    return execFileSync('k6', ['version'], { encoding: 'utf8' }).trim().split('\n')[0] ?? 'unknown';
  } catch {
    return 'not-installed';
  }
}

export function buildRunManifest(input: {
  config: LoadTestConfig;
  repoRoot: string;
  preflight: PreflightReport;
  traceSha256: string;
  plateaus: Plateau[];
  databaseStartedAt: string;
}): RunManifest {
  const { config, repoRoot } = input;
  const loadTestsRoot = resolve(repoRoot, 'load-tests');
  const harness = harnessSourceHash(loadTestsRoot);
  const controlled = controlledConfig(config);
  return {
    schemaVersion: 1,
    kind: 'weglue-loadtest-run',
    runId: `${config.state}-${config.scenario}-${config.cacheMode}-${config.runLabel}`,
    state: config.state,
    scenario: config.scenario,
    cacheMode: config.cacheMode,
    runLabel: config.runLabel,
    status: 'running',
    startedAt: new Date().toISOString(),
    databaseStartedAt: input.databaseStartedAt,
    applicationContract: APPLICATION_CONTRACT_COMMIT,
    harness: {
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      sourceSha256: harness.sha256,
      sourceFiles: harness.files,
    },
    migrations: {
      migration149Sha256: sha256File(resolve(repoRoot, 'supabase/migrations', MIGRATION_149_FILE)),
      migration150Sha256: sha256File(resolve(repoRoot, 'supabase/migrations', MIGRATION_150_FILE)),
    },
    preflight: input.preflight,
    artifacts: {
      traceSha256: input.traceSha256,
      traceFileSha256: sha256File(config.traceFile),
      syntheticManifestSha256: sha256File(config.manifestFile),
    },
    seed: config.seed,
    namespace: config.namespace,
    controlledConfig: controlled,
    controlledConfigSha256: sha256(stableStringify(controlled)),
    tooling: {
      node: process.version,
      k6: k6Version(),
      supabaseJs: packageVersion('@supabase/supabase-js', loadTestsRoot),
      pg: packageVersion('pg', loadTestsRoot),
      platform: `${platform()} ${release()}`,
      hostname: hostname(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? 'unknown',
    },
    plannedPlateaus: input.plateaus,
    plateauRuns: [],
  };
}

/** Defence in depth: a manifest must never contain credential material. */
export function assertManifestHasNoSecrets(serialized: string, secrets: Array<string | undefined>): void {
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && serialized.includes(secret)) throw new Error('Refusing to write a run manifest that contains credential material');
  }
  if (/"(access|refresh)_?token"\s*:/i.test(serialized) || /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\./.test(serialized)) {
    throw new Error('Refusing to write a run manifest that contains a token');
  }
}
