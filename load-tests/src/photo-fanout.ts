import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError, percentile } from './metrics.js';
import { serviceClient, withTimeout } from './supabase.js';
import { manifestPath, readManifest } from './seed.js';
import { runScenario } from './runner.js';

type CaseResult = Record<string, unknown>;

async function queueCounts(admin: ReturnType<typeof serviceClient>): Promise<Record<string, number>> {
  const result = await admin.from('push_queue').select('status');
  if (result.error) return { unavailable: -1 };
  return (result.data ?? []).reduce<Record<string, number>>((out, row: any) => { out[row.status] = (out[row.status] ?? 0) + 1; return out; }, {});
}

async function exactCount(admin: ReturnType<typeof serviceClient>, table: string, column: string, values: string[]): Promise<number> {
  if (!values.length) return 0;
  const result = await admin.from(table).select(column, { count: 'exact', head: true }).in(column, values);
  if (result.error) return -1;
  return result.count ?? 0;
}

export async function photoFanout(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const namespace = argString(args, 'namespace', config.seedNamespace);
  const sizes = argString(args, 'members', '100,300,500').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const concurrencies = argString(args, 'concurrency', '1,10,50').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const drainWaitMs = argNumber(args, 'drain-wait-ms', 5_000);
  if (!sizes.length || !concurrencies.length) throw new Error('--members and --concurrency must contain positive integers');
  const admin = serviceClient(config);
  const manifests = new Map<number, ReturnType<typeof readManifest>>();
  for (const size of sizes) manifests.set(size, readManifest(config, manifestPath(config, namespace, size)));
  if (new Set([...manifests.values()].map((manifest) => manifest.universityId)).size !== manifests.size) {
    throw new Error('Photo fan-out size manifests must point to distinct synthetic universities; seed 100/300/500 with different LOADTEST_UNIVERSITY_ID values.');
  }

  return runScenario(config, 'photo-post-fanout', async (metrics) => {
    const cases: CaseResult[] = [];
    for (const size of sizes) {
      const manifest = manifests.get(size)!;
      if (manifest.size < size) throw new Error(`Manifest ${size} contains only ${manifest.size} members`);
      for (const concurrency of concurrencies) {
        const authors = manifest.userIds.slice(0, concurrency);
        if (authors.length < concurrency) throw new Error(`Manifest ${size} cannot run concurrency ${concurrency}`);
        const runId = `${namespace}-${size}-${concurrency}-${Date.now()}-${randomUUID().slice(0, 6)}`;
        const captions = authors.map((_, i) => `LOADTEST:PHOTO:${runId}:${i}`);
        const notificationBefore = await exactCount(admin, 'notifications', 'type', ['club_post']);
        const pushBefore = await queueCounts(admin);
        const createdIds: string[] = [];
        const started = performance.now();
        await Promise.all(authors.map(async (authorId, index) => {
          const itemStarted = performance.now();
          try {
            const result = await withTimeout(admin.from('posts').insert({ author_id: authorId, club_id: manifest.clubIds[index % manifest.clubIds.length], post_type: 'picture', image_url: `https://loadtest.invalid/photo/${runId}/${index}.jpg`, caption: captions[index] }).select('id').single(), config.requestTimeoutMs, `photo post ${size}/${concurrency}/${index}`);
            if (result.error || !result.data?.id) throw result.error ?? new Error('photo post returned no id');
            createdIds.push(result.data.id);
            metrics.add({ name: 'photo-post-db-create', ms: performance.now() - itemStarted, ok: true, meta: { size, concurrency, postId: result.data.id } });
          } catch (error) {
            metrics.add({ name: 'photo-post-db-create', ms: performance.now() - itemStarted, ok: false, errorClass: classifyError(error), meta: { size, concurrency } });
          }
        }));
        const elapsedMs = performance.now() - started;
        if (drainWaitMs) await new Promise((resolve) => setTimeout(resolve, drainWaitMs));
        const notificationAfter = await exactCount(admin, 'notifications', 'entity_id', createdIds);
        const pushAfter = await queueCounts(admin);
        const duplicateCount = await exactCount(admin, 'posts', 'caption', captions);
        const successful = createdIds.length;
        const caseSamples = metrics.samples.filter((sample) => sample.name === 'photo-post-db-create' && sample.meta?.size === size && sample.meta?.concurrency === concurrency);
        const notificationDelta = notificationAfter;
        const pushDelta = Object.fromEntries(new Set([...Object.keys(pushBefore), ...Object.keys(pushAfter)]).values().map((key) => [key, (pushAfter[key] ?? 0) - (pushBefore[key] ?? 0)]));
        const result: CaseResult = {
          members: size, concurrency, elapsedMs: Number(elapsedMs.toFixed(2)), attempted: concurrency, successful, failed: concurrency - successful,
          postP50Ms: percentile(caseSamples.map((sample) => sample.ms), 50), postP95Ms: percentile(caseSamples.map((sample) => sample.ms), 95), postP99Ms: percentile(caseSamples.map((sample) => sample.ms), 99),
          notificationRowsDelta: notificationDelta, notificationRowsPerPost: successful ? Number((notificationDelta / successful).toFixed(2)) : null, notificationTypeRowsBefore: notificationBefore,
          pushQueueBefore: pushBefore, pushQueueAfter: pushAfter, pushQueueDelta: pushDelta, duplicatePosts: duplicateCount < 0 ? null : Math.max(0, duplicateCount - successful),
          pass: size === 500 && concurrency === 50 && successful === concurrency && duplicateCount === successful,
        };
        cases.push(result);
        metrics.count(`photo_cases_${size}_${concurrency}`);
      }
    }
    const max = cases.find((item) => item.members === 500 && item.concurrency === 50);
    return { details: { members: sizes, concurrencies, drainWaitMs, cases, maxScenario: max ?? null, passCriteria: {
      maxScenarioMustComplete: true, noDuplicatePosts: true, noConnectionExhaustion: 'Check observations.pg.connection_totals against Postgres max_connections=60',
      noPostInsertFailureFromFanout: true, guidanceP95Ms: 3_000, realtimeLimits: { maxConcurrentUsers: 200, maxJoinsPerSecond: 100, maxEventsPerSecond: 100 },
    } } };
  });
}
