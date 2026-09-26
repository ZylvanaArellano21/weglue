// Minimal Prometheus text-format reader for the Supabase Metrics API
// (https://<ref>.supabase.co/customer/v1/privileged/metrics), using standard
// node_exporter series. Any series that is absent is reported as unavailable,
// never guessed; the operator dashboard watch then remains mandatory.

export type Sample = { name: string; labels: Record<string, string>; value: number };

export function parsePrometheus(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(\S+)/.exec(line);
    if (!match) continue;
    const labels: Record<string, string> = {};
    for (const pair of (match[3] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[pair[1]!] = pair[2]!;
    const value = Number(match[4]);
    if (Number.isFinite(value)) samples.push({ name: match[1]!, labels, value });
  }
  return samples;
}

function sum(samples: Sample[], name: string, predicate: (labels: Record<string, string>) => boolean = () => true): number | undefined {
  const matching = samples.filter((sample) => sample.name === name && predicate(sample.labels));
  return matching.length === 0 ? undefined : matching.reduce((total, sample) => total + sample.value, 0);
}

export type HostCounters = {
  at: number;
  cpuIdleSeconds?: number;
  cpuTotalSeconds?: number;
  memTotalBytes?: number;
  memAvailableBytes?: number;
  diskOps?: number;
};

export function hostCounters(samples: Sample[], at: number): HostCounters {
  const reads = sum(samples, 'node_disk_reads_completed_total');
  const writes = sum(samples, 'node_disk_writes_completed_total');
  return {
    at,
    cpuIdleSeconds: sum(samples, 'node_cpu_seconds_total', (labels) => labels.mode === 'idle'),
    cpuTotalSeconds: sum(samples, 'node_cpu_seconds_total'),
    memTotalBytes: sum(samples, 'node_memory_MemTotal_bytes'),
    memAvailableBytes: sum(samples, 'node_memory_MemAvailable_bytes'),
    diskOps: reads === undefined || writes === undefined ? undefined : reads + writes,
  };
}

export type HostRatios = { cpuRatio?: number; memoryRatio?: number; diskIops?: number; diskIopsRatio?: number };

/** Ratios between two scrapes; undefined where a series is unavailable. */
export function hostRatios(previous: HostCounters | undefined, current: HostCounters, diskIopsLimit?: number): HostRatios {
  const ratios: HostRatios = {};
  if (current.memTotalBytes && current.memAvailableBytes !== undefined) ratios.memoryRatio = 1 - current.memAvailableBytes / current.memTotalBytes;
  if (!previous) return ratios;
  const idle = (current.cpuIdleSeconds ?? NaN) - (previous.cpuIdleSeconds ?? NaN);
  const total = (current.cpuTotalSeconds ?? NaN) - (previous.cpuTotalSeconds ?? NaN);
  if (Number.isFinite(idle) && Number.isFinite(total) && total > 0) ratios.cpuRatio = Math.min(1, Math.max(0, 1 - idle / total));
  const seconds = (current.at - previous.at) / 1000;
  const ops = (current.diskOps ?? NaN) - (previous.diskOps ?? NaN);
  if (Number.isFinite(ops) && seconds > 0) {
    ratios.diskIops = ops / seconds;
    if (diskIopsLimit) ratios.diskIopsRatio = ratios.diskIops / diskIopsLimit;
  }
  return ratios;
}

/** Tracks how long a condition has held continuously. */
export class SustainedCondition {
  private since: number | undefined;
  constructor(private readonly windowMs: number) {}
  update(active: boolean, now: number): boolean {
    if (!active) {
      this.since = undefined;
      return false;
    }
    this.since ??= now;
    return now - this.since >= this.windowMs;
  }
}
