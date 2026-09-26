import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  APPLICATION_CONTRACT_COMMIT,
  MIGRATION_149_FILE,
  MIGRATION_149_SHA256,
  MIGRATION_150_FILE,
  MIGRATION_150_SHA256,
} from './constants.js';
import type { ExperimentState } from './types.js';

export type ExperimentContract = {
  applicationCommit: string;
  state: ExperimentState;
  migrations: string[];
  excludedMigrations: string[];
};

export function migrationFilesAtContract(repoRoot = process.cwd()): string[] {
  const output = execFileSync('git', ['ls-tree', '-r', '--name-only', APPLICATION_CONTRACT_COMMIT, 'supabase/migrations'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean).map((path) => path.replace('supabase/migrations/', ''));
}

export function migrationVersion(file: string): string {
  const match = /^(\d{3})_/.exec(file);
  if (!match?.[1]) throw new Error(`Invalid migration filename: ${file}`);
  return match[1];
}

export function buildContract(state: ExperimentState, repoRoot = process.cwd()): ExperimentContract {
  const pre = migrationFilesAtContract(repoRoot).filter((file) => Number(migrationVersion(file)) <= 148);
  if (!pre.some((file) => file.startsWith('148_'))) throw new Error('Contract commit does not contain migration 148');
  if (pre.some((file) => Number(migrationVersion(file)) > 148)) throw new Error('Pre-state unexpectedly contains migration >148');
  return {
    applicationCommit: APPLICATION_CONTRACT_COMMIT,
    state,
    migrations: state === '149' ? [...pre, MIGRATION_149_FILE] : pre,
    excludedMigrations: state === '149' ? [MIGRATION_150_FILE] : [MIGRATION_149_FILE, MIGRATION_150_FILE],
  };
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function assertComparisonMigrations(repoRoot = process.cwd()): void {
  const migrationRoot = resolve(repoRoot, 'supabase/migrations');
  if (sha256File(resolve(migrationRoot, MIGRATION_149_FILE)) !== MIGRATION_149_SHA256) {
    throw new Error('Migration 149 content does not match the approved comparison artifact');
  }
  if (sha256File(resolve(migrationRoot, MIGRATION_150_FILE)) !== MIGRATION_150_SHA256) {
    throw new Error('Migration 150 content changed; exclusion guard must be reviewed');
  }
  const pre = buildContract('148', repoRoot);
  const post = buildContract('149', repoRoot);
  const added = post.migrations.filter((migration) => !pre.migrations.includes(migration));
  if (added.length !== 1 || added[0] !== MIGRATION_149_FILE) {
    throw new Error(`Invalid 148→149 comparison delta: ${added.join(', ')}`);
  }
}

export function assertLedgerMatches(actualVersions: string[], state: ExperimentState, repoRoot = process.cwd()): void {
  const expected = buildContract(state, repoRoot).migrations.map(migrationVersion).sort();
  const actual = [...new Set(actualVersions.map((version) => version.padStart(3, '0')))].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Migration ledger mismatch for state ${state}. Expected ${expected.join(',')}; received ${actual.join(',')}`);
  }
}
