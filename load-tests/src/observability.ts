import { mkdirSync } from 'node:fs';
import { Pool } from 'pg';
import type { LoadTestConfig } from './config.js';
import { serviceClient } from './supabase.js';

export type Observation = {
  at: string;
  phase: 'before' | 'during' | 'after';
  pg?: Record<string, unknown>;
  tables: Record<string, unknown>;
  errors?: string[];
};

export type ObservationRun = {
  name: string;
  startedAt: string;
  endedAt?: string;
  snapshots: Observation[];
};

const sql = {
  activity: `SELECT state, wait_event_type, wait_event, count(*)::int AS count
    FROM pg_stat_activity WHERE datname = current_database()
    GROUP BY state, wait_event_type, wait_event ORDER BY count DESC`,
  activityTotals: `SELECT count(*)::int AS current_connections,
    count(*) FILTER (WHERE state = 'active')::int AS active_connections,
    count(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting_connections
    FROM pg_stat_activity WHERE datname = current_database()`,
  blocked: `SELECT pid, usename, state, wait_event_type, wait_event,
    query_start, now() - query_start AS age, pg_blocking_pids(pid) AS blocking_pids,
    left(query, 500) AS query
    FROM pg_stat_activity
    WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
    ORDER BY query_start`,
  database: `SELECT xact_commit, xact_rollback, blks_read, blks_hit, deadlocks,
    temp_files, temp_bytes FROM pg_stat_database WHERE datname = current_database()`,
  cron: `SELECT jobid, runid, job_pid, database, username, command, status,
    return_message, start_time, end_time, total_time
    FROM cron.job_run_details ORDER BY COALESCE(end_time, start_time) DESC LIMIT 50`,
};

export class Observer {
  private readonly admin: ReturnType<typeof serviceClient>;
  private readonly pool?: Pool;
  readonly run: ObservationRun;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly config: LoadTestConfig, name: string) {
    this.admin = serviceClient(config);
    this.pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: config.requestTimeoutMs }) : undefined;
    this.run = { name, startedAt: new Date().toISOString(), snapshots: [] };
  }

  async snapshot(phase: Observation['phase']): Promise<Observation> {
    const observation: Observation = { at: new Date().toISOString(), phase, tables: {} };
    const errors: string[] = [];
    const tableCounts: Array<[string, string]> = [
      ['push_queue_by_status', 'push_queue'],
      ['notifications_total', 'notifications'],
    ];
    for (const [key, table] of tableCounts) {
      const result = await this.admin.from(table).select('*', { count: 'exact', head: true });
      if (result.error) errors.push(`${table}: ${result.error.message}`);
      else observation.tables[key] = { count: result.count ?? 0 };
    }
    const queue = await this.admin.from('push_queue').select('status');
    if (queue.error) errors.push(`push_queue statuses: ${queue.error.message}`);
    else {
      observation.tables.push_queue_by_status = (queue.data ?? []).reduce<Record<string, number>>((out, row: any) => {
        out[row.status] = (out[row.status] ?? 0) + 1;
        return out;
      }, {});
    }
    const notifications = await this.admin.from('notifications').select('type');
    if (!notifications.error) {
      observation.tables.notifications_by_type = (notifications.data ?? []).reduce<Record<string, number>>((out, row: any) => {
        out[row.type] = (out[row.type] ?? 0) + 1;
        return out;
      }, {});
    } else errors.push(`notifications types: ${notifications.error.message}`);

    if (this.pool) {
      try {
        const client = await this.pool.connect();
        try {
          const [activity, totals, database, cron] = await Promise.all([
            client.query(sql.activity), client.query(sql.activityTotals), client.query(sql.database), client.query(sql.cron),
          ]);
          observation.pg = {
            stat_activity: activity.rows,
            connection_totals: totals.rows[0] ?? {},
            blocked_queries: (await client.query(sql.blocked)).rows,
            stat_database: database.rows[0] ?? {},
            cron_job_run_details: cron.rows,
          };
        } finally { client.release(); }
      } catch (error) {
        errors.push(`postgres observer: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      errors.push('LOADTEST_DATABASE_URL not configured; pg_stat_activity/pg_stat_database/cron.job_run_details unavailable');
    }
    if (errors.length) observation.errors = errors;
    this.run.snapshots.push(observation);
    return observation;
  }

  async start(): Promise<void> {
    await this.snapshot('before');
    this.timer = setInterval(() => { void this.snapshot('during'); }, this.config.observeIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.snapshot('after');
    this.run.endedAt = new Date().toISOString();
    await this.pool?.end();
  }
}

export async function observe<T>(config: LoadTestConfig, name: string, work: (observer: Observer) => Promise<T>): Promise<{ value: T; observation: ObservationRun }> {
  const observer = new Observer(config, name);
  await observer.start();
  try {
    return { value: await work(observer), observation: observer.run };
  } finally {
    await observer.stop();
  }
}

export function prepareResultsDir(config: LoadTestConfig): void { mkdirSync(config.resultsDir, { recursive: true }); }
