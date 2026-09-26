import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { KNOWN_STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF } from './constants.js';
import { assertComparisonMigrations, assertLedgerMatches } from './contract.js';
import { readManifest } from './synthetic.js';
import type { ExperimentState, LoadTestConfig } from './types.js';

export type PushMode = 'dispatch-disabled' | 'staging-dispatch';

export type SchemaFingerprint = {
  sections: Record<string, string>;
  objects: Record<string, string>;
};

export type PreflightReport = {
  checkedAt: string;
  state: ExperimentState;
  ledgerVersions: string[];
  ledgerSha256: string;
  fingerprint: SchemaFingerprint;
  markers: Record<string, boolean>;
  pushMode: PushMode;
  cronJobs: Array<{ jobname: string; schedule: string; active: boolean }>;
  universityName: string;
  syntheticPushTokens: number;
  otherActiveClientBackends: number;
  serverVersion: string;
};

// Objects that exist only after migration 149 / migration 150.
export const MIGRATION_149_MARKERS = Object.freeze({
  function: 'private.can_receive_block_sync(p_topic text)',
  policy: 'realtime.messages:weglue_receive_block_sync',
});
export const MIGRATION_150_MARKERS = Object.freeze({
  insertTrigger: 'public.notifications:trg_notifications_dispatch_insert',
  updateTrigger: 'public.notifications:trg_notifications_dispatch_update',
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jwtRef(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { ref?: string };
    return payload.ref;
  } catch {
    return undefined;
  }
}

/** 148 must have neither marker set; 149 must have exactly migration 149's objects; 150 is never allowed. */
export function assertMigrationMarkers(markers: Record<string, boolean>, state: ExperimentState): void {
  if (markers.migration150InsertTrigger || markers.migration150UpdateTrigger) {
    throw new Error('REFUSING: migration 150 objects are present although the ledger excludes 150');
  }
  const has149 = markers.migration149Function && markers.migration149Policy;
  const hasAny149 = markers.migration149Function || markers.migration149Policy;
  if (state === '148' && hasAny149) throw new Error('REFUSING: migration 149 objects are present in the 148 environment');
  if (state === '149' && !has149) throw new Error('REFUSING: migration 149 objects are missing from the 149 environment');
}

/** Push dispatch may be disabled or point at the staging project; production is refused. */
export function classifyPushDispatch(dispatchUrl: string | null): PushMode {
  if (!dispatchUrl) return 'dispatch-disabled';
  const lower = dispatchUrl.toLowerCase();
  if (lower.includes(PRODUCTION_PROJECT_REF)) throw new Error('REFUSING: staging push.dispatch_url targets the PRODUCTION project');
  if (!lower.includes(`${KNOWN_STAGING_PROJECT_REF}.supabase.co`)) throw new Error('REFUSING: staging push.dispatch_url does not target the allowlisted staging project');
  return 'staging-dispatch';
}

/** Active cron jobs must not call production or any non-staging Supabase project. */
export function assertCronIsolation(jobs: Array<{ jobname: string; command: string; active: boolean }>): void {
  for (const job of jobs) {
    if (!job.active) continue;
    const lower = job.command.toLowerCase();
    if (lower.includes(PRODUCTION_PROJECT_REF)) throw new Error(`REFUSING: active cron job ${job.jobname} calls the PRODUCTION project; disable it on staging first`);
    const refs = [...lower.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)].map((match) => match[1]);
    const foreign = refs.find((ref) => ref !== KNOWN_STAGING_PROJECT_REF);
    if (foreign) throw new Error(`REFUSING: active cron job ${job.jobname} calls non-staging project ${foreign}`);
  }
}

/**
 * pg_cron's scheduler keeps its own cache of jobs. If cron.job is rebuilt
 * underneath a running scheduler (for example by a database reset without a
 * restart), it can keep executing jobs that no longer exist in cron.job and
 * that no other check can see or disable. Any recent run of an unlisted job
 * by the current scheduler process refuses the environment.
 */
export function assertNoUnlistedCronRuns(runs: Array<{ jobid: number; command: string }>, listedJobIds: number[]): void {
  const ghosts = runs.filter((run) => !listedJobIds.includes(Number(run.jobid)));
  if (ghosts.length > 0) {
    throw new Error(`REFUSING: pg_cron is executing jobs absent from cron.job (stale scheduler; restart the staging database): ${ghosts.map((run) => `#${run.jobid} ${run.command.slice(0, 60)}`).join('; ')}`);
  }
}

/**
 * Supabase Realtime creates and drops daily partitions of realtime.messages in
 * its own publication. They are platform-managed and roll with the calendar,
 * so they are not part of the We Glue schema being compared.
 */
export function isPlatformManagedObject(section: string, name: string): boolean {
  return section === 'publication' && /^supabase_realtime_messages_publication:realtime\.messages_\d{4}_\d{2}_\d{2}$/.test(name);
}

export function fingerprintFrom(rows: Array<{ section: string; name: string; definition: string }>): SchemaFingerprint {
  const objects: Record<string, string> = {};
  const bySection = new Map<string, string[]>();
  for (const row of [...rows].filter((item) => !isPlatformManagedObject(item.section, item.name)).sort((a, b) => `${a.section}|${a.name}`.localeCompare(`${b.section}|${b.name}`))) {
    const key = `${row.section}:${row.name}`;
    const hash = sha256(row.definition);
    objects[key] = hash;
    bySection.set(row.section, [...(bySection.get(row.section) ?? []), `${key}=${hash}`]);
  }
  const sections: Record<string, string> = {};
  for (const [section, lines] of bySection) sections[section] = sha256(lines.join('\n'));
  return { sections, objects };
}

export const FINGERPRINT_SQL = `
  select 'function' as section, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
         pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
  union all
  select 'policy', schemaname || '.' || tablename || ':' || policyname,
         concat_ws('|', permissive, array_to_string(roles, ','), cmd, qual, with_check)
    from pg_policies where schemaname in ('public', 'private', 'realtime', 'storage')
  union all
  select 'trigger', n.nspname || '.' || c.relname || ':' || t.tgname, pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'private', 'auth', 'realtime', 'storage')
  union all
  select 'publication', pubname || ':' || schemaname || '.' || tablename, pubname
    from pg_publication_tables
  union all
  select 'extension', extname, extversion from pg_extension
  union all
  select 'cron', jobname, concat_ws('|', schedule, command, active::text) from cron.job
  union all
  select 'notification_config', key, value::text from public.notification_config`;

export async function runPreflight(config: LoadTestConfig, repoRoot = process.cwd()): Promise<PreflightReport> {
  assertComparisonMigrations(repoRoot);
  for (const [label, token] of [['anon', config.anonKey], ['service-role', config.serviceRoleKey]] as const) {
    if (!token) continue;
    const ref = jwtRef(token);
    if (ref && ref !== config.stagingRef) throw new Error(`${label} key belongs to ${ref}, not ${config.stagingRef}`);
  }
  if (!config.databaseUrl) throw new Error('LOADTEST_DATABASE_URL is required for migration-ledger preflight');
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin read only');
      const ledger = await client.query<{ version: string }>('select version::text from supabase_migrations.schema_migrations order by version');
      const ledgerVersions = ledger.rows.map((row) => row.version);
      assertLedgerMatches(ledgerVersions, config.state, repoRoot);

      const fingerprint = fingerprintFrom((await client.query<{ section: string; name: string; definition: string }>(FINGERPRINT_SQL)).rows);
      const markers = {
        migration149Function: Boolean(fingerprint.objects[`function:${MIGRATION_149_MARKERS.function}`]),
        migration149Policy: Boolean(fingerprint.objects[`policy:${MIGRATION_149_MARKERS.policy}`]),
        migration150InsertTrigger: Boolean(fingerprint.objects[`trigger:${MIGRATION_150_MARKERS.insertTrigger}`]),
        migration150UpdateTrigger: Boolean(fingerprint.objects[`trigger:${MIGRATION_150_MARKERS.updateTrigger}`]),
      };
      assertMigrationMarkers(markers, config.state);

      const dispatch = await client.query<{ url: string | null }>(`select value #>> '{}' as url from public.notification_config where key = 'push.dispatch_url'`);
      const pushMode = classifyPushDispatch(dispatch.rows[0]?.url ?? null);
      const cron = await client.query<{ jobid: number; jobname: string; schedule: string; command: string; active: boolean }>('select jobid, jobname, schedule, command, active from cron.job order by jobname');
      assertCronIsolation(cron.rows);
      const recentRuns = await client.query<{ jobid: number; command: string }>(`select distinct jobid, command from cron.job_run_details
         where start_time > greatest(now() - interval '15 minutes', (select max(backend_start) from pg_stat_activity where backend_type = 'pg_cron launcher'))`);
      assertNoUnlistedCronRuns(recentRuns.rows, cron.rows.map((job) => Number(job.jobid)));

      const university = await client.query<{ name: string; is_active: boolean }>('select name, is_active from public.universities where id = $1', [config.universityId]);
      const universityRow = university.rows[0];
      if (!universityRow || !universityRow.is_active || !universityRow.name.startsWith('Load Test ')) {
        throw new Error('LOADTEST_UNIVERSITY_ID must identify an active university whose name begins "Load Test "');
      }

      let syntheticPushTokens = 0;
      if (existsSync(config.manifestFile)) {
        const manifest = readManifest(config.manifestFile, config);
        const tokens = await client.query<{ n: number }>('select count(*)::int as n from public.push_tokens where user_id = any($1::uuid[])', [manifest.users.map((user) => user.id)]);
        syntheticPushTokens = tokens.rows[0]?.n ?? 0;
        if (syntheticPushTokens > 0) throw new Error('REFUSING LOAD: one or more synthetic users has a push token');
      }
      const others = await client.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity where backend_type = 'client backend' and state = 'active' and pid <> pg_backend_pid()`);
      const version = await client.query<{ server_version: string }>('show server_version');
      await client.query('commit');
      return {
        checkedAt: new Date().toISOString(),
        state: config.state,
        ledgerVersions,
        ledgerSha256: sha256(ledgerVersions.join(',')),
        fingerprint,
        markers,
        pushMode,
        cronJobs: cron.rows.map(({ jobname, schedule, active }) => ({ jobname, schedule, active })),
        universityName: universityRow.name,
        syntheticPushTokens,
        otherActiveClientBackends: others.rows[0]?.n ?? 0,
        serverVersion: version.rows[0]?.server_version ?? 'unknown',
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
