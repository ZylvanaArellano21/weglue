import type { LoadTestConfig } from './config.js';
import { finalizeResult } from './result.js';
import { Metrics } from './metrics.js';
import { observe } from './observability.js';

export async function runScenario<T>(
  config: LoadTestConfig,
  scenario: string,
  work: (metrics: Metrics) => Promise<{ details?: Record<string, unknown>; value?: T }>,
): Promise<string> {
  const startedAt = new Date().toISOString();
  const observed = await observe(config, scenario, async () => {
    const metrics = new Metrics();
    const result = await work(metrics);
    return { metrics, ...result };
  });
  return finalizeResult(config, scenario, startedAt, observed.value.metrics, observed.observation, observed.value.details);
}

export function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
