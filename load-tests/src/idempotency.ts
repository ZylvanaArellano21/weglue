import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argString, assertWriteApproved } from './config.js';
import { classifyError } from './metrics.js';
import { anonClient, serviceClient, withTimeout } from './supabase.js';
import { readManifest } from './seed.js';
import { runScenario } from './runner.js';

type Probe = { name: string; tagMode: 'without-tag' | 'with-tag'; attempted: number; succeeded: number; rowCount: number; duplicateRows: number; errors: string[]; tagSupport: 'supported' | 'natural-key-only' | 'not-tested' };

async function runInsertProbe(
  config: LoadTestConfig,
  name: string,
  tagMode: Probe['tagMode'],
  insert: (client: ReturnType<typeof anonClient>, tag?: string) => Promise<{ id?: string; error?: any }>,
  countRows: () => Promise<number>,
  cleanup: (ids: string[]) => Promise<void>,
  metricsName: string,
  metrics: import('./metrics.js').Metrics,
  tagSupported: Probe['tagSupport'],
): Promise<Probe> {
  const tag = tagMode === 'with-tag' ? randomUUID() : undefined;
  const client = anonClient(config, `loadtest-idempotency-${name}-${tagMode}`);
  const started = performance.now();
  const results = await Promise.all([
    withTimeout(insert(client, tag), config.requestTimeoutMs, `${name} probe 1`),
    withTimeout(insert(client, tag), config.requestTimeoutMs, `${name} probe 2`),
  ]);
  const ids = results.flatMap((result) => result.id ? [result.id] : []);
  const errors = results.flatMap((result) => result.error ? [result.error.message ?? String(result.error)] : []);
  const rowCount = await countRows();
  await cleanup(ids);
  const succeeded = ids.length;
  metrics.add({ name: metricsName, ms: performance.now() - started, ok: errors.length === 0 || (tagMode === 'with-tag' && tagSupported === 'supported' && succeeded === 1), errorClass: errors.length ? classifyError({ message: errors[0] }) : undefined, meta: { tagMode, rowCount, errors } });
  return { name, tagMode, attempted: 2, succeeded, rowCount, duplicateRows: Math.max(0, rowCount - 1), errors, tagSupport: tagSupported };
}

export async function idempotency(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const manifest = readManifest(config, typeof args.manifest === 'string' ? args.manifest : undefined);
  const userId = manifest.userIds[0];
  const clubId = manifest.clubIds[0];
  if (!userId || !clubId) throw new Error('Manifest needs at least one user and club');
  const admin = serviceClient(config);
  const client = anonClient(config, 'loadtest-idempotency-base');
  const signedIn = await withTimeout(client.auth.signInWithPassword({ email: manifest.emails[0]!, password: manifest.passwords[0]! }), config.requestTimeoutMs, 'idempotency sign in');
  if (signedIn.error) throw signedIn.error;
  const marker = `LOADTEST:IDEMPOTENCY:${Date.now()}:${randomUUID().slice(0, 6)}`;
  const basePost = await admin.from('posts').insert({ author_id: userId, club_id: clubId, post_type: 'picture', image_url: null, caption: `${marker}:base-post` }).select('id').single();
  if (basePost.error || !basePost.data) throw basePost.error ?? new Error('could not create base post');
  const baseEvent = await admin.from('events').insert({ club_id: clubId, created_by: userId, title: `${marker}:base-event`, description: 'idempotency base', event_date: '2099-01-01', start_time: '12:00:00', end_time: '13:00:00', visibility: 'everyone' }).select('id').single();
  if (baseEvent.error || !baseEvent.data) throw baseEvent.error ?? new Error('could not create base event');

  return runScenario(config, 'idempotency-probes', async (metrics) => {
    const probes: Probe[] = [];
    const tagModes: Probe['tagMode'][] = ['without-tag', 'with-tag'];
    for (const tagMode of tagModes) {
      const postPayload = (client: ReturnType<typeof anonClient>, tag?: string) => client.from('posts').insert({ author_id: userId, club_id: clubId, post_type: 'picture', image_url: null, caption: `${marker}:post:${tagMode}`, ...(tagMode === 'with-tag' ? { client_tag: tag } : {}) }).select('id').single();
      probes.push(await runInsertProbe(config, 'post', tagMode, async (probeClient, tag) => {
        const result = await postPayload(probeClient, tag); return { id: result.data?.id, error: result.error };
      }, async () => (await admin.from('posts').select('id', { count: 'exact', head: true }).eq('caption', `${marker}:post:${tagMode}`)).count ?? 0, async (ids) => { if (ids.length) await admin.from('posts').delete().in('id', ids); }, 'idempotency-post', metrics, 'supported'));

      probes.push(await runInsertProbe(config, 'comment', tagMode, async (probeClient, tag) => {
        const result = await probeClient.from('post_comments').insert({ post_id: basePost.data.id, user_id: userId, content: `${marker}:comment:${tagMode}`, ...(tagMode === 'with-tag' ? { client_tag: tag } : {}) }).select('id').single();
        return { id: result.data?.id, error: result.error };
      }, async () => (await admin.from('post_comments').select('id', { count: 'exact', head: true }).eq('post_id', basePost.data.id).eq('content', `${marker}:comment:${tagMode}`)).count ?? 0, async (ids) => { if (ids.length) await admin.from('post_comments').delete().in('id', ids); }, 'idempotency-comment', metrics, 'supported'));

      probes.push(await runInsertProbe(config, 'event', tagMode, async (probeClient, tag) => {
        const result = await probeClient.from('events').insert({ club_id: clubId, created_by: userId, title: `${marker}:event:${tagMode}`, description: 'idempotency probe', event_date: '2099-01-01', start_time: '12:00:00', end_time: '13:00:00', visibility: 'everyone', ...(tagMode === 'with-tag' ? { client_tag: tag } : {}) }).select('id').single();
        return { id: result.data?.id, error: result.error };
      }, async () => (await admin.from('events').select('id', { count: 'exact', head: true }).eq('created_by', userId).eq('title', `${marker}:event:${tagMode}`)).count ?? 0, async (ids) => { if (ids.length) await admin.from('events').delete().in('id', ids); }, 'idempotency-event', metrics, 'supported'));

      const rsvp = await runInsertProbe(config, 'rsvp', tagMode, async (probeClient, tag) => {
        const result = await probeClient.from('event_rsvps').insert({ event_id: baseEvent.data.id, user_id: userId, status: 'going', ...(tagMode === 'with-tag' ? { client_tag: tag } : {}) }).select('id').single();
        return { id: result.data?.id, error: result.error };
      }, async () => (await admin.from('event_rsvps').select('id', { count: 'exact', head: true }).eq('event_id', baseEvent.data.id).eq('user_id', userId)).count ?? 0, async (ids) => { if (ids.length) await admin.from('event_rsvps').delete().in('id', ids); }, 'idempotency-rsvp', metrics, 'natural-key-only');
      probes.push(rsvp);
    }

    const probeClub = await admin.from('clubs').insert({ name: `${marker}:club`, handle: marker.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 55), description: 'idempotency probe', university_id: manifest.universityId, is_seed: true, is_active: true }).select('id').single();
    if (probeClub.error || !probeClub.data) throw probeClub.error ?? new Error('could not create probe club');
    for (const tagMode of tagModes) {
      probes.push(await runInsertProbe(config, 'club-join', tagMode, async (probeClient, tag) => {
        const result = await probeClient.from('club_members').insert({ club_id: probeClub.data.id, user_id: userId, role: 'member', ...(tagMode === 'with-tag' ? { client_tag: tag } : {}) }).select('id').single();
        return { id: result.data?.id, error: result.error };
      }, async () => (await admin.from('club_members').select('id', { count: 'exact', head: true }).eq('club_id', probeClub.data.id).eq('user_id', userId)).count ?? 0, async (ids) => { if (ids.length) await admin.from('club_members').delete().in('id', ids); }, 'idempotency-club-join', metrics, 'natural-key-only'));
    }
    await admin.from('clubs').delete().eq('id', probeClub.data.id);
    await admin.from('events').delete().eq('id', baseEvent.data.id);
    await admin.from('posts').delete().eq('id', basePost.data.id);
    return { details: { marker, probes, note: 'Migration 100 supports client_tag only on posts, events, and post_comments. RSVP and club_members are recorded as natural-key-only probes; passing a tag there is expected to be rejected by the schema.' } };
  });
}
