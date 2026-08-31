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
//   PART reconnect cold-start channel-join cost for a user in 1/5/10/20 active
//                  conversations (protects Realtime joins/sec on foreground).
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

// --- PART reconnect ----------------------------------------------------------

async function partReconnect(
  config: LoadTestConfig,
  manifest: SeedManifest,
  pool: Session[],
  metrics: any,
  membershipCounts: number[],
  repeats: number,
): Promise<Record<string, unknown>[]> {
  const cases: Record<string, unknown>[] = [];
  const user = pool[0];
  const others = manifest.userIds.slice(1, 60); // padding participants so each conv is "active"
  if (!user) return cases;

  const maxN = Math.max(...membershipCounts);
  const fixtures: Fixture[] = [];
  try {
    for (let i = 0; i < maxN; i += 1) {
      const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 3)}${i}`;
      const parts = [user.id, ...others.slice(0, 49)]; // 50 -> above the provisional threshold
      const fx = await createConversation(config, manifest, parts, runId, `rc${i}`);
      await setActive(config, fx.conversationId, 1, 600);
      fixtures.push(fx);
    }

    for (const n of membershipCounts) {
      const convTopics = fixtures.slice(0, n).map((fx) => `sync:message-inbox-conv:${fx.conversationId}:1`);
      const allTopics = [`sync:message-inbox:${user.id}`, ...convTopics];
      const totals: number[] = [];
      const perJoin: number[] = [];
      let failures = 0;
      for (let rep = 0; rep < repeats; rep += 1) {
        const teardowns: Array<() => Promise<void>> = [];
        const t0 = performance.now();
        for (const topic of allTopics) {
          const res = await subscribe(user, topic, newRecv(), 12_000);
          perJoin.push(res.joinMs);
          if (!res.ok) failures += 1;
          teardowns.push(res.teardown);
        }
        totals.push(performance.now() - t0);
        await Promise.all(teardowns.map((t) => t().catch(() => {})));
        await sleep(800);
      }
      cases.push({
        conversations: n,
        channelsJoined: allTopics.length,
        coldStartP50Ms: percentile(totals, 50),
        coldStartP95Ms: percentile(totals, 95),
        perJoinP50Ms: percentile(perJoin, 50),
        perJoinP95Ms: percentile(perJoin, 95),
        joinFailures: failures,
        repeats,
      });
      metrics.count(`reconnect_${n}`);
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
  const parts = argString(args, 'parts', 'matrix,reconnect,churn').split(',').map((p) => p.trim());
  const sizes = argString(args, 'sizes', '10,50,100,300,500').split(',').map(Number).filter((n) => n >= 2);
  const concurrencies = argString(args, 'concurrency', '1,10,50').split(',').map(Number).filter((n) => n > 0);
  const messagesPerSender = Math.max(1, argNumber(args, 'messages-per-sender', 3));
  const sampleSubs = Math.max(2, argNumber(args, 'sample-subs', 12));
  const poolSize = Math.max(10, argNumber(args, 'pool-size', 80));
  const poolSpacingMs = argNumber(args, 'pool-spacing-ms', 5000);
  const membershipCounts = argString(args, 'membership-counts', '1,5,10,20').split(',').map(Number).filter((n) => n > 0);
  const reconnectRepeats = Math.max(1, argNumber(args, 'reconnect-repeats', 5));

  return runScenario(config, 'hybrid-banner', async (metrics) => {
    const t0 = performance.now();
    const pool = await signInPool(config, manifest, poolSize, poolSpacingMs);
    metrics.count('pool_signed_in', pool.length);
    metrics.add({ name: 'pool-signin', ms: performance.now() - t0, ok: true });

    const details: Record<string, unknown> = { pool: pool.length, parts };
    if (parts.includes('matrix')) {
      details.matrix = await partMatrix(config, manifest, pool, metrics, sizes, concurrencies, messagesPerSender, sampleSubs);
    }
    if (parts.includes('reconnect')) {
      details.reconnect = await partReconnect(config, manifest, pool, metrics, membershipCounts, reconnectRepeats);
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
