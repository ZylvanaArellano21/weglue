import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { WRITE_CONFIRMATION } from '../src/constants.js';
import { testEnv } from './helpers.js';

const UNIVERSITY = '00000000-0000-4000-8000-000000000001';
const statements: string[] = [];
const createdMetadata: Array<Record<string, unknown>> = [];
let failOn: RegExp | undefined;

vi.mock('../src/supabase.js', () => ({
  serviceClient: () => ({
    auth: {
      admin: {
        createUser: async ({ user_metadata }: { user_metadata: Record<string, unknown> }) => {
          createdMetadata.push(user_metadata);
          return { error: null, data: { user: { id: `00000000-0000-4000-8000-${String(createdMetadata.length).padStart(12, '0')}` } } };
        },
      },
    },
  }),
}));

vi.mock('pg', () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (failOn?.test(sql)) throw new Error('forced failure');
      if (sql.includes('from public.universities')) return { rows: [{ id: UNIVERSITY, name: 'Load Test Unit', slug: 'load-test-unit', is_active: true }], rowCount: 1 };
      if (sql.includes('from public.profiles where username')) return { rows: [], rowCount: 0 };
      if (sql.includes('from public.profiles where id = any')) return { rows: [], rowCount: (params[0] as unknown[]).length };
      if (sql.includes('from public.conversations')) return { rows: [{ id: `conv-${String(params[0])}` }], rowCount: 1 };
      if (sql.includes('from public.conversation_channels')) return { rows: [{ id: `chan-${String(params[0])}` }], rowCount: 1 };
      if (sql.includes('clock_timestamp')) return { rows: [{ now: new Date('2026-09-26T00:00:00Z') }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return { default: { Pool: class { connect = async () => client; end = async () => undefined; } } };
});

const { seedSyntheticData } = await import('../src/seed.js');

function config() {
  return loadConfig(testEnv({ LOADTEST_RESULTS_DIR: mkdtempSync(join(tmpdir(), 'weglue-seed-')), LOADTEST_SYNTHETIC_USERS: '5', LOADTEST_REQUESTED_USERS: '5', LOADTEST_CONFIRM_WRITES: WRITE_CONFIRMATION }));
}

describe('fixture seeding', () => {
  beforeEach(() => {
    statements.length = 0;
    createdMetadata.length = 0;
    failOn = undefined;
  });

  it('signs synthetic users up into the Load Test campus through the app signup path', async () => {
    const manifest = await seedSyntheticData(config());
    expect(manifest.users).toHaveLength(5);
    expect(createdMetadata.every((metadata) => metadata.university_slug === 'load-test-unit')).toBe(true);
  });

  it('writes every fixture row inside one transaction, after the Auth users exist', async () => {
    await seedSyntheticData(config());
    const begin = statements.indexOf('begin');
    const writes = statements.map((sql, index) => ({ sql, index })).filter(({ sql }) => /^(insert|update|delete)/i.test(sql));
    expect(begin).toBeGreaterThan(-1);
    expect(writes.length).toBeGreaterThan(10);
    expect(writes.every(({ index }) => index > begin)).toBe(true);
    expect(statements.at(-1)).toBe('commit');
  });

  it('posts seed messages after membership, each under its sender identity', async () => {
    await seedSyntheticData(config());
    const firstMembership = statements.findIndex((sql) => sql.startsWith('insert into public.club_members'));
    const messageInserts = statements.map((sql, index) => ({ sql, index })).filter(({ sql }) => sql.startsWith('insert into public.messages'));
    expect(messageInserts.length).toBe(5);
    expect(messageInserts.every(({ index }) => index > firstMembership && statements[index - 1]!.startsWith('select set_config('))).toBe(true);
  });

  it('rolls the whole fixture back on any failure', async () => {
    failOn = /insert into public\.club_members/;
    await expect(seedSyntheticData(config())).rejects.toThrow(/forced failure/);
    expect(statements.at(-1)).toBe('rollback');
    expect(statements).not.toContain('commit');
  });
});
