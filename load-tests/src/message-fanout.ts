import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError, percentile } from './metrics.js';
import { anonClient, withTimeout } from './supabase.js';
import { manifestPath, readManifest, type SeedManifest } from './seed.js';
import { runScenario, sleep } from './runner.js';

// ============================================================================
// message-fanout — cost of migration 103's synchronous per-recipient
// realtime.send('new_message', 'sync:message-inbox:<uid>', true) loop, which
// runs INSIDE the message INSERT statement (AFTER INSERT trigger handle_message_push).
//
// PRE-103 this scenario's message-send p95 IS the baseline: the old cost was a
// broad client-side `messages` INSERT subscription, never in the INSERT.
// POST-103 the INSERT carries up to (participants - 1 - muted) realtime.send
// calls. Run this before and after 103 is applied and diff.
//
// Structural fixtures (club, conversation, everyone-channel, participants) are
// created through the Supabase Management API `/database/query` (postgres role)
// because migration 075 makes service_role SELECT-only on all of these tables.
// Requires SUPABASE_ACCESS_TOKEN in the environment.
// ============================================================================

type Fixture = { clubId: string; conversationId: string; channelId: string; mutedUserIds: string[] };

async function mgmt(config: LoadTestConfig, sql: string): Promise<any[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('message-fanout requires SUPABASE_ACCESS_TOKEN for Management API fixture setup');
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

async function createFixture(
  config: LoadTestConfig,
  manifest: SeedManifest,
  participantCount: number,
  mutedCount: number,
  runId: string,
): Promise<Fixture> {
  const participantIds = manifest.userIds.slice(0, participantCount);
  if (participantIds.length < participantCount) {
    throw new Error(`manifest has ${participantIds.length} users, need ${participantCount}`);
  }
  // Mute participants in the MIDDLE of the list so they never overlap the
  // senders (which are the last `concurrency` participants).
  const midStart = Math.max(1, Math.floor(participantCount / 3));
  const mutedUserIds = participantIds.slice(midStart, midStart + Math.min(mutedCount, Math.max(0, participantCount - 2)));

  const rows = await mgmt(config, `
    with club as (
      insert into public.clubs (name, handle, description, university_id, is_seed, is_active)
      values ('LT MsgFanout ${runId}', 'lt-msgfanout-${runId}', 'load test', '${manifest.universityId}'::uuid, true, true)
      returning id
    ),
    conv as (
      insert into public.conversations (type, club_id, name)
      select 'club_group', club.id, 'LT MsgFanout ${runId}' from club
      returning id, club_id
    ),
    chan as (
      insert into public.conversation_channels (conversation_id, name, display_order, post_permission)
      select conv.id, 'general', 0, 'everyone' from conv
      returning id, conversation_id
    ),
    parts as (
      insert into public.conversation_participants (conversation_id, user_id)
      select conv.id, u.id from conv, unnest(array[${lit(participantIds)}]) as u(id)
      returning 1
    )
    -- No club_members insert: can_post_in_channel('everyone') only checks
    -- is_conversation_participant, and handle_message_push's recipients come from
    -- conversation_participants. A bulk club_members insert fires handle_club_join
    -- per row (O(N^2) member_joined fan-out) and times out at N=500.
    select (select id from club) as club_id,
           (select id from conv) as conversation_id,
           (select id from chan) as channel_id,
           (select count(*) from parts) as part_rows
  `);
  const r = rows[0];
  if (!r?.conversation_id) throw new Error('fixture creation returned no conversation');

  // Apply mutes in a SEPARATE statement — a data-modifying CTE cannot see rows
  // another CTE in the same statement just inserted.
  let mutedApplied = 0;
  if (mutedUserIds.length) {
    const m = await mgmt(config, `
      update public.conversation_participants set muted_at = now()
      where conversation_id = '${r.conversation_id}'::uuid
        and user_id = any(array[${lit(mutedUserIds)}])
      returning user_id
    `);
    mutedApplied = m.length;
  }
  if (mutedApplied !== mutedUserIds.length) {
    throw new Error(`fixture: muted ${mutedApplied}/${mutedUserIds.length} participants`);
  }
  return { clubId: r.club_id, conversationId: r.conversation_id, channelId: r.channel_id, mutedUserIds };
}

async function dropFixture(config: LoadTestConfig, fx: Fixture): Promise<void> {
  await mgmt(config, `
    delete from public.messages where conversation_id = '${fx.conversationId}'::uuid;
    delete from public.conversation_participants where conversation_id = '${fx.conversationId}'::uuid;
    delete from public.conversation_channels where conversation_id = '${fx.conversationId}'::uuid;
    delete from public.conversations where id = '${fx.conversationId}'::uuid;
    delete from public.club_members where club_id = '${fx.clubId}'::uuid;
    delete from public.clubs where id = '${fx.clubId}'::uuid;
  `).catch(() => {});
}

async function signIn(
  config: LoadTestConfig,
  manifest: SeedManifest,
  userIndexes: number[],
): Promise<Array<{ id: string; client: ReturnType<typeof anonClient>; token: string }>> {
  const out: Array<{ id: string; client: ReturnType<typeof anonClient>; token: string }> = [];
  for (const i of userIndexes) {
    const id = manifest.userIds[i];
    const email = manifest.emails[i];
    const password = manifest.passwords[i];
    if (!id || !email || !password) throw new Error(`manifest missing user ${i}`);
    let done = false;
    for (let attempt = 0; attempt < 8 && !done; attempt += 1) {
      const client = anonClient(config, `loadtest-msg-${id}`);
      const res = await withTimeout(client.auth.signInWithPassword({ email, password }), config.requestTimeoutMs, `msg signin ${i}`);
      if (!res.error && res.data.session) {
        out.push({ id, client, token: res.data.session.access_token });
        done = true;
        break;
      }
      await sleep((res.error as any)?.status === 429 ? 2500 + attempt * 3000 : 800);
    }
    if (!done) throw new Error(`message-fanout: user ${i} could not authenticate`);
    await sleep(300);
  }
  return out;
}

type BannerCount = { newMessage: number; invalidate: number; selfBanner: number };

async function subscribeInbox(
  sub: { id: string; client: ReturnType<typeof anonClient>; token: string },
  counts: BannerCount,
): Promise<() => Promise<void>> {
  await sub.client.realtime.setAuth(sub.token);
  const channel = sub.client.channel(`sync:message-inbox:${sub.id}`, { config: { private: true } });
  channel.on('broadcast', { event: 'new_message' }, (msg: any) => {
    counts.newMessage += 1;
    const p = msg?.payload ?? {};
    if (p.sender_id === sub.id) counts.selfBanner += 1;
  });
  channel.on('broadcast', { event: 'invalidate' }, () => { counts.invalidate += 1; });
  await new Promise<void>((resolve) => {
    channel.subscribe((status: string) => { if (status === 'SUBSCRIBED') resolve(); });
    setTimeout(resolve, 10_000);
  });
  return async () => { try { await sub.client.removeChannel(channel); } catch { /* ignore */ } };
}

export async function messageFanout(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const namespace = argString(args, 'namespace', config.seedNamespace);
  const manifest = readManifest(config, argString(args, 'manifest', manifestPath(config, namespace, argNumber(args, 'manifest-size', 500))));
  const sizes = argString(args, 'sizes', '2,25,100,300,500').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 2);
  const concurrencies = argString(args, 'concurrency', '1,10,50').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const messagesPerSender = Math.max(1, argNumber(args, 'messages-per-sender', 1));
  const mutedCount = Math.max(0, argNumber(args, 'muted', 2));
  const sampleRecipients = Math.max(0, argNumber(args, 'sample-recipients', 15));
  const drainWaitMs = argNumber(args, 'drain-wait-ms', 4000);
  const guidanceP95Ms = argNumber(args, 'guidance-p95-ms', 3000);

  return runScenario(config, 'message-fanout', async (metrics) => {
    const cases: Record<string, unknown>[] = [];

    for (const size of sizes) {
      for (const concurrency of concurrencies) {
        if (concurrency >= size) { metrics.count(`skip_${size}_${concurrency}`); continue; }
        const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
        const sampleName = `msg-send-${size}-${concurrency}`;
        const fx = await createFixture(config, manifest, size, mutedCount, runId);
        const counts: BannerCount = { newMessage: 0, invalidate: 0, selfBanner: 0 };
        const unsubscribers: Array<() => Promise<void>> = [];
        let sendersSignedIn = 0;

        try {
          // senders = last `concurrency` participants; recipients sampled from the rest
          const senderIdx = Array.from({ length: concurrency }, (_, k) => size - 1 - k);
          const senders = await signIn(config, manifest, senderIdx);
          sendersSignedIn = senders.length;

          const nMuted = fx.mutedUserIds.length;
          const recipientIdxAll = Array.from({ length: size }, (_, k) => k)
            .filter((k) => !senderIdx.includes(k))
            .filter((k) => !fx.mutedUserIds.includes(manifest.userIds[k]!));
          const recipientIdx = recipientIdxAll.slice(0, sampleRecipients);
          const mutedRecipientIdx = fx.mutedUserIds
            .map((id) => manifest.userIds.indexOf(id))
            .filter((k) => k >= 0)
            .slice(0, Math.max(1, Math.min(2, nMuted)));

          const recipients = await signIn(config, manifest, [...recipientIdx, ...mutedRecipientIdx]);
          const mutedSampleIds = new Set(fx.mutedUserIds);
          let mutedBannerLeak = 0;
          for (const r of recipients) {
            const isMuted = mutedSampleIds.has(r.id);
            if (isMuted) {
              await r.client.realtime.setAuth(r.token);
              const ch = r.client.channel(`sync:message-inbox:${r.id}`, { config: { private: true } });
              ch.on('broadcast', { event: 'new_message' }, () => { mutedBannerLeak += 1; });
              await new Promise<void>((resolve) => { ch.subscribe((s: string) => { if (s === 'SUBSCRIBED') resolve(); }); setTimeout(resolve, 10_000); });
              unsubscribers.push(async () => { try { await r.client.removeChannel(ch); } catch { /* ignore */ } });
            } else {
              unsubscribers.push(await subscribeInbox(r, counts));
            }
          }
          await sleep(1500); // let subscriptions settle

          const expectedPerMessage = size - 1 - nMuted;
          const totalMessages = concurrency * messagesPerSender;
          const startedAt = new Date();

          await Promise.all(senders.map(async (sender, sIdx) => {
            for (let m = 0; m < messagesPerSender; m += 1) {
              const t0 = performance.now();
              try {
                const { error } = await withTimeout(
                  sender.client.from('messages').insert({
                    conversation_id: fx.conversationId,
                    channel_id: fx.channelId,
                    sender_id: sender.id,
                    content: `LOADTEST:MSG:${runId}:${sIdx}:${m}`,
                    message_type: 'text',
                  }),
                  config.requestTimeoutMs,
                  `msg ${size}/${concurrency}/${sIdx}/${m}`,
                );
                if (error) throw error;
                metrics.add({ name: sampleName, ms: performance.now() - t0, ok: true, meta: { size, concurrency } });
              } catch (error) {
                metrics.add({ name: sampleName, ms: performance.now() - t0, ok: false, errorClass: classifyError(error), meta: { size, concurrency } });
              }
            }
          }));

          await sleep(drainWaitMs);

          // Server-side truth. realtime.messages payloads don't carry the
          // content marker, so this is a topic+time-window count — run the
          // scenario on an otherwise-idle staging project.
          const rtWindow = await mgmt(config, `
            select
              (select count(*)::int from realtime.messages
                 where topic like 'sync:message-inbox:%' and event = 'new_message'
                   and inserted_at >= '${startedAt.toISOString()}') as new_message_rows,
              (select count(*)::int from realtime.messages
                 where topic like 'sync:message-inbox:%' and event = 'invalidate'
                   and inserted_at >= '${startedAt.toISOString()}') as invalidate_rows,
              (select count(*)::int from public.messages
                 where conversation_id = '${fx.conversationId}'::uuid) as message_rows
          `).catch(() => [] as any[]);

          const samples = metrics.samples.filter((s) => s.name === sampleName);
          const okSamples = samples.filter((s) => s.ok).map((s) => s.ms);
          const w = rtWindow[0] ?? {};
          const sendP95 = percentile(okSamples, 95);
          const messageRows = Number(w.message_rows ?? 0);
          const newMessageRows = Number(w.new_message_rows ?? 0);
          cases.push({
            participants: size,
            concurrency,
            messagesPerSender,
            mutedParticipants: nMuted,
            sendersSignedIn,
            sendsAttempted: totalMessages,
            sendsOk: okSamples.length,
            sendsFailed: samples.length - okSamples.length,
            sendP50Ms: percentile(okSamples, 50),
            sendP95Ms: sendP95,
            sendP99Ms: percentile(okSamples, 99),
            expectedNewMessagePerMessage: expectedPerMessage,
            expectedNewMessageTotal: expectedPerMessage * okSamples.length,
            realtimeNewMessageRowsWindow: newMessageRows,
            realtimeInvalidateRowsWindow: Number(w.invalidate_rows ?? 0),
            messageRowsInConversation: messageRows,
            sampleRecipientsSubscribed: recipientIdx.length,
            sampleNewMessageReceived: counts.newMessage,
            sampleInvalidateReceived: counts.invalidate,
            selfBannerLeak: counts.selfBanner,
            mutedBannerLeak,
            withinGuidanceP95: sendP95 <= guidanceP95Ms,
            errorClasses: metrics.errorClasses(sampleName),
          });
          metrics.count(`case_${size}_${concurrency}`);
        } finally {
          await Promise.all(unsubscribers.map((u) => u().catch(() => {})));
          await dropFixture(config, fx);
        }
      }
    }

    const maxCase = cases.find((c) => c.participants === Math.max(...sizes) && c.concurrency === Math.max(...concurrencies));
    return {
      details: {
        sizes,
        concurrencies,
        messagesPerSender,
        guidanceP95Ms,
        cases,
        maxScenario: maxCase ?? null,
        note: 'PRE-103 send p95 is the baseline (old cost was a client subscription, not in the INSERT). POST-103 the INSERT carries the per-recipient realtime.send loop. selfBannerLeak and mutedBannerLeak must be 0.',
        passCriteria: {
          allSendsSucceed: true,
          zeroSelfBanner: true,
          zeroMutedBanner: true,
          reportRawP95: 'the club-member-chat gate threshold is a founder decision from the measured p95',
        },
      },
    };
  });
}
