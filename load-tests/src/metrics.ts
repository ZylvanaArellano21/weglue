export type Sample = { name: string; ms: number; ok: boolean; errorClass?: string; meta?: Record<string, unknown> };

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[index] ?? 0).toFixed(2));
}

export class Metrics {
  readonly samples: Sample[] = [];
  readonly counters = new Map<string, number>();

  add(sample: Sample): void { this.samples.push(sample); }
  count(name: string, amount = 1): void { this.counters.set(name, (this.counters.get(name) ?? 0) + amount); }
  values(name: string): number[] { return this.samples.filter((s) => s.name === name).map((s) => s.ms); }
  table(name: string): { count: number; p50: number; p95: number; p99: number; errorRate: number } {
    const rows = this.samples.filter((s) => s.name === name);
    return {
      count: rows.length,
      p50: percentile(rows.map((r) => r.ms), 50),
      p95: percentile(rows.map((r) => r.ms), 95),
      p99: percentile(rows.map((r) => r.ms), 99),
      errorRate: rows.length ? Number((rows.filter((r) => !r.ok).length / rows.length).toFixed(4)) : 0,
    };
  }

  errorClasses(name?: string): Record<string, number> {
    const rows = this.samples.filter((s) => (!name || s.name === name) && !s.ok);
    return rows.reduce<Record<string, number>>((out, row) => {
      const key = row.errorClass ?? 'unknown';
      out[key] = (out[key] ?? 0) + 1;
      return out;
    }, {});
  }
}

export async function timed<T>(metrics: Metrics, name: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await fn();
    metrics.add({ name, ms: performance.now() - started, ok: true });
    return value;
  } catch (error) {
    metrics.add({ name, ms: performance.now() - started, ok: false, errorClass: classifyError(error) });
    throw error;
  }
}

export function classifyError(error: unknown): string {
  const e = error as { status?: number; code?: string; message?: string };
  const message = (e?.message ?? String(error)).toLowerCase();
  if (e?.status === 429 || message.includes('rate limit') || message.includes('too many')) {
    if (message.includes('email') || message.includes('over_email_send_rate_limit')) return '429 over_email_send_rate_limit';
    return '429 rate_limit';
  }
  if (e?.status && e.status >= 500) return '5xx';
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout';
  if (e?.code === '23505' || message.includes('duplicate') || message.includes('unique')) return 'duplicate/23505';
  if (e?.code) return `error/${e.code}`;
  return 'other';
}
