import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzePlateau, analyzeRun, capacity, holdWindows, type PlateauResult } from '../src/analyze.js';
import { dbSamples, k6Summary, plateau, plateauInput, realtimeWindow, T0 } from './analysis-fixtures.js';

describe('plateau classification (approved definitions)', () => {
  it('evaluates only hold windows', () => {
    expect(holdWindows(plateau)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('classifies a healthy, recovered plateau as safe', () => {
    const result = analyzePlateau(plateauInput());
    expect(result.classification).toBe('safe');
    expect(result.recovery?.recovered).toBe(true);
    expect(result.http?.journeys.home?.p95).toBe(420);
    expect(result.realtime.validFailureRate).toBe(0);
  });

  it('needs two consecutive windows over 2× reference and ≥250 ms worse to degrade', () => {
    const oneWindow = analyzePlateau(plateauInput({ summary: k6Summary({ windowP95: (w) => (w === 5 ? 2_000 : 400) }) }));
    expect(oneWindow.classification).toBe('safe');
    const twoWindows = analyzePlateau(plateauInput({ summary: k6Summary({ windowP95: (w) => (w === 5 || w === 6 ? 2_000 : 400) }) }));
    expect(twoWindows.classification).toBe('degraded');
    expect(twoWindows.reasons.join(' ')).toMatch(/2× low-load reference/);
    // 2× but not 250 ms worse is not degradation.
    const small = analyzePlateau(plateauInput({ referenceInteractiveP95Ms: 100, summary: k6Summary({ windowP95: (w) => (w === 5 || w === 6 ? 300 : 120) }) }));
    expect(small.classification).toBe('safe');
  });

  it('degrades on sustained 1% errors, DB pressure, or failed recovery', () => {
    expect(analyzePlateau(plateauInput({ summary: k6Summary({ windowErrorRate: (w) => (w === 3 || w === 4 ? 0.02 : 0) }) })).classification).toBe('degraded');
    const hot = dbSamples(T0 - 900_000, T0 + 1_050_000, { cpuRatio: 0.2 }).map((sample) => {
      const at = Date.parse(sample.at);
      return at >= T0 + 240_000 && at < T0 + 360_000 ? { ...sample, cpuRatio: 0.75 } : sample;
    });
    expect(analyzePlateau(plateauInput({ database: hot })).reasons.join(' ')).toMatch(/CPU or connections/);
    const stuck = dbSamples(T0 - 900_000, T0 + 1_050_000).map((sample) => (Date.parse(sample.at) > T0 + 990_000 ? { ...sample, connections: 40 } : sample));
    const notRecovered = analyzePlateau(plateauInput({ database: stuck }));
    expect(notRecovered.classification).toBe('degraded');
    expect(notRecovered.recovery?.recovered).toBe(false);
  });

  it('breaks on hard stops, 5% errors, 5 s p95 or 2% valid join failures', () => {
    expect(analyzePlateau(plateauInput({ hardStops: ['new database deadlock'], aborted: true })).classification).toBe('broken');
    expect(analyzePlateau(plateauInput({ summary: k6Summary({ errorRate: 0.06 }) })).classification).toBe('broken');
    expect(analyzePlateau(plateauInput({ summary: k6Summary({ p95: 5_500 }) })).classification).toBe('broken');
    expect(analyzePlateau(plateauInput({ realtime: [realtimeWindow(0, { attempts: 100, subscribed: 96, errors: 4 })] })).classification).toBe('broken');
  });

  it('excludes the expected 148 sync:block denial from the valid join failure rate', () => {
    const result = analyzePlateau(plateauInput({ realtime: [realtimeWindow(0), realtimeWindow(0, { attempts: 10, subscribed: 0, expectedUnauthorized: 10, latenciesMs: [] }, 'block')] }));
    expect(result.realtime.expectedUnauthorized).toBe(10);
    expect(result.realtime.validFailureRate).toBe(0);
    expect(result.classification).toBe('safe');
  });

  it('marks generator-bound runs invalid rather than broken', () => {
    const lagging = realtimeWindow(0);
    lagging.eventLoopLagP95Ms = 80;
    expect(analyzePlateau(plateauInput({ realtime: [lagging] })).classification).toBe('invalid');
    expect(analyzePlateau(plateauInput({ generatorStops: ['generator CPU >= 85%'], aborted: true })).classification).toBe('invalid');
  });
});

describe('capacity summary', () => {
  const at = (users: number, classification: PlateauResult['classification']) => ({ users, classification }) as PlateauResult;
  it('reports safe tested concurrency, degradation point and breaking point', () => {
    expect(capacity([at(1, 'safe'), at(5, 'safe'), at(10, 'degraded'), at(25, 'broken')])).toEqual({ safeTestedConcurrency: 5, degradationPoint: 10, breakingPoint: 25 });
    expect(capacity([at(1, 'safe'), at(5, 'broken')])).toEqual({ safeTestedConcurrency: 1, degradationPoint: 5, breakingPoint: 5 });
    expect(capacity([at(1, 'safe'), at(5, 'safe')])).toEqual({ safeTestedConcurrency: 5, degradationPoint: null, breakingPoint: null });
  });
});

describe('run directory analysis', () => {
  it('reads supervisor, k6, Realtime and observer artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wg-analyze-'));
    const planned = { ...plateau, index: 0 };
    writeFileSync(join(dir, 'run-manifest.json'), JSON.stringify({ runId: '148-steady-warm-r1', status: 'completed', plannedPlateaus: [planned] }));
    const input = plateauInput();
    const events = [
      { type: 'idle-start', at: new Date(T0 - 900_000).toISOString() },
      { type: 'idle-end', at: new Date(T0 - 1).toISOString() },
      { type: 'plateau-start', at: new Date(T0).toISOString(), plateau: 0 },
      { type: 'plateau-load-end', at: new Date(input.loadEnd).toISOString(), plateau: 0 },
      { type: 'plateau-cooldown-end', at: new Date(input.cooldownEnd).toISOString(), plateau: 0 },
    ];
    writeFileSync(join(dir, 'events.ndjson'), events.map((event) => JSON.stringify(event)).join('\n'));
    writeFileSync(join(dir, 'observer.ndjson'), input.database.map((sample) => JSON.stringify(sample)).join('\n'));
    writeFileSync(join(dir, 'k6-summary-p0.json'), JSON.stringify(k6Summary()));
    writeFileSync(join(dir, 'realtime-p0-s0.ndjson'), [realtimeWindow(0), realtimeWindow(1)].map((row) => JSON.stringify({ ...row, plateau: 0 })).join('\n'));
    const analysis = analyzeRun(dir);
    expect(analysis.invalid).toBe(false);
    expect(analysis.plateaus[0]!.classification).toBe('safe');
    expect(analysis.safeTestedConcurrency).toBe(10);
  });
});
