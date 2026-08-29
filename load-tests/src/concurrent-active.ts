import type { RealtimeChannel } from '@supabase/supabase-js';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError } from './metrics.js';
import { anonClient, withTimeout } from './supabase.js';
import { readManifest } from './seed.js';
import { runScenario, sleep } from './runner.js';

type ActiveUser = { id: string; email: string; password: string; client: ReturnType<typeof anonClient>; channels: RealtimeChannel[] };

async function subscribe(client: ReturnType<typeof anonClient>, topic: string, metrics: Metrics, onEvent: () => void): Promise<RealtimeChannel | null> {
  return new Promise((resolve) => {
    let settled = false;
    const channel = client.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, onEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onEvent);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') { metrics.count('realtime_joins'); if (!settled) { settled = true; resolve(channel); } }
      else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
        settled = true; metrics.count(`realtime_${status.toLowerCase()}`); resolve(null);
        if (error) metrics.count('realtime_join_errors');
      }
    });
    setTimeout(() => { if (!settled) { settled = true; metrics.count('realtime_join_timeout'); resolve(null); } }, 15_000);
  });
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

export async function concurrentActive(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const manifest = readManifest(config, typeof args.manifest === 'string' ? args.manifest : undefined);
  const users = Math.min(Math.floor(argNumber(args, 'users', 50)), manifest.userIds.length);
  const durationMs = argNumber(args, 'duration-ms', 10 * 60_000);
  const dutyMs = Math.max(250, argNumber(args, 'duty-ms', 5_000));
  const startupConcurrency = Math.max(1, Math.floor(argNumber(args, 'startup-concurrency', 10)));
  if (users < 1) throw new Error('Seed manifest does not contain active users');

  return runScenario(config, 'concurrent-active', async (metrics) => {
    const active: ActiveUser[] = [];
    let cursor = 0;
    const startUser = async (): Promise<void> => {
      while (cursor < users) {
        const index = cursor; cursor += 1;
        const id = manifest.userIds[index];
        const email = manifest.emails[index];
        const password = manifest.passwords[index];
        if (!id || !email || !password) continue;
        const client = anonClient(config, `loadtest-active-${id}`);
        const signedIn = await withTimeout(client.auth.signInWithPassword({ email, password }), config.requestTimeoutMs, `active sign in ${index}`);
        if (signedIn.error) { metrics.count('active_signin_errors'); continue; }
        const channels: RealtimeChannel[] = [];
        for (const topic of [`home:${id}`, `club:${manifest.clubIds[index % manifest.clubIds.length]}:${id}`, `unread:${id}`]) {
          const channel = await subscribe(client, topic, metrics, () => metrics.count('realtime_events'));
          if (channel) channels.push(channel);
        }
        active.push({ id, email, password, client, channels });
      }
    };
    await Promise.all(Array.from({ length: Math.min(startupConcurrency, users) }, () => startUser()));
    metrics.count('active_users_started', active.length);
    const until = Date.now() + durationMs;
    await Promise.all(active.map(async (user, index) => {
      while (Date.now() < until) {
        await action(user, index, manifest, metrics);
        await sleep(dutyMs);
      }
    }));
    for (const user of active) {
      for (const channel of user.channels) await user.client.removeChannel(channel);
      await user.client.auth.signOut().catch(() => {});
    }
    const seconds = Math.max(1, durationMs / 1000);
    return { details: { usersRequested: users, usersStarted: active.length, durationMs, dutyMs, startupConcurrency, realtimeJoins: metrics.counters.get('realtime_joins') ?? 0, realtimeJoinRatePerSecond: Number(((metrics.counters.get('realtime_joins') ?? 0) / seconds).toFixed(2)), realtimeEvents: metrics.counters.get('realtime_events') ?? 0, realtimeEventRatePerSecond: Number(((metrics.counters.get('realtime_events') ?? 0) / seconds).toFixed(2)), resourceNote: 'One Supabase client/websocket and three Realtime channels per active user.' } };
  });
}
