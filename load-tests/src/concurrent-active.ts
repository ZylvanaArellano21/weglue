import type { RealtimeChannel } from '@supabase/supabase-js';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError } from './metrics.js';
import { anonClient, withTimeout } from './supabase.js';
import { readManifest } from './seed.js';
import { runScenario, sleep } from './runner.js';

type ActiveUser = { id: string; email: string; password: string; client: ReturnType<typeof anonClient>; channels: RealtimeChannel[] };

export type Topology = 'legacy' | 'reduced';

// Two always-on per-user realtime topologies:
//
// legacy  — pre-realtime-load-reduction (4 postgres_changes channels):
//   notifications:<uid>      notifications INSERT   filter user_id=eq.<uid>
//   unread-summary:<uid>     notifications INSERT + UPDATE  filter user_id=eq.<uid>
//   message-banners:<uid>    messages INSERT  filter sender_id=neq.<uid>   <-- broad
//   my-clubs:<uid>           club_members *  filter user_id=eq.<uid>
//   + the message-banners handler does two follow-up reads per delivered row.
//
// reduced — post migrations 102/103 + FE approach A/B/C (2 postgres_changes + 1 broadcast):
//   notifications:<uid>          notifications INSERT + UPDATE  filter user_id=eq.<uid>
//   my-clubs:<uid>               club_members *  filter user_id=eq.<uid>
//   sync:message-inbox:<uid>     PRIVATE BROADCAST — 'invalidate' + 'new_message'
//                                (banner built straight from payload, no reads)
async function subscribeRealTopology(
  user: ActiveUser,
  metrics: Metrics,
  onEvent: (kind: string) => void,
  topology: Topology = 'legacy',
): Promise<void> {
  const { client, id } = user;

  const mkChannel = (topic: string, binds: Array<{ event: string; table: string; filter?: string; cb: (p: any) => void }>): Promise<RealtimeChannel | null> =>
    new Promise((resolve) => {
      let settled = false;
      let ch = client.channel(topic);
      for (const b of binds) {
        ch = ch.on('postgres_changes' as any, { event: b.event, schema: 'public', table: b.table, ...(b.filter ? { filter: b.filter } : {}) }, b.cb);
      }
      ch.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') { metrics.count('realtime_joins'); if (!settled) { settled = true; resolve(ch); } }
        else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
          settled = true; metrics.count(`realtime_${status.toLowerCase()}`); if (error) metrics.count('realtime_join_errors'); resolve(null);
        }
      });
      setTimeout(() => { if (!settled) { settled = true; metrics.count('realtime_join_timeout'); resolve(null); } }, 15_000);
    });

  const mkBroadcast = (topic: string, events: string[], cb: (event: string, payload: any) => void): Promise<RealtimeChannel | null> =>
    new Promise((resolve) => {
      let settled = false;
      let ch = client.channel(topic, { config: { private: true } });
      for (const ev of events) ch = ch.on('broadcast' as any, { event: ev }, (m: any) => cb(ev, m?.payload ?? m));
      ch.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') { metrics.count('realtime_joins'); if (!settled) { settled = true; resolve(ch); } }
        else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
          settled = true; metrics.count(`realtime_${status.toLowerCase()}`); if (error) metrics.count('realtime_join_errors'); resolve(null);
        }
      });
      setTimeout(() => { if (!settled) { settled = true; metrics.count('realtime_join_timeout'); resolve(null); } }, 15_000);
    });

  let channels: Array<RealtimeChannel | null>;

  if (topology === 'reduced') {
    // Post-102/103: 2 postgres_changes channels + 1 private broadcast. The
    // banner is built straight from the `new_message` payload — no follow-up reads.
    await client.realtime.setAuth((await client.auth.getSession()).data.session?.access_token ?? null);
    channels = await Promise.all([
      mkChannel(`notifications:${id}`, [
        { event: 'INSERT', table: 'notifications', filter: `user_id=eq.${id}`, cb: () => onEvent('notification') },
        { event: 'UPDATE', table: 'notifications', filter: `user_id=eq.${id}`, cb: () => onEvent('notification-update') },
      ]),
      mkChannel(`my-clubs:${id}`, [
        { event: '*', table: 'club_members', filter: `user_id=eq.${id}`, cb: () => onEvent('my-clubs') },
      ]),
      mkBroadcast(`sync:message-inbox:${id}`, ['invalidate', 'new_message'], (ev) => onEvent(ev === 'new_message' ? 'message-banner' : 'inbox-invalidate')),
    ]);
  } else {
    const bannerHandler = async (payload: any) => {
      onEvent('message-banner');
      const row = payload?.new;
      if (!row || row.deleted_at) return;
      // The real legacy client's two follow-up reads per delivered banner row.
      try {
        await Promise.all([
          client.from('conversations').select('type').eq('id', row.conversation_id).maybeSingle(),
          client.from('profiles').select('username, full_name').eq('id', row.sender_id).maybeSingle(),
        ]);
        metrics.count('banner_followup_reads');
      } catch { metrics.count('banner_followup_read_errors'); }
    };
    channels = await Promise.all([
      mkChannel(`notifications:${id}`, [
        { event: 'INSERT', table: 'notifications', filter: `user_id=eq.${id}`, cb: () => onEvent('notification') },
      ]),
      mkChannel(`unread-summary:${id}`, [
        { event: 'INSERT', table: 'notifications', filter: `user_id=eq.${id}`, cb: () => onEvent('unread-insert') },
        { event: 'UPDATE', table: 'notifications', filter: `user_id=eq.${id}`, cb: () => onEvent('unread-update') },
      ]),
      mkChannel(`message-banners:${id}`, [
        { event: 'INSERT', table: 'messages', filter: `sender_id=neq.${id}`, cb: (p) => void bannerHandler(p) },
      ]),
      mkChannel(`my-clubs:${id}`, [
        { event: '*', table: 'club_members', filter: `user_id=eq.${id}`, cb: () => onEvent('my-clubs') },
      ]),
    ]);
  }
  user.channels = channels.filter((c): c is RealtimeChannel => c !== null);
}

async function action(user: ActiveUser, index: number, manifest: ReturnType<typeof readManifest>, metrics: Metrics): Promise<void> {
  const client = user.client;
  const postId = manifest.postIds[index % Math.max(1, manifest.postIds.length)];
  const eventId = manifest.eventIds[index % Math.max(1, manifest.eventIds.length)];
  const clubId = manifest.clubIds[index % Math.max(1, manifest.clubIds.length)];
  const channelId = manifest.channelIds[index % Math.max(1, manifest.channelIds.length)];
  const choices = ['feed-read', 'search', 'club-view', 'event-view', 'rsvp', 'like', 'comment', 'chat'];
  const choice = choices[Math.floor(Math.random() * choices.length)] ?? 'feed-read';
  const started = performance.now();
  try {
    let error: any = null;
    if (choice === 'feed-read') ({ error } = await client.from('posts').select('id, author_id, caption, created_at').eq('post_type', 'picture').order('created_at', { ascending: false }).limit(20));
    if (choice === 'search') ({ error } = await client.from('profiles').select('id, username, full_name').ilike('username', 'lt_%').limit(20));
    if (choice === 'club-view') ({ error } = await client.from('clubs').select('id, name, description, club_members(user_id, role)').eq('id', clubId).single());
    if (choice === 'event-view') ({ error } = await client.from('events').select('id, title, event_date, start_time, end_time, event_rsvps(user_id, status)').eq('id', eventId).single());
    if (choice === 'rsvp') ({ error } = await client.from('event_rsvps').upsert({ event_id: eventId, user_id: user.id, status: 'going' }, { onConflict: 'event_id,user_id' }));
    if (choice === 'like') ({ error } = await client.from('post_likes').upsert({ post_id: postId, user_id: user.id }, { onConflict: 'post_id,user_id' }));
    if (choice === 'comment') ({ error } = await client.from('post_comments').insert({ post_id: postId, user_id: user.id, content: `load-test comment ${Date.now()}-${index}` }));
    if (choice === 'chat') ({ error } = await client.from('messages').insert({ conversation_id: manifest.conversationIds[index % manifest.conversationIds.length], channel_id: channelId, sender_id: user.id, content: `load-test message ${Date.now()}-${index}`, message_type: 'text' }));
    if (error) throw error;
    metrics.add({ name: choice, ms: performance.now() - started, ok: true });
  } catch (error) {
    metrics.add({ name: choice, ms: performance.now() - started, ok: false, errorClass: classifyError(error), meta: { userId: user.id } });
  }
}

// Pre-warm: authenticate every user with bounded retry/backoff, so the
// measurement window only starts once all N are concurrently signed in. The
// hosted GoTrue per-IP verify/token limit is NON-CUSTOMISABLE (Supabase docs),
// so from one machine this must pace itself; a real rollout has N distinct IPs.
async function prewarmSessions(
  config: LoadTestConfig,
  manifest: ReturnType<typeof readManifest>,
  offset: number,
  count: number,
  metrics: Metrics,
  perSigninDelayMs: number,
): Promise<ActiveUser[]> {
  const users: ActiveUser[] = [];
  for (let k = 0; k < count; k += 1) {
    const index = offset + k;
    const id = manifest.userIds[index];
    const email = manifest.emails[index];
    const password = manifest.passwords[index];
    if (!id || !email || !password) throw new Error(`manifest missing user ${index}`);
    let signedIn = false;
    for (let attempt = 0; attempt < 8 && !signedIn; attempt += 1) {
      const client = anonClient(config, `loadtest-active-${id}`);
      const res = await withTimeout(client.auth.signInWithPassword({ email, password }), config.requestTimeoutMs, `signin ${index}`);
      if (!res.error) { users.push({ id, email, password, client, channels: [] }); signedIn = true; break; }
      const status = (res.error as any)?.status;
      metrics.count(`signin_retry_${status ?? 'err'}`);
      if (status === 429) await sleep(2000 + attempt * 3000);
      else await sleep(1000);
    }
    if (!signedIn) { metrics.count('signin_gave_up'); throw new Error(`prewarm: user ${index} could not authenticate after retries`); }
    if (perSigninDelayMs) await sleep(perSigninDelayMs);
  }
  return users;
}

export async function concurrentActive(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const manifest = readManifest(config, typeof args.manifest === 'string' ? args.manifest : undefined);
  const totalUsers = Math.min(Math.floor(argNumber(args, 'users', 50)), manifest.userIds.length);
  const durationMs = argNumber(args, 'duration-ms', 10 * 60_000);
  const dutyMs = Math.max(250, argNumber(args, 'duty-ms', 5_000));
  const perSigninDelayMs = Math.max(0, argNumber(args, 'signin-spacing-ms', 1200));
  const topology: Topology = argString(args, 'topology', 'legacy') === 'reduced' ? 'reduced' : 'legacy';

  // Optional sharding so N OS processes together simulate `users` clients —
  // one Node event loop + one HTTP origin pool cannot faithfully drive 50
  // concurrent websocket clients. `--shard i/N` runs this process's slice.
  const shardArg = argString(args, 'shard', '0/1');
  const [shardIdx, shardCount] = shardArg.split('/').map((n) => Math.max(0, Math.floor(Number(n))));
  const sc = Math.max(1, shardCount || 1);
  const si = Math.min(sc - 1, shardIdx || 0);
  const sliceStart = Math.floor((si * totalUsers) / sc);
  const sliceEnd = Math.floor(((si + 1) * totalUsers) / sc);
  const users = sliceEnd - sliceStart;
  if (users < 1) throw new Error('shard slice is empty; reduce --shard N or raise --users');

  return runScenario(config, 'concurrent-active', async (metrics) => {
    // --- PRE-WARM (not measured): every session must be ready before measurement ---
    const prewarmStart = Date.now();
    const active = await prewarmSessions(config, manifest, sliceStart, users, metrics, perSigninDelayMs);
    if (active.length !== users) throw new Error(`prewarm produced ${active.length}/${users} sessions`);
    metrics.count('prewarm_ms', Date.now() - prewarmStart);

    // --- subscribe every user to the REAL always-on topology (unless disabled for A/B) ---
    const realtimeOff = args['no-realtime'] === true;
    if (!realtimeOff) {
      await Promise.all(active.map((u) => subscribeRealTopology(u, metrics, () => metrics.count('realtime_events'), topology)));
    }
    metrics.count(`topology_${topology}`);
    const channelsUp = active.reduce((n, u) => n + u.channels.length, 0);
    metrics.count('channels_subscribed', channelsUp);
    metrics.count('users_ready', active.length);

    // --- BARRIER: distributed shards align their measurement window on one
    //     absolute wall-clock time so the load is genuinely simultaneous. ---
    const measureAt = Math.floor(argNumber(args, 'measure-at', 0));
    if (measureAt > 0) {
      const waitMs = measureAt * 1000 - Date.now();
      metrics.count('barrier_wait_ms', Math.max(0, waitMs));
      if (waitMs > 0) await sleep(waitMs);
      if (waitMs < -120_000) throw new Error(`measure-at was ${Math.round(-waitMs / 1000)}s in the past — shard missed the window`);
    }

    // --- MEASUREMENT WINDOW ---
    const measureStart = Date.now();
    const until = measureStart + durationMs;
    await Promise.all(active.map(async (user, index) => {
      while (Date.now() < until) {
        await action(user, index, manifest, metrics);
        await sleep(dutyMs);
      }
    }));
    const measuredSeconds = Math.max(1, (Date.now() - measureStart) / 1000);

    // --- teardown (parallel, timeboxed) ---
    await Promise.race([
      Promise.all(active.map(async (user) => {
        try { await user.client.removeAllChannels(); } catch { /* ignore */ }
        try { await user.client.realtime.disconnect(); } catch { /* ignore */ }
        await user.client.auth.signOut().catch(() => {});
      })),
      sleep(20_000),
    ]);

    return {
      details: {
        usersRequested: users,
        usersReady: active.length,
        acceptanceMet: active.length === users,
        prewarmMs: metrics.counters.get('prewarm_ms') ?? 0,
        topology,
        channelsSubscribed: channelsUp,
        channelsExpected: users * (topology === 'reduced' ? 3 : 4),
        durationMs,
        dutyMs,
        realtimeJoins: metrics.counters.get('realtime_joins') ?? 0,
        realtimeEvents: metrics.counters.get('realtime_events') ?? 0,
        realtimeEventRatePerSecond: Number(((metrics.counters.get('realtime_events') ?? 0) / measuredSeconds).toFixed(2)),
        bannerFollowupReads: metrics.counters.get('banner_followup_reads') ?? 0,
        topologyNote: topology === 'reduced'
          ? 'Per user (post-102/103): 2 postgres_changes channels (notifications INSERT+UPDATE user-filtered, my-clubs user-filtered) + 1 private broadcast sync:message-inbox (invalidate + new_message, banner from payload, no follow-up reads).'
          : 'Per user (legacy): 4 postgres_changes channels matching the pre-reduction We Glue session hub (notifications x2 user-filtered, message-banners sender_id!=self broad, my-clubs user-filtered). message-banners handler runs its 2 real follow-up reads.',
      },
    };
  });
}
