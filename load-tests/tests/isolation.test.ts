import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildObserverEnv, buildPublicWorkerEnv } from '../src/campaign.js';
import { RESET_STATEMENTS, resetScope } from '../src/cleanup.js';
import { loadConfig } from '../src/config.js';
import { assertManifestHasNoSecrets } from '../src/manifest.js';
import { seedEventDate, seedMemberRole } from '../src/seed.js';
import { actionMessagePrefix, deterministicUuid, syntheticEmail } from '../src/synthetic.js';
import { actionClientTag, assertAllowedStages, buildJourney, JOURNEY_NAMES } from '../k6/lib/journeys.js';
import { uuidFromSha256Hex } from '../k6/lib/uuid.js';
import { manifestFixture, sampleContext } from './fixtures.js';
import { testEnv } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(testEnv({ LOADTEST_NAMESPACE: 'wg-loadtest-isolation', LOADTEST_REQUESTED_USERS: '20' }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('synthetic identity', () => {
  it('uses deterministic RFC 4122 UUIDs and unmistakable synthetic emails', () => {
    expect(deterministicUuid(config.namespace, 'post', 1)).toBe(deterministicUuid(config.namespace, 'post', 1));
    expect(deterministicUuid(config.namespace, 'post', 1)).toMatch(UUID);
    expect(deterministicUuid(config.namespace, 'post', 1)).not.toBe(deterministicUuid(config.namespace, 'post', 2));
    expect(syntheticEmail(config, 7)).toBe('wg-loadtest-wg-loadtest-isolation-7@loadtest.invalid');
  });

  it('k6 and Node derive the same UUID client_tag (messages.client_tag is uuid)', () => {
    const action = { clientTag: 'wg-loadtest-isolation:1:5' };
    const sha = (input: string) => createHash('sha256').update(input).digest('hex');
    const tag = actionClientTag(sha, uuidFromSha256Hex, config.namespace, action, '0:0');
    expect(tag).toMatch(UUID);
    expect(tag).toBe(deterministicUuid(config.namespace, 'action-tag', `${action.clientTag}:cycle:0:0`));
    expect(actionClientTag(sha, uuidFromSha256Hex, config.namespace, action, '1:0')).not.toBe(tag);
  });

  it('seeds two officers per club, past and future events', () => {
    expect([0, 1, 2].map((index) => seedMemberRole(index, 25))).toEqual(['officer', 'officer', 'member']);
    expect(seedEventDate(0)).toBe('2020-01-01');
    expect(seedEventDate(1)).toBe('2099-01-01');
  });
});

describe('request isolation', () => {
  it('every journey calls only PostgREST, with no push, Edge Function, OTP, email or Storage request', () => {
    for (const journey of JOURNEY_NAMES) {
      const stages = buildJourney(journey, sampleContext(journey));
      expect(stages.length).toBeGreaterThan(0);
      expect(() => assertAllowedStages(journey, stages)).not.toThrow();
      expect(JSON.stringify(stages)).not.toMatch(/push_tokens|send-push|functions\/v1|expo|storage\/v1/i);
    }
    expect(() => assertAllowedStages('x', [[{ method: 'POST', path: '/rest/v1/push_tokens' }]])).toThrow(/Forbidden/);
    expect(() => assertAllowedStages('x', [[{ method: 'POST', path: '/functions/v1/send-push' }]])).toThrow(/Forbidden/);
    expect(() => assertAllowedStages('x', [[{ method: 'POST', path: '/rest/v1/posts', body: {} }]])).toThrow(/Unmarked write/);
  });

  it('message sends carry a UUID tag and the namespace action marker with a send time', () => {
    const [[call]] = buildJourney('message-send', sampleContext('message-send'));
    expect(call.body.client_tag).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.body.content.startsWith(actionMessagePrefix(manifestFixture.namespace))).toBe(true);
    expect(call.body.content).toMatch(/:t:\d{13}$/);
    expect(manifestFixture.conversationIds).toContain(call.body.conversation_id);
    expect(call.body.sender_id).toBe(sampleContext('message-send').session.userId);
  });

  it('communicators only address conversations that contain them', () => {
    for (let userIndex = 0; userIndex < 250; userIndex += 17) {
      const [[call]] = buildJourney('message-send', sampleContext('message-send', userIndex * 3, userIndex));
      const index = manifestFixture.conversationIds.indexOf(call.body.conversation_id);
      expect(userIndex).toBeLessThan(manifestFixture.clubSizes[index]!);
    }
  });
});

describe('credential isolation', () => {
  it('load workers receive no privileged credentials and no inherited LOADTEST/SUPABASE variables', () => {
    const workerEnv = buildPublicWorkerEnv(config, '/tmp/stop', {
      PATH: '/bin',
      LOADTEST_SUPABASE_SERVICE_ROLE_KEY: 'secret-a',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-b',
      LOADTEST_DATABASE_URL: 'secret-c',
      DATABASE_URL: 'secret-d',
      SUPABASE_ACCESS_TOKEN: 'secret-e',
      LOADTEST_CONFIRM_WRITES: 'I_ACKNOWLEDGE_SYNTHETIC_STAGING_WRITES_ONLY',
    });
    const serialized = JSON.stringify(workerEnv);
    for (const secret of ['secret-a', 'secret-b', 'secret-c', 'secret-d', 'secret-e', 'service-role-test-secret', 'db-test-secret']) expect(serialized).not.toContain(secret);
    expect(workerEnv.LOADTEST_CONFIRM_WRITES).toBeUndefined();
    expect(workerEnv.LOADTEST_SUPABASE_ANON_KEY).toBe('anon-test-key');
    expect(workerEnv.PATH).toBe('/bin');
  });

  it('only the observer receives the database URL and service-role key', () => {
    const observerEnv = buildObserverEnv(config, '/tmp/stop', '2026-09-25T00:00:00Z', { PATH: '/bin' });
    expect(observerEnv.LOADTEST_DATABASE_URL).toBe(config.databaseUrl);
    expect(observerEnv.LOADTEST_SUPABASE_SERVICE_ROLE_KEY).toBe(config.serviceRoleKey);
    expect(observerEnv.LOADTEST_SUPABASE_ANON_KEY).toBeUndefined();
  });

  it('k6 and the Realtime worker refuse privileged variables at start-up', () => {
    const k6 = readFileSync(resolve(here, '../k6/main.js'), 'utf8');
    expect(k6).toMatch(/SERVICE_ROLE\|DATABASE_URL/);
    const worker = readFileSync(resolve(here, '../src/realtime-worker.ts'), 'utf8');
    expect(worker).toMatch(/SERVICE_ROLE\|DATABASE_URL/);
  });

  it('refuses to write a run manifest that contains credential material or tokens', () => {
    expect(() => assertManifestHasNoSecrets('{"a":"service-role-test-secret"}', [config.serviceRoleKey])).toThrow(/credential/);
    expect(() => assertManifestHasNoSecrets('{"accessToken":"x"}', [])).toThrow(/token/);
    expect(() => assertManifestHasNoSecrets('{"t":"eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJhYmMifQ.sig"}', [])).toThrow(/token/);
    expect(() => assertManifestHasNoSecrets('{"ok":true}', [config.serviceRoleKey])).not.toThrow();
  });
});

describe('scoped reset and cleanup', () => {
  it('every reset statement is bounded by synthetic users and/or manifest conversations', () => {
    for (const [name, sql] of Object.entries(RESET_STATEMENTS)) {
      expect(sql, name).toMatch(/any\(\$1::uuid\[\]\)|any\(\$2::uuid\[\]\)/);
      if (/^\s*delete/i.test(sql) && !/event_rsvps|saved_events/.test(sql)) expect(sql, name).toMatch(/created_at > \$3::timestamptz/);
    }
    expect(RESET_STATEMENTS.deleteActionMessages).toMatch(/left\(content, length\(\$4\)\) = \$4/);
    expect(RESET_STATEMENTS.deleteActionMessages).toMatch(/sender_id = any\(\$1::uuid\[\]\)/);
  });

  it('derives the reset scope from the manifest watermark', () => {
    const scope = resetScope(manifestFixture, { namespace: manifestFixture.namespace });
    expect(scope.userIds).toHaveLength(250);
    expect(scope.conversationIds).toEqual(manifestFixture.conversationIds);
    expect(scope.seededAt).toBe(manifestFixture.seededAt);
    expect(scope.actionPrefix).toBe('wg-loadtest-contract-test:action:');
  });
});
