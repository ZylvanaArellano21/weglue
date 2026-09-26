import pg from 'pg';
import { assertWriteApproved } from './config.js';
import { actionMessagePrefix, readManifest } from './synthetic.js';
import { serviceClient } from './supabase.js';
import type { LoadTestConfig, SyntheticManifest } from './types.js';

// Tables whose dead tuples a reset creates; vacuumed as a fixed step so every
// phase starts from the same physical state.
export const RESET_VACUUM_TABLES = ['messages', 'notifications', 'push_queue', 'event_rsvps', 'saved_events', 'conversation_participants'] as const;

export type ResetScope = {
  userIds: string[];
  conversationIds: string[];
  seededAt: string;
  actionPrefix: string;
};

export function resetScope(manifest: SyntheticManifest, config: Pick<LoadTestConfig, 'namespace'>): ResetScope {
  if (manifest.users.length === 0 || manifest.conversationIds.length === 0) throw new Error('Manifest has no synthetic scope');
  return {
    userIds: manifest.users.map((user) => user.id),
    conversationIds: manifest.conversationIds,
    seededAt: manifest.seededAt,
    actionPrefix: actionMessagePrefix(config.namespace),
  };
}

/**
 * Every statement is scoped to synthetic user IDs and/or manifest
 * conversations AND to rows created after the seed watermark. Two guards run
 * first: any foreign write inside synthetic conversations, or any synthetic
 * actor notifying a non-synthetic user, aborts the reset for investigation.
 */
export const RESET_STATEMENTS = Object.freeze({
  foreignConversationWrites: `
    select count(*)::int as n from public.messages
     where conversation_id = any($2::uuid[]) and created_at > $3::timestamptz
       and (sender_id is null or sender_id <> all($1::uuid[]) or content is null or left(content, length($4)) <> $4)`,
  nonSyntheticRecipients: `
    select count(*)::int as n from public.notifications
     where actor_id = any($1::uuid[]) and user_id <> all($1::uuid[]) and created_at > $3::timestamptz`,
  deleteNotifications: `delete from public.notifications where user_id = any($1::uuid[]) and created_at > $3::timestamptz`,
  deletePushQueue: `delete from public.push_queue where user_id = any($1::uuid[]) and created_at > $3::timestamptz`,
  deleteActionMessages: `
    delete from public.messages
     where conversation_id = any($2::uuid[]) and created_at > $3::timestamptz
       and sender_id = any($1::uuid[]) and left(content, length($4)) = $4`,
  deleteRsvps: `delete from public.event_rsvps where user_id = any($1::uuid[])`,
  deleteSaves: `delete from public.saved_events where user_id = any($1::uuid[])`,
  restoreSeedNotifications: `
    update public.notifications set read = false, read_at = null, seen_at = null
     where user_id = any($1::uuid[]) and created_at <= $3::timestamptz
       and (read or read_at is not null or seen_at is not null)`,
  restoreReadWatermark: `
    update public.conversation_participants set last_read_at = $3::timestamptz, hidden_at = null
     where conversation_id = any($2::uuid[]) and user_id = any($1::uuid[])`,
});

function params(scope: ResetScope): unknown[] {
  return [scope.userIds, scope.conversationIds, scope.seededAt, scope.actionPrefix];
}

async function withPool<T>(config: LoadTestConfig, fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  if (!config.databaseUrl) throw new Error('LOADTEST_DATABASE_URL is required for scoped reset/cleanup');
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Count of campaign-generated rows still present; the campaign refuses to start unless 0. */
export async function countRunScopedRows(config: LoadTestConfig, manifest = readManifest(config.manifestFile, config)): Promise<number> {
  const scope = resetScope(manifest, config);
  return withPool(config, async (pool) => {
    const result = await pool.query<{ n: number }>(`
      select (select count(*) from public.messages where conversation_id = any($2::uuid[]) and created_at > $3::timestamptz)
           + (select count(*) from public.notifications where user_id = any($1::uuid[]) and created_at > $3::timestamptz)
           + (select count(*) from public.event_rsvps where user_id = any($1::uuid[]))
           + (select count(*) from public.saved_events where user_id = any($1::uuid[])) as n`, params(scope));
    return Number(result.rows[0]?.n ?? 0);
  });
}

export async function resetActionWrites(config: LoadTestConfig, manifest = readManifest(config.manifestFile, config)): Promise<Record<string, number>> {
  assertWriteApproved(config);
  const scope = resetScope(manifest, config);
  const counts: Record<string, number> = {};
  await withPool(config, async (pool) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const foreign = await client.query<{ n: number }>(RESET_STATEMENTS.foreignConversationWrites, params(scope));
      if ((foreign.rows[0]?.n ?? 0) > 0) throw new Error('Cleanup scope violation: non-campaign messages exist in synthetic conversations after the seed watermark');
      const outside = await client.query<{ n: number }>(RESET_STATEMENTS.nonSyntheticRecipients, params(scope));
      if ((outside.rows[0]?.n ?? 0) > 0) throw new Error('Isolation violation: synthetic actors notified non-synthetic users');
      for (const name of ['deleteNotifications', 'deletePushQueue', 'deleteActionMessages', 'deleteRsvps', 'deleteSaves', 'restoreSeedNotifications', 'restoreReadWatermark'] as const) {
        const result = await client.query(RESET_STATEMENTS[name], params(scope));
        counts[name] = result.rowCount ?? 0;
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    for (const table of RESET_VACUUM_TABLES) await pool.query(`vacuum (analyze) public.${table}`);
  });
  return counts;
}

export async function cleanupSyntheticData(config: LoadTestConfig): Promise<void> {
  assertWriteApproved(config);
  const manifest: SyntheticManifest = readManifest(config.manifestFile, config);
  await resetActionWrites(config, manifest);
  await withPool(config, async (pool) => {
    // Club deletion cascades the trigger-created conversations, their channels
    // and messages, club events and posts. Only manifest clubs that are still
    // marked as seed data in the Load Test namespace are eligible.
    await pool.query(`delete from public.clubs where id = any($1::uuid[]) and is_seed and name like $2`, [manifest.clubIds, `Load Test ${config.namespace} Club %`]);
  });
  const admin = serviceClient(config);
  for (const user of manifest.users) {
    // Auth deletion cascades the profile and every per-user synthetic row.
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error && !deleted.error.message.toLowerCase().includes('not found')) {
      throw new Error(`delete synthetic auth user ${user.index}: ${deleted.error.message}`);
    }
  }
}
