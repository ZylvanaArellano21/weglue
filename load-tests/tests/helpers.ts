import { KNOWN_STAGING_PROJECT_REF } from '../src/constants.js';

export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    LOADTEST_SUPABASE_URL: `https://${KNOWN_STAGING_PROJECT_REF}.supabase.co`,
    LOADTEST_STAGING_REF: KNOWN_STAGING_PROJECT_REF,
    LOADTEST_SUPABASE_ANON_KEY: 'anon-test-key',
    LOADTEST_SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-secret',
    LOADTEST_DATABASE_URL: `postgres://postgres.${KNOWN_STAGING_PROJECT_REF}:db-test-secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
    LOADTEST_UNIVERSITY_ID: '00000000-0000-4000-8000-000000000001',
    LOADTEST_EMAIL_DOMAIN: 'loadtest.invalid',
    LOADTEST_NAMESPACE: 'wg-loadtest-contract-test',
    LOADTEST_EXPECTED_STATE: '148',
    LOADTEST_VERIFIED_REALTIME_LIMIT: '200',
    LOADTEST_VERIFIED_JOINS_PER_SECOND_LIMIT: '100',
    LOADTEST_VERIFIED_TOKEN_REFRESH_LIMIT: '150',
    LOADTEST_REQUESTED_USERS: '150',
    LOADTEST_CACHE_MODE: 'warm',
    LOADTEST_RUN_LABEL: 'r1',
    LOADTEST_EDGE_FUNCTION_INVENTORY: 'none',
    LOADTEST_RESULTS_DIR: '/tmp/weglue-loadtest-unit',
    ...overrides,
  };
}
