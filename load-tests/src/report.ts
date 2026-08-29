import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RunResult } from './result.js';
import { argString, parseArgs } from './config.js';

function fmt(value: unknown): string {
  if (typeof value === 'number') return value.toFixed(2);
  return String(value ?? '—');
}

function maxObservedConnections(result: RunResult): number | null {
  const values = result.observations.snapshots.flatMap((snapshot) => {
    const row = snapshot.pg?.connection_totals as { current_connections?: number } | undefined;
    return typeof row?.current_connections === 'number' ? [row.current_connections] : [];
  });
  return values.length ? Math.max(...values) : null;
}

export function renderReport(result: RunResult): string {
  const lines: string[] = [`# We Glue load-test report: ${result.scenario}`, '', `- Target: `${result.config.supabaseUrl}``, `- University: `${result.config.universityId}``, `- Started: ${result.startedAt}`, `- Ended: ${result.endedAt}`, ''];
  lines.push('## Latency percentiles', '', '| Operation | Samples | p50 ms | p95 ms | p99 ms | Error rate |', '|---|---:|---:|---:|---:|---:|');
  for (const [name, table] of Object.entries(result.metrics.tables)) lines.push(`| ${name} | ${table.count} | ${fmt(table.p50)} | ${fmt(table.p95)} | ${fmt(table.p99)} | ${fmt(table.errorRate)} |`);
  lines.push('', '## Error classes', '', '| Class | Count |', '|---|---:|');
  for (const [name, count] of Object.entries(result.metrics.errors)) lines.push(`| ${name} | ${count} |`);
  if (!Object.keys(result.metrics.errors).length) lines.push('| none | 0 |');

  const maxConnections = maxObservedConnections(result);
  lines.push('', '## Resource observations', '', `- Max observed PostgreSQL connections: **${maxConnections === null ? 'UNKNOWN (set LOADTEST_DATABASE_URL)' : maxConnections} / 60**`);
  const blocked = result.observations.snapshots.reduce((total, snapshot) => total + (Array.isArray(snapshot.pg?.blocked_queries) ? snapshot.pg!.blocked_queries.length : 0), 0);
  lines.push(`- Blocked-query samples: **${blocked}**`);
  const during = result.observations.snapshots.filter((snapshot) => snapshot.phase === 'during').length;
  lines.push(`- Observation snapshots: **${result.observations.snapshots.length}** (${during} during-run)`);

  const cases = (result.details.cases ?? []) as Array<Record<string, unknown>>;
  if (cases.length) {
    lines.push('', '## Photo fan-out criteria', '', '| Members | Concurrent posts | Successful | Failed | Duplicate posts | Post p95 ms | Verdict |', '|---:|---:|---:|---:|---:|---:|---|');
    for (const item of cases) {
      const verdict = item.pass === true ? 'PASS' : item.pass === false ? 'FAIL' : 'UNKNOWN';
      lines.push(`| ${fmt(item.members)} | ${fmt(item.concurrency)} | ${fmt(item.successful)} | ${fmt(item.failed)} | ${fmt(item.duplicatePosts)} | ${fmt(item.postP95Ms)} | ${verdict} |`);
    }
    const max = cases.find((item) => item.members === 500 && item.concurrency === 50);
    const connectionVerdict = maxConnections === null ? 'UNKNOWN' : maxConnections < 60 ? 'PASS' : 'FAIL';
    lines.push('', `Max-case connection criterion: **${connectionVerdict}**`, `Guidance only: p95 DB creation target is ~3,000 ms; correctness and stability are the decision criteria.`);
  }
  lines.push('', '## Raw observation notes', '');
  for (const snapshot of result.observations.snapshots) for (const error of snapshot.errors ?? []) lines.push(`- ${snapshot.phase}: ${error}`);
  if (!result.observations.snapshots.some((snapshot) => snapshot.errors?.length)) lines.push('- none');
  return `${lines.join('\n')}\n`;
}

export function report(argv: string[]): string {
  const args = parseArgs(argv);
  const input = argString(args, 'input', '');
  if (!input || !existsSync(input)) throw new Error('report requires --input path/to/result.json');
  const result = JSON.parse(readFileSync(input, 'utf8')) as RunResult;
  const output = renderReport(result);
  const target = typeof args.output === 'string' ? args.output : undefined;
  if (target) writeFileSync(target, output, 'utf8');
  else process.stdout.write(output);
  return target ?? 'stdout';
}
