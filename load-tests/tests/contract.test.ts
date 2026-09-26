import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { APPLICATION_CONTRACT_COMMIT, MIGRATION_149_FILE, MIGRATION_150_FILE } from '../src/constants.js';
import { assertComparisonMigrations, assertLedgerMatches, buildContract, migrationVersion } from '../src/contract.js';
import { buildJourney, JOURNEY_NAMES } from '../k6/lib/journeys.js';
import { sampleContext } from './fixtures.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gitGrep = (pattern: string, path: string) => {
  try {
    return execFileSync('git', ['grep', '-h', '-i', '-E', pattern, APPLICATION_CONTRACT_COMMIT, '--', path], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return '';
  }
};

describe('148 → 149 experiment contract', () => {
  it('adds only migration 149 and excludes migration 150 in both states', () => {
    assertComparisonMigrations(repoRoot);
    const pre = buildContract('148', repoRoot);
    const post = buildContract('149', repoRoot);
    expect(post.migrations.filter((file) => !pre.migrations.includes(file))).toEqual([MIGRATION_149_FILE]);
    expect(pre.excludedMigrations).toEqual([MIGRATION_149_FILE, MIGRATION_150_FILE]);
    expect(post.excludedMigrations).toEqual([MIGRATION_150_FILE]);
    expect(pre.applicationCommit).toBe(APPLICATION_CONTRACT_COMMIT);
  });

  it('accepts exactly the 001–148 ledger at 148 and the same plus 149 at 149', () => {
    const pre = buildContract('148', repoRoot).migrations.map(migrationVersion);
    expect(pre[pre.length - 1]).toBe('148');
    expect(() => assertLedgerMatches(pre, '148', repoRoot)).not.toThrow();
    expect(() => assertLedgerMatches([...pre, '149'], '149', repoRoot)).not.toThrow();
    expect(() => assertLedgerMatches([...pre, '149'], '148', repoRoot)).toThrow(/ledger mismatch/);
    expect(() => assertLedgerMatches([...pre, '149', '150'], '149', repoRoot)).toThrow(/ledger mismatch/);
    expect(() => assertLedgerMatches([...pre, '150'], '148', repoRoot)).toThrow(/ledger mismatch/);
    expect(() => assertLedgerMatches(pre.slice(1), '148', repoRoot)).toThrow(/ledger mismatch/);
  });

  it('pins the app contract to the Realtime topics and RPCs the harness reproduces', () => {
    const source = gitGrep('sync:block:|sync:message-inbox:|sync:access:|sync:university:|private: true|createSafeChannel\\(.notifications|club-sync', 'apps/mobile');
    for (const needle of ['sync:block:', 'sync:message-inbox:', 'sync:access:', 'sync:university:', 'private: true', 'club-sync']) expect(source).toContain(needle);
  });

  it('references only tables and RPCs that exist in migrations at the contract commit', () => {
    const tables = new Set<string>();
    const rpcs = new Set<string>();
    for (const journey of JOURNEY_NAMES) {
      for (const stage of buildJourney(journey, sampleContext(journey))) {
        for (const call of stage) {
          const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)/.exec(call.path)?.[1];
          if (rpc) rpcs.add(rpc);
          else tables.add(/^\/rest\/v1\/([a-z_]+)/.exec(call.path)![1]!);
        }
      }
    }
    for (const table of tables) expect(gitGrep(`create table (if not exists )?(public\\.)?${table}([^a-z_]|$)`, 'supabase/migrations'), `table ${table}`).not.toBe('');
    for (const rpc of rpcs) expect(gitGrep(`create (or replace )?function (public\\.)?${rpc}\\(`, 'supabase/migrations'), `rpc ${rpc}`).not.toBe('');
  });
});
