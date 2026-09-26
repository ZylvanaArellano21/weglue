// One 5-second observer sample. Parameters: $1 synthetic user ids, $2 run
// start, $3 manifest conversation ids. Read-only.
export const OBSERVER_SQL = `
  select
    (select count(*) from pg_stat_activity)::int as connections,
    current_setting('max_connections')::int as max_connections,
    (select count(*) from pg_stat_activity where state = 'active')::int as active_connections,
    (select count(*) from pg_stat_activity where state like 'idle%')::int as idle_connections,
    (select count(*) from pg_stat_activity where wait_event_type = 'Lock')::int as lock_waiting,
    (select coalesce(sum(deadlocks), 0) from pg_stat_database)::bigint as deadlocks,
    (select coalesce(sum(xact_commit), 0) from pg_stat_database)::bigint as xact_commit,
    (select coalesce(sum(xact_rollback), 0) from pg_stat_database)::bigint as xact_rollback,
    (select coalesce(sum(temp_bytes), 0) from pg_stat_database)::bigint as temp_bytes,
    (select coalesce(max(extract(epoch from now() - query_start)), 0) from pg_stat_activity
      where cardinality(pg_blocking_pids(pid)) > 0)::float8 as max_blocked_seconds,
    (select coalesce(max(extract(epoch from now() - xact_start)), 0) from pg_stat_activity
      where state <> 'idle' and backend_type = 'client backend' and pid <> pg_backend_pid())::float8 as longest_transaction_seconds,
    (select count(*) from public.push_queue where status = 'pending')::int as push_pending,
    (select coalesce(extract(epoch from now() - min(created_at)), 0) from public.push_queue where status = 'pending')::float8 as push_oldest_pending_seconds,
    (select count(*) from net.http_request_queue)::int as net_queue,
    (select count(*) from public.notifications where created_at > $2::timestamptz)::int as notifications_since_start,
    (select count(*) from public.notifications
      where actor_id = any($1::uuid[]) and user_id <> all($1::uuid[]) and created_at > $2::timestamptz)::int as non_synthetic_recipients,
    (select count(*) from public.messages
      where sender_id = any($1::uuid[]) and conversation_id <> all($3::uuid[]) and created_at > $2::timestamptz)::int as foreign_conversation_writes`;
