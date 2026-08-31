import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { classifyError, percentile } from './metrics.js';
import { anonClient } from './supabase.js';
import { manifestPath, readManifest, type SeedManifest } from './seed.js';
import { runScenario, sleep } from './runner.js';

// ============================================================================
// hybrid-banner — benchmark + correctness for migration 105 (the hybrid
// conversation foreground-banner design, rev 2).
//
//   PART matrix    steady-state cost of both delivery modes at every size:
//                    per-user   : sync:message-inbox:<uid>          (loop)
//                    conv-scoped : sync:message-inbox-conv:<id>:<e> (one send)
//                  -> the crossover that fixes T.
//   PART ceiling    subscription ceiling: cold join / reconnect / joins-per-sec /
//                  duplicate+leaked channels / auth pressure at 1/5/10/20/50/~95
//                  conv topics per client (free-tier max_channels_per_client=100).
//   PART churn     membership add / single + bulk removal / mute — proves
//                  zero missed banners for retained members, zero leak to a
//                  removed member, one epoch bump per bulk statement, and the
//                  cross-device mute invalidate signal.
//
// A pool of real authenticated sessions is signed in ONCE and reused for every
// case (staging shares one per-IP bucket across signUp+signIn, so repeated
// sign-in is the bottleneck otherwise). Structural fixtures go through the
// Management API postgres role (migration 075 makes service_role SELECT-only).
// Requires SUPABASE_ACCESS_TOKEN.
// ============================================================================

type Session = { id: string; client: ReturnType<typeof anonClient>; token: string; idx: number };
type Fixture = { clubId: string; conversationId: string; channelId: string };

async function mgmt(config: LoadTestConfig, sql: string): Promise<any[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('hybrid-banner requires SUPABASE_ACCESS_TOKEN for fixture setup');
  const res = await fetch(`https://api.supabase.com/v1/projects/${config.stagingRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok || (body && body.message)) {
    throw new Error(`Management API query failed: ${typeof body === 'string' ? body : body.message}`);
  }
  return Array.isArray(body) ? body : [];
}

function lit(ids: string[]): string {
  return ids.map((id) => `'${id}'::uuid`).join(',');
}

// --- session pool ----------------------------------------------------------

async function signInPool(
  config: LoadTestConfig,
  manifest: SeedManifest,
  poolSize: number,
  spacingMs: number,
): Promise<Session[]> {
  const out: Session[] = [];
  for (let i = 0; i < poolSize; i += 1) {
    const id = manifest.userIds[i];
    const email = manifest.emails[i];
    const password = manifest.passwords[i];
    if (!id || !email || !password) throw new Error(`manifest missing user ${i}`);
    let done = false;
    for (let attempt = 0; attempt < 10 && !done; attempt += 1) {
      const client = anonClient(config, `hb-${id}`);
      const res = await client.auth.signInWithPassword({ email, password }).catch((e: any) => ({ error: e, data: { session: null } }));
      if (!res.error && res.data.session) {
        out.push({ id, client, token: res.data.session.access_token, idx: i });
        done = true;
        break;
      }
      const is429 = (res.error as any)?.status === 429;
      await sleep(is429 ? 6000 + attempt * 4000 : 1200);
    }
    if (!done) throw new Error(`hybrid-banner: pool user ${i} could not authenticate`);
    await sleep(spacingMs);
  }
  return out;
}

// --- fixtures -------------------------------------------------------------

async function createConversation(
  config: LoadTestConfig,
  manifest: SeedManifest,
  participantIds: string[],
  runId: string,
  tag: string,
): Promise<Fixture> {
  const rows = await mgmt(config, `
    with club as (
      insert into public.clubs (name, handle, description, university_id, is_seed, is_active)
      values ('LT HB ${tag} ${runId}', 'lt-hb-${tag}-${runId}', 'load test', '${manifest.universityId}'::uuid, true, true)
      returning id
    ),
    conv as (
      insert into public.conversations (type, club_id, name)
      select 'club_group', club.id, 'LT HB ${tag} ${runId}' from club
      returning id, club_id
    ),
    chan as (
      insert into public.conversation_channels (conversation_id, name, display_order, post_permission)
      select conv.id, 'general', 0, 'everyone' from conv
      returning id
    ),
    parts as (
      insert into public.conversation_participants (conversation_id, user_id)
      select conv.id, u.id from conv, unnest(array[${lit(participantIds)}]) as u(id)
      returning 1
    )
    select (select id from club) as club_id,
           (select id from conv) as conversation_id,
           (select id from chan) as channel_id,
           (select count(*) from parts) as part_rows
  `);
  const r = rows[0];
  if (!r?.conversation_id) throw new Error('fixture creation returned no conversation');
  if (Number(r.part_rows) !== participantIds.length) {
    throw new Error(`fixture: inserted ${r.part_rows}/${participantIds.length} participants`);
  }
  return { clubId: r.club_id, conversationId: r.conversation_id, channelId: r.channel_id };
}

async function setActive(config: LoadTestConfig, convId: string, epoch: number, stableSecondsAgo: number): Promise<void> {
  await mgmt(config, `
    update public.conversations
       set banner_broadcast_active = true,
           banner_epoch = ${epoch},
           banner_epoch_changed_at = now() - interval '${stableSecondsAgo} seconds'
     where id = '${convId}'::uuid
  `);
}

async function muteParticipants(config: LoadTestConfig, convId: string, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  await mgmt(config, `
    update public.conversation_participants set muted_at = now()
     where conversation_id = '${convId}'::uuid and user_id = any(array[${lit(userIds)}])
  `);
}

async function dropFixtures(config: LoadTestConfig, fixtures: Fixture[]): Promise<void> {
  for (const fx of fixtures) {
    await mgmt(config, `
      delete from public.messages where conversation_id = '${fx.conversationId}'::uuid;
      delete from public.conversation_participants where conversation_id = '${fx.conversationId}'::uuid;
      delete from public.conversation_channels where conversation_id = '${fx.conversationId}'::uuid;
      delete from public.conversations where id = '${fx.conversationId}'::uuid;
      delete from public.club_members where club_id = '${fx.clubId}'::uuid;
      delete from public.clubs where id = '${fx.clubId}'::uuid;
    `).catch(() => {});
  }
}

// --- realtime subscription ------------------------------------------------

type Recv = { messageIds: Set<string>; count: number; firstAt: number | null; perId: Map<string, number> };

function newRecv(): Recv { return { messageIds: new Set(), count: 0, firstAt: null, perId: new Map() }; }

async function subscribe(
  sess: Session,
  topic: string,
  recv: Recv,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; joinMs: number; teardown: () => Promise<void> }> {
  await sess.client.realtime.setAuth(sess.token);
  const channel = sess.client.channel(topic, { config: { private: true } });
  channel.on('broadcast', { event: 'new_message' }, (msg: any) => {
    const p = msg?.payload ?? {};
    const mid = String(p.message_id ?? '');
    recv.count += 1;
    if (recv.firstAt === null) recv.firstAt = performance.now();
    if (mid) { recv.messageIds.add(mid); recv.perId.set(mid, performance.now()); }
  });
  const t0 = performance.now();
  const ok = await new Promise<boolean>((resolve) => {
    let settled = false;
    channel.subscribe((status: string) => {
      if (settled) return;
      if (status === 'SUBSCRIBED') { settled = true; resolve(true); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { settled = true; resolve(false); }
    });
    setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, timeoutMs);
  });
  const joinMs = performance.now() - t0;
  return { ok, joinMs, teardown: async () => { try { await sess.client.removeChannel(channel); } catch { /* ignore */ } } };
}

// --- PART matrix ---------------------------------------------------------

async function partMatrix(
  config: LoadTestConfig,
  manifest: SeedManifest,
  pool: Session[],
  metrics: any,
  sizes: number[],
  concurrencies: number[],
  messagesPerSender: number,
  sampleSubs: number,
): Promise<Record<string, unknown>[]> {
  const cases: Record<string, unknown>[] = [];
  const poolById = new Map(pool.map((s) => [s.id, s]));

  for (const size of sizes) {
    if (size > manifest.userIds.length) { metrics.count(`skip_size_${size}_manifest`); continue; }
    for (const concurrency of concurrencies) {
      if (concurrency >= size || concurrency > pool.length) { metrics.count(`skip_${size}_${concurrency}`); continue; }
      const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
      const participantIds = manifest.userIds.slice(0, size);
      // pool members who are participants
      const poolParticipants = pool.filter((s) => s.idx < size);
      if (poolParticipants.length < concurrency + 3) { metrics.count(`skip_${size}_${concurrency}_pool`); continue; }

      const senders = poolParticipants.slice(0, concurrency);
      const senderIds = new Set(senders.map((s) => s.id));
      const subs = poolParticipants.filter((s) => !senderIds.has(s.id)).slice(0, sampleSubs);
      const mutedSubs = poolParticipants.filter((s) => !senderIds.has(s.id) && !subs.includes(s)).slice(0, 2);
      const nonParticipant = pool.find((s) => s.idx >= size) ?? null;

      const fx = await createConversation(config, manifest, participantIds, runId, `m${size}x${concurrency}`);
      const teardowns: Array<() => Promise<void>> = [];
      try {
        if (mutedSubs.length) await muteParticipants(config, fx.conversationId, mutedSubs.map((s) => s.id));

        for (const mode of ['per-user', 'conv-scoped'] as const) {
          const epoch = 1;
          if (mode === 'conv-scoped') await setActive(config, fx.conversationId, epoch, 600);
          else await mgmt(config, `update public.conversations set banner_broadcast_active=false where id='${fx.conversationId}'::uuid`);

          const subRecv = new Map<string, Recv>();
          const mutedRecv = new Map<string, Recv>();
          const selfRecv = new Map<string, Recv>();
          const joinSamples: number[] = [];

          const topicFor = (s: Session) => mode === 'conv-scoped'
            ? `sync:message-inbox-conv:${fx.conversationId}:${epoch}`
            : `sync:message-inbox:${s.id}`;

          for (const s of subs) {
            const r = newRecv(); subRecv.set(s.id, r);
            const res = await subscribe(s, topicFor(s), r);
            joinSamples.push(res.joinMs);
            metrics.add({ name: `join-${mode}`, ms: res.joinMs, ok: res.ok, meta: { size, concurrency } });
            if (!res.ok) metrics.count(`join_fail_${mode}_${size}_${concurrency}`);
            teardowns.push(res.teardown);
          }
          for (const s of mutedSubs) {
            const r = newRecv(); mutedRecv.set(s.id, r);
            const res = await subscribe(s, topicFor(s), r);
            teardowns.push(res.teardown);
          }
          for (const s of senders) {
            const r = newRecv(); selfRecv.set(s.id, r);
            const res = await subscribe(s, topicFor(s), r);
            teardowns.push(res.teardown);
          }

          // negative auth: non-participant on the conv topic, and wrong epoch
          let nonParticipantJoined: boolean | null = null;
          let wrongEpochJoined: boolean | null = null;
          if (mode === 'conv-scoped') {
            if (nonParticipant) {
              const rr = await subscribe(nonParticipant, `sync:message-inbox-conv:${fx.conversationId}:${epoch}`, newRecv(), 8000);
              nonParticipantJoined = rr.ok;
              teardowns.push(rr.teardown);
            }
            const anySub = subs[0];
            if (anySub) {
              const rr = await subscribe(anySub, `sync:message-inbox-conv:${fx.conversationId}:${epoch + 999}`, newRecv(), 8000);
              wrongEpochJoined = rr.ok;
              teardowns.push(rr.teardown);
            }
          }

          await sleep(1500);
          const sentAt = new Map<string, number>();
          const startIso = new Date().toISOString();

          await Promise.all(senders.map(async (sender, sIdx) => {
            for (let m = 0; m < messagesPerSender; m += 1) {
              const t0 = performance.now();
              try {
                const { data, error } = await sender.client
                  .from('messages')
                  .insert({ conversation_id: fx.conversationId, channel_id: fx.channelId, sender_id: sender.id, content: `HB:${runId}:${mode}:${sIdx}:${m}`, message_type: 'text' })
                  .select('id')
                  .single();
                if (error) throw error;
                const ins = performance.now() - t0;
                if (data?.id) sentAt.set(String(data.id), performance.now());
                metrics.add({ name: `insert-${mode}`, ms: ins, ok: true, meta: { size, concurrency } });
              } catch (error) {
                metrics.add({ name: `insert-${mode}`, ms: performance.now() - t0, ok: false, errorClass: classifyError(error), meta: { size, concurrency } });
              }
            }
          }));

          await sleep(4000);

          // delivery latency: recv time - send time, per message id, across sample subs
          const deliveryMs: number[] = [];
          for (const [, r] of subRecv) {
            for (const [mid, rt] of r.perId) {
              const st = sentAt.get(mid);
              if (st !== undefined) deliveryMs.push(rt - st);
            }
          }
          const expectedPerMsg = mode === 'per-user' ? (size - 1 - mutedSubs.length) : subs.length;
          const okInserts = metrics.samples.filter((s: any) => s.name === `insert-${mode}` && s.ok && s.meta?.size === size && s.meta?.concurrency === concurrency).map((s: any) => s.ms);

          const rt = await mgmt(config, `
            select
              (select count(*)::int from realtime.messages where topic like 'sync:message-inbox%' and event='new_message' and inserted_at >= '${startIso}') as new_message_rows,
              (select count(*)::int from realtime.messages where topic like 'sync:message-inbox%' and event='invalidate' and inserted_at >= '${startIso}') as invalidate_rows
          `).catch(() => [{}]);

          const subGot = [...subRecv.values()].reduce((a, r) => a + r.count, 0);
          const subDistinct = new Set<string>(); for (const r of subRecv.values()) for (const id of r.messageIds) subDistinct.add(id);
          const mutedGot = [...mutedRecv.values()].reduce((a, r) => a + r.count, 0);
          const selfGot = [...selfRecv.values()].reduce((a, r) => a + r.count, 0);
          // duplicates: a sub receiving the same message id twice
          let dupes = 0; for (const r of subRecv.values()) dupes += (r.count - r.messageIds.size);

          cases.push({
            mode, size, concurrency,
            messagesSent: okInserts.length,
            insertP50: percentile(okInserts, 50),
            insertP95: percentile(okInserts, 95),
            insertP99: percentile(okInserts, 99),
            insertFailures: metrics.samples.filter((s: any) => s.name === `insert-${mode}` && !s.ok && s.meta?.size === size && s.meta?.concurrency === concurrency).length,
            joinP50: percentile(joinSamples, 50),
            joinP95: percentile(joinSamples, 95),
            deliveryP50: percentile(deliveryMs, 50),
            deliveryP95: percentile(deliveryMs, 95),
            deliverySamples: deliveryMs.length,
            sampleSubs: subs.length,
            expectedPerMessage: expectedPerMsg,
            subBannersReceived: subGot,
            subExpectedTotal: expectedPerMsg > 0 ? subs.length * okInserts.length : 0,
            duplicateBanners: dupes,
            mutedSubBannersReceived: mutedGot,   // per-user: MUST be 0; conv: >0 expected (client filters)
            senderSelfBannersReceived: selfGot,  // per-user: MUST be 0; conv: >0 expected (client filters)
            nonParticipantJoinedConvTopic: nonParticipantJoined, // MUST be false
            wrongEpochJoined,                                     // MUST be false
            realtimeNewMessageRows: Number(rt[0]?.new_message_rows ?? 0),
            realtimeInvalidateRows: Number(rt[0]?.invalidate_rows ?? 0),
          });
          metrics.count(`case_${mode}_${size}_${concurrency}`);

          await Promise.all(teardowns.splice(0).map((t) => t().catch(() => {})));
          await mgmt(config, `delete from public.messages where conversation_id='${fx.conversationId}'::uuid`).catch(() => {});
          await sleep(500);
        }
      } finally {
        await Promise.all(teardowns.map((t) => t().catch(() => {})));
        await dropFixtures(config, [fx]);
      }
    }
  }
  return cases;
}

// --- PART ceiling — subscription ceiling: 1/5/10/20/50/~95 conv topics/client -

async function pgActivity(config: LoadTestConfig): Promise<{ conns: number; active: number; waiting: number; authr: number }> {
  const r = await mgmt(config, `
    select
      (select count(*)::int from pg_stat_activity where datname = current_database()) as conns,
      (select count(*)::int from pg_stat_activity where datname = current_database() and state = 'active') as active,
      (select count(*)::int from pg_stat_activity where datname = current_database() and wait_event is not null) as waiting,
      (select count(*)::int from pg_stat_activity where datname = current_database() and usename = 'authenticator') as authr
  `).catch(() => [{}]);
  return { conns: Number(r[0]?.conns ?? 0), active: Number(r[0]?.active ?? 0), waiting: Number(r[0]?.waiting ?? 0), authr: Number(r[0]?.authr ?? 0) };
}

async function partCeiling(
  config: LoadTestConfig,
  manifest: SeedManifest,
  pool: Session[],
  metrics: any,
  counts: number[],
  repeats: number,
): Promise<Record<string, unknown>[]> {
  const cases: Record<string, unknown>[] = [];
  const user = pool[0];
  const others = manifest.userIds.slice(1, 60);
  if (!user) return cases;

  const maxN = Math.max(...counts);
  const fixtures: Fixture[] = [];
  try {
    for (let i = 0; i < maxN; i += 1) {
      const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 3)}${i}`;
      const parts = [user.id, ...others.slice(0, 49)]; // 50 participants -> auto-activates at T=50
      const fx = await createConversation(config, manifest, parts, runId, `cl${i}`);
      await setActive(config, fx.conversationId, 1, 600);
      fixtures.push(fx);
    }

    for (const n of counts) {
      const convTopics = fixtures.slice(0, n).map((fx) => `sync:message-inbox-conv:${fx.conversationId}:1`);
      const allTopics = [`sync:message-inbox:${user.id}`, ...convTopics];

      const coldTotals: number[] = [];
      const coldPerJoin: number[] = [];
      const reconnectTotals: number[] = [];
      const parallelJoinsPerSec: number[] = [];
      let coldFailures = 0;
      let reconnectFailures = 0;
      let leakedChannels = 0;
      let duplicateChannels = 0;
      const authPressure: Record<string, number>[] = [];

      for (let rep = 0; rep < repeats; rep += 1) {
        await user.client.realtime.setAuth(user.token);

        // (a) COLD JOIN — sequential
        const teardowns: Array<() => Promise<void>> = [];
        const c0 = performance.now();
        for (const topic of allTopics) {
          const res = await subscribe(user, topic, newRecv(), 15_000);
          coldPerJoin.push(res.joinMs);
          if (!res.ok) coldFailures += 1;
          teardowns.push(res.teardown);
        }
        coldTotals.push(performance.now() - c0);

        // channel accounting: how many channels does the client hold now?
        const held = (user.client.getChannels?.() ?? []).length;
        if (held > allTopics.length) duplicateChannels += held - allTopics.length;

        // (b) RECONNECT — drop the socket, let realtime-js auto-rejoin all channels
        const beforeAct = await pgActivity(config);
        const r0 = performance.now();
        try { user.client.realtime.disconnect(); } catch { /* ignore */ }
        await sleep(400);
        try { user.client.realtime.connect(); } catch { /* ignore */ }
        // wait until every channel is joined again, or timeout
        const rejoinDeadline = performance.now() + 20_000;
        let joinedBack = 0;
        while (performance.now() < rejoinDeadline) {
          joinedBack = (user.client.getChannels?.() ?? []).filter((ch: any) => ch.state === 'joined').length;
          if (joinedBack >= allTopics.length) break;
          await sleep(250);
        }
        reconnectTotals.push(performance.now() - r0);
        if (joinedBack < allTopics.length) reconnectFailures += allTopics.length - joinedBack;
        const duringAct = await pgActivity(config);
        authPressure.push({ connsBefore: beforeAct.conns, connsDuring: duringAct.conns, activeDuring: duringAct.active, waitingDuring: duringAct.waiting });

        // (c) PARALLEL JOIN burst -> joins/sec (fresh client to avoid instance reuse)
        const burstClient = anonClient(config, `hb-burst-${user.id}-${rep}`);
        await burstClient.realtime.setAuth(user.token);
        const p0 = performance.now();
        const results = await Promise.all(allTopics.map((topic) => new Promise<boolean>((resolve) => {
          const ch = burstClient.channel(topic, { config: { private: true } });
          let settled = false;
          ch.subscribe((st: string) => { if (!settled && (st === 'SUBSCRIBED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT')) { settled = true; resolve(st === 'SUBSCRIBED'); } });
          setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 15_000);
        })));
        const burstSec = (performance.now() - p0) / 1000;
        const okJoins = results.filter(Boolean).length;
        parallelJoinsPerSec.push(okJoins / Math.max(0.001, burstSec));
        try { await burstClient.removeAllChannels(); await burstClient.realtime.disconnect(); } catch { /* ignore */ }

        // teardown + leak check
        await Promise.all(teardowns.map((t) => t().catch(() => {})));
        await sleep(300);
        const remaining = (user.client.getChannels?.() ?? []).length;
        leakedChannels = Math.max(leakedChannels, remaining);
        if (remaining) { try { await user.client.removeAllChannels(); } catch { /* ignore */ } }
        await sleep(700);
      }

      cases.push({
        conversations: n,
        channelsTotal: allTopics.length,
        coldJoinP50Ms: percentile(coldTotals, 50),
        coldJoinP95Ms: percentile(coldTotals, 95),
        perChannelJoinP50Ms: percentile(coldPerJoin, 50),
        perChannelJoinP95Ms: percentile(coldPerJoin, 95),
        reconnectP50Ms: percentile(reconnectTotals, 50),
        reconnectP95Ms: percentile(reconnectTotals, 95),
        parallelJoinsPerSecP50: Number(percentile(parallelJoinsPerSec, 50).toFixed(1)),
        coldJoinFailures: coldFailures,
        reconnectFailures,
        duplicateChannels,     // MUST be 0
        leakedChannelsAfterTeardown: leakedChannels, // MUST be 0
        authPressure: authPressure[authPressure.length - 1] ?? null,
        repeats,
      });
      metrics.count(`ceiling_${n}`);
    }
  } finally {
    await dropFixtures(config, fixtures);
  }
  return cases;
}

// --- PART churn ------------------------------------------------------------

async function partChurn(
  config: LoadTestConfig,
  manifest: SeedManifest,
  pool: Session[],
  metrics: any,
): Promise<Record<string, unknown>> {
  const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const poolParts = pool.slice(0, 12);
  const padIds = manifest.userIds.slice(pool.length, pool.length + 90);
  const allParts = [...poolParts.map((s) => s.id), ...padIds];
  const fx = await createConversation(config, manifest, allParts, runId, 'churn');
  const teardowns: Array<() => Promise<void>> = [];
  const out: Record<string, unknown> = {};

  try {
    await setActive(config, fx.conversationId, 1, 600); // stable, epoch 1

    const sender = poolParts[0]!;
    const victim = poolParts[1]!;
    const retained = poolParts.slice(2, 7);

    // everyone subscribes to conv epoch 1; retained also to their per-user topic
    const victimConv = newRecv();
    const vRes = await subscribe(victim, `sync:message-inbox-conv:${fx.conversationId}:1`, victimConv);
    teardowns.push(vRes.teardown);
    const retainedConv = new Map<string, Recv>();
    const retainedInbox = new Map<string, Recv>();
    for (const s of retained) {
      const rc = newRecv(); retainedConv.set(s.id, rc);
      const ri = newRecv(); retainedInbox.set(s.id, ri);
      teardowns.push((await subscribe(s, `sync:message-inbox-conv:${fx.conversationId}:1`, rc)).teardown);
      teardowns.push((await subscribe(s, `sync:message-inbox:${s.id}`, ri)).teardown);
    }
    await sleep(1500);

    const post = async (marker: string): Promise<string | null> => {
      const { data, error } = await sender.client.from('messages')
        .insert({ conversation_id: fx.conversationId, channel_id: fx.channelId, sender_id: sender.id, content: `HBCHURN:${marker}`, message_type: 'text' })
        .select('id').single();
      if (error) { metrics.count(`churn_post_fail`); return null; }
      return String(data!.id);
    };

    // baseline: a message on epoch 1, everyone should get it
    const m0 = await post('pre');
    await sleep(2500);
    out.preRemoval = {
      victimGot: m0 ? victimConv.messageIds.has(m0) : null,
      retainedGotConv: [...retainedConv.values()].every((r) => m0 && r.messageIds.has(m0)),
    };

    // --- single removal -> epoch bump + grace ---
    const epochBefore = Number((await mgmt(config, `select banner_epoch from public.conversations where id='${fx.conversationId}'::uuid`))[0].banner_epoch);
    await mgmt(config, `delete from public.conversation_participants where conversation_id='${fx.conversationId}'::uuid and user_id='${victim.id}'::uuid`);
    await sleep(500);
    const convRow = (await mgmt(config, `select banner_epoch, banner_broadcast_active, extract(epoch from (now()-banner_epoch_changed_at)) as age from public.conversations where id='${fx.conversationId}'::uuid`))[0];
    const epochAfter = Number(convRow.banner_epoch);

    // during grace: messages should reach retained members via per-user topic and NOT the victim
    const victimBefore = victimConv.count;
    const graceMsgs: string[] = [];
    for (let i = 0; i < 4; i += 1) { const id = await post(`grace${i}`); if (id) graceMsgs.push(id); await sleep(1200); }
    await sleep(2500);

    const victimLeaked = victimConv.count - victimBefore;
    const retainedMissedDuringGrace = graceMsgs.filter((mid) =>
      [...retained].some((s) => !retainedInbox.get(s.id)!.messageIds.has(mid) && !retainedConv.get(s.id)!.messageIds.has(mid)),
    ).length;

    // victim tries to follow to the new epoch -> must fail auth
    const victimFollow = await subscribe(victim, `sync:message-inbox-conv:${fx.conversationId}:${epochAfter}`, newRecv(), 8000);
    teardowns.push(victimFollow.teardown);

    // retained resubscribe to new epoch (simulating the getMyChats refetch)
    const retainedNewConv = new Map<string, Recv>();
    for (const s of retained) {
      const rc = newRecv(); retainedNewConv.set(s.id, rc);
      teardowns.push((await subscribe(s, `sync:message-inbox-conv:${fx.conversationId}:${epochAfter}`, rc)).teardown);
    }
    // wait out the grace window, then post again -> should arrive on the new epoch topic
    const graceSeconds = Number((await mgmt(config, `select (value#>>'{}')::int v from public.notification_config where key='banner.epoch_grace_seconds'`))[0].v);
    await sleep(Math.min(graceSeconds, 95) * 1000 + 3000);
    const postGrace = await post('post-grace');
    await sleep(3000);

    out.singleRemoval = {
      epochBumped: epochAfter === epochBefore + 1,
      stillActive: convRow.banner_broadcast_active === true,
      graceWindowReset: Number(convRow.age) < 5,
      victimLeakedDuringGrace: victimLeaked,          // MUST be 0
      retainedMissedDuringGrace,                      // MUST be 0
      victimCanJoinNewEpoch: victimFollow.ok,         // MUST be false
      retainedGotPostGraceOnNewEpoch: postGrace ? [...retainedNewConv.values()].every((r) => r.messageIds.has(postGrace)) : null,
      victimGotPostGrace: postGrace ? victimConv.messageIds.has(postGrace) : null, // MUST be false
    };

    // --- bulk removal -> ONE epoch bump for the statement ---
    const epochPreBulk = Number((await mgmt(config, `select banner_epoch from public.conversations where id='${fx.conversationId}'::uuid`))[0].banner_epoch);
    await mgmt(config, `delete from public.conversation_participants where conversation_id='${fx.conversationId}'::uuid and user_id = any(array[${lit(padIds.slice(0, 40))}])`);
    await sleep(800);
    const epochPostBulk = Number((await mgmt(config, `select banner_epoch from public.conversations where id='${fx.conversationId}'::uuid`))[0].banner_epoch);
    out.bulkRemoval = {
      participantsRemoved: 40,
      epochDelta: epochPostBulk - epochPreBulk,       // MUST be 1
    };

    // --- mute: cross-device invalidate signal ---
    const muteWatcher = poolParts[7]!;
    const muteInbox = newRecv();
    // count invalidate events on the per-user topic
    await muteWatcher.client.realtime.setAuth(muteWatcher.token);
    const mch = muteWatcher.client.channel(`sync:message-inbox:${muteWatcher.id}`, { config: { private: true } });
    let inboxInvalidates = 0;
    mch.on('broadcast', { event: 'invalidate' }, () => { inboxInvalidates += 1; });
    await new Promise<void>((r) => { mch.subscribe((s: string) => { if (s === 'SUBSCRIBED') r(); }); setTimeout(r, 10_000); });
    teardowns.push(async () => { try { await muteWatcher.client.removeChannel(mch); } catch { /* ignore */ } });
    await sleep(1000);
    const before = inboxInvalidates;
    await mgmt(config, `update public.conversation_participants set muted_at = now() where conversation_id='${fx.conversationId}'::uuid and user_id='${muteWatcher.id}'::uuid`);
    await sleep(2500);
    const afterMute = inboxInvalidates;
    await mgmt(config, `update public.conversation_participants set muted_at = null where conversation_id='${fx.conversationId}'::uuid and user_id='${muteWatcher.id}'::uuid`);
    await sleep(2500);
    const afterUnmute = inboxInvalidates;
    out.mute = {
      invalidateOnMute: afterMute - before,     // MUST be >= 1
      invalidateOnUnmute: afterUnmute - afterMute, // MUST be >= 1
    };

    // --- natural activation: a fresh conv crossing the threshold on join ---
    const naId = `${Date.now().toString(36)}na`;
    const threshold = Number((await mgmt(config, `select (value#>>'{}')::int v from public.notification_config where key='banner.broadcast_threshold'`))[0].v);
    const belowIds = manifest.userIds.slice(0, threshold - 1);
    const naFx = await createConversation(config, manifest, belowIds, naId, 'na');
    const naBefore = (await mgmt(config, `select banner_broadcast_active a, banner_epoch e from public.conversations where id='${naFx.conversationId}'::uuid`))[0];
    await mgmt(config, `insert into public.conversation_participants (conversation_id, user_id) values ('${naFx.conversationId}'::uuid, '${manifest.userIds[threshold - 1]}'::uuid)`);
    await sleep(600);
    const naAfter = (await mgmt(config, `select banner_broadcast_active a, banner_epoch e from public.conversations where id='${naFx.conversationId}'::uuid`))[0];
    out.naturalActivation = {
      threshold,
      wasActiveBelow: naBefore.a === true,        // MUST be false
      activeAfterCrossing: naAfter.a === true,    // MUST be true
      epochWentToOne: Number(naAfter.e) === Number(naBefore.e) + 1,
    };
    await dropFixtures(config, [naFx]);

    return out;
  } finally {
    await Promise.all(teardowns.map((t) => t().catch(() => {})));
    await dropFixtures(config, [fx]);
  }
}

// --- entry ---------------------------------------------------------------

export async function hybridBanner(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const namespace = argString(args, 'namespace', config.seedNamespace);
  const manifest = readManifest(config, argString(args, 'manifest', manifestPath(config, namespace, argNumber(args, 'manifest-size', 500))));
  const parts = argString(args, 'parts', 'matrix,ceiling,churn').split(',').map((p) => p.trim());
  const sizes = argString(args, 'sizes', '10,50,100,300,500').split(',').map(Number).filter((n) => n >= 2);
  const concurrencies = argString(args, 'concurrency', '1,10,50').split(',').map(Number).filter((n) => n > 0);
  const messagesPerSender = Math.max(1, argNumber(args, 'messages-per-sender', 3));
  const sampleSubs = Math.max(2, argNumber(args, 'sample-subs', 12));
  const poolSize = Math.max(10, argNumber(args, 'pool-size', 80));
  const poolSpacingMs = argNumber(args, 'pool-spacing-ms', 5000);
  const ceilingCounts = argString(args, 'ceiling-counts', '1,5,10,20,50,95').split(',').map(Number).filter((n) => n > 0);
  const ceilingRepeats = Math.max(1, argNumber(args, 'ceiling-repeats', 4));

  return runScenario(config, 'hybrid-banner', async (metrics) => {
    const t0 = performance.now();
    const pool = await signInPool(config, manifest, poolSize, poolSpacingMs);
    metrics.count('pool_signed_in', pool.length);
    metrics.add({ name: 'pool-signin', ms: performance.now() - t0, ok: true });

    const details: Record<string, unknown> = { pool: pool.length, parts };
    if (parts.includes('matrix')) {
      details.matrix = await partMatrix(config, manifest, pool, metrics, sizes, concurrencies, messagesPerSender, sampleSubs);
    }
    if (parts.includes('ceiling')) {
      details.ceiling = await partCeiling(config, manifest, pool, metrics, ceilingCounts, ceilingRepeats);
    }
    if (parts.includes('churn')) {
      details.churn = await partChurn(config, manifest, pool, metrics);
    }

    details.passCriteria = {
      perUser_zeroMutedBanner: 'matrix per-user rows: mutedSubBannersReceived === 0',
      perUser_zeroSelfBanner: 'matrix per-user rows: senderSelfBannersReceived === 0',
      conv_zeroNonParticipant: 'matrix conv rows: nonParticipantJoinedConvTopic === false && wrongEpochJoined === false',
      zeroDuplicates: 'all matrix rows: duplicateBanners === 0',
      churn_zeroVictimLeak: 'churn.singleRemoval.victimLeakedDuringGrace === 0 && victimGotPostGrace === false && victimCanJoinNewEpoch === false',
      churn_zeroRetainedMiss: 'churn.singleRemoval.retainedMissedDuringGrace === 0',
      churn_bulkOneEpoch: 'churn.bulkRemoval.epochDelta === 1',
      churn_muteSignal: 'churn.mute.invalidateOnMute >= 1 && invalidateOnUnmute >= 1',
      T: 'smallest size where conv-scoped insertP95 @10x is materially below per-user AND < 800ms',
    };
    return { details };
  });
}
