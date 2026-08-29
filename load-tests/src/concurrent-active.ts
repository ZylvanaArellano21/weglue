import type { RealtimeChannel } from '@supabase/supabase-js';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError } from './metrics.js';
import { anonClient, withTimeout } from './supabase.js';
import { readManifest } from './seed.js';
import { runScenario, sleep } from './runner.js';

type ActiveUser = { id: string; email: string; password: string; client: ReturnType<typeof anonClient>; channels: RealtimeChannel[] };

// EXACT always-on per-user realtime topology of the real We Glue clients
// (apps/*/lib/hooks + the session hub in providers.tsx / mobile _layout.tsx):
//   notifications:<uid>      notifications INSERT   filter user_id=eq.<uid>
//   unread-summary:<uid>     notifications INSERT + UPDATE  filter user_id=eq.<uid>
//   message-banners:<uid>    messages INSERT  filter sender_id=neq.<uid>   <-- broad
//   my-clubs:<uid>           club_members *  filter user_id=eq.<uid>
// The message-banners handler in the real client then does two follow-up reads
// (conversations + profiles) per delivered row — replicated here as real load.
async function subscribeRealTopology(
  user: ActiveUser,
  metrics: Metrics,
  onEvent: (kind: string) => void,
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

  const bannerHandler = async (payload: any) => {
    onEvent('message-banner');
    const row = payload?.new;
    if (!row || row.deleted_at) return;
    // The real client's two follow-up reads per delivered banner row.
    try {
      await Promise.all([
        client.from('conversations').select('type').eq('id', row.conversation_id).maybeSingle(),
        client.from('profiles').select('username, full_name').eq('id', row.sender_id).maybeSingle(),
      ]);
      metrics.count('banner_followup_reads');
    } catch { metrics.count('banner_followup_read_errors'); }
  };

  const channels = await Promise.all([
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
  count: number,
  metrics: Metrics,
  perSigninDelayMs: number,
): Promise<ActiveUser[]> {
  const users: ActiveUser[] = [];
  for (let index = 0; index < count; index += 1) {
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
  const users = Math.min(Math.floor(argNumber(args, 'users', 50)), manifest.userIds.length);
  const durationMs = argNumber(args, 'duration-ms', 10 * 60_000);
  const dutyMs = Math.max(250, argNumber(args, 'duty-ms', 5_000));
  const perSigninDelayMs = Math.max(0, argNumber(args, 'signin-spacing-ms', 1200));
  if (users < 1) throw new Error('Seed manifest does not contain active users');

  return runScenario(config, 'concurrent-active', async (metrics) => {
    // --- PRE-WARM (not measured): every session must be ready before measurement ---
    const prewarmStart = Date.now();
    const active = await prewarmSessions(config, manifest, users, metrics, perSigninDelayMs);
    if (active.length !== users) throw new Error(`prewarm produced ${active.length}/${users} sessions`);
    metrics.count('prewarm_ms', Date.now() - prewarmStart);

    // --- subscribe every user to the REAL always-on topology ---
    await Promise.all(active.map((u) => subscribeRealTopology(u, metrics, () => metrics.count('realtime_events'))));
    const channelsUp = active.reduce((n, u) => n + u.channels.length, 0);
    metrics.count('channels_subscribed', channelsUp);
    metrics.count('users_ready', active.length);

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
        channelsSubscribed: channelsUp,
        channelsExpected: users * 4,
        durationMs,
        dutyMs,
        realtimeJoins: metrics.counters.get('realtime_joins') ?? 0,
        realtimeEvents: metrics.counters.get('realtime_events') ?? 0,
        realtimeEventRatePerSecond: Number(((metrics.counters.get('realtime_events') ?? 0) / measuredSeconds).toFixed(2)),
        bannerFollowupReads: metrics.counters.get('banner_followup_reads') ?? 0,
        topologyNote: 'Per user: 4 postgres_changes channels matching the real We Glue session hub (notifications x2 user-filtered, message-banners sender_id!=self, my-clubs user-filtered). message-banners handler runs its 2 real follow-up reads.',
      },
    };
  });
}
