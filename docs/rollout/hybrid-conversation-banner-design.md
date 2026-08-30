# Final large-club foreground-banner design — hybrid private Broadcast

**Status: design for founder approval. Nothing built. Benchmark required before
production.** Supersedes migration 104 (the `>50 = no banner` gate is removed).

## Required outcome (founder)

Messages send quickly and foreground banners are **effectively instant at every
conversation size**. No `>50 = no banner`. No ~5 s worker as the default. No
`postgres_changes` path that recreates the measured Realtime bottleneck.

## The design in one paragraph

Every conversation delivers its foreground-banner signal through a **private
Broadcast**, but the *topic shape* depends on size:

- **≤ T participants** — the existing **per-user** topic `sync:message-inbox:<uid>`.
  The trigger sends one `realtime.send` per recipient (cheap at small N; this is
  what ships on staging today via migration 103).
- **> T participants** — one **conversation-scoped** topic
  `sync:message-inbox-conv:<conversation_id>`. The trigger sends **exactly one**
  `realtime.send`; Supabase's Realtime service fans it out to every connected
  member subscribed to that topic. The per-message DB cost is O(1) regardless of
  conversation size.

`T` is the crossover point, **determined from the benchmark below**, stored as a
`notification_config` row and served to the client by a tiny RPC (so it can be
re-tuned with a one-line `UPDATE`, no redeploy).

## Topic + authorization

New topic: `sync:message-inbox-conv:<uuid>` (uuid = `conversations.id`).

`realtime.messages` RLS is unchanged — the existing policy
`weglue_receive_message_sync` already delegates to
`private.can_receive_message_sync(realtime.topic())`. That function gets one new
branch:

```sql
WHEN p_topic ~ '^sync:message-inbox-conv:<uuid>$'
  THEN public.current_student_can_access_app()
   AND public.is_conversation_participant(<uuid>)   -- ACTUAL membership
```

`is_conversation_participant(p_conv_id)` is `EXISTS (SELECT 1 FROM
conversation_participants WHERE conversation_id = p_conv_id AND user_id =
auth.uid())` — **actual conversation membership is required**, checked at channel
JOIN time (once), not per message. A non-member cannot subscribe.

## How every preservation requirement is met

| Requirement | Mechanism |
| --- | --- |
| **Mute behaviour** | Muted members stay *authorised* on the conversation topic (they still need `invalidate` for unread state), but the client's `new_message` handler drops the banner when the conversation/channel is in the viewer's muted set. `buildMessageBanner` gains a `mutedConversationIds` / `mutedChannelIds` argument. For ≤ T this is unchanged (trigger already skips muted recipients). |
| **Sender exclusion** | `buildMessageBanner` already returns `null` when `payload.sender_id === userId`. The sender's own client receives the conversation broadcast (it is a member) and drops it. No change. |
| **No duplicate banners** | `ForegroundNotificationBanner` already keeps a session-lived `shownIds` Set keyed by `message_id`. A conversation is in exactly one mode per message; the only overlap is a mode flip mid-session (a conv crossing `T` as members join/leave), and the id Set collapses that to one banner. |
| **Existing push notifications** | `handle_message_push`'s `enqueue_message_push` loop is **untouched** — it still iterates participants (minus sender, minus muted, minus channel-muted) and enqueues one push each, at every size. Only the `new_message` *broadcast* differs. |
| **Unread recovery** | `private.broadcast_message_sync` (067) gets the same size branch: ≤ T → per-participant `invalidate` loop (existing); > T → one `invalidate` on `sync:message-inbox-conv:<id>`. The client's conversation-topic subscription handles both `new_message` and `invalidate`. The 5-minute `useUnreadSummary` poll remains the backstop. |
| **Message RLS** | The broadcast payload is presentation-only; the message body is still fetched through `messages` RLS on every real read. The conversation-topic auth (`is_conversation_participant`) is a subset of message visibility. No change. |
| **Immediate banner UX** | > T: one `realtime.send` in the trigger → Realtime fan-out to connected sockets, same latency profile as any Broadcast (sub-second). ≤ T: unchanged from today. |

## Client subscription model

`getMyChats` / `getMyConversations` **already fetch the full participant list per
conversation**, so the client computes `participantCount` with no schema change.

- `useUnreadSummary` (mobile + web) keeps its `sync:message-inbox:<uid>`
  subscription.
- A new hook `useConversationInboxBroadcasts(userId, conversations, threshold)`
  (mounted in the same host — `PushNotificationsHost` / `SessionRealtimeHub`)
  subscribes to `sync:message-inbox-conv:<id>` for each conversation where
  `participantCount > threshold`. Both `new_message` and `invalidate` are
  wired to the same handlers `useUnreadSummary` already uses.
- `threshold` comes from a new RPC `public.message_realtime_config()` →
  `jsonb` `{ "banner_broadcast_threshold": T }`, `SECURITY DEFINER`, granted to
  `authenticated`, fetched once per session (react-query, 1 h stale). A stale
  client threshold is non-fatal — a boundary conversation just uses one path or
  the other, and the id-dedup Set covers any overlap.

Channel budget: a heavy user in ~10 large club chats holds ~10 conversation
channels + notifications + my-clubs + the per-user inbox ≈ 13, against the free
plan's `max_channels_per_client: 100`.

## Exact file scope

### Backend — new migration `105_hybrid_conversation_banner.sql`

1. `CREATE OR REPLACE FUNCTION private.can_receive_message_sync(text)` — add the
   `sync:message-inbox-conv:<uuid>` branch (membership check).
2. `CREATE OR REPLACE FUNCTION public.handle_message_push()` — from the current
   (post-103/104) body: keep the recipient loop for `enqueue_message_push`;
   replace the `IF v_participant_count <= v_banner_max` per-user `new_message`
   send with `IF v_participant_count <= v_threshold` (per-user, in loop) `ELSE`
   one `realtime.send(payload, 'new_message', 'sync:message-inbox-conv:'||NEW.conversation_id, true)`
   after the loop. Resolve `v_threshold` from `notification_config`.
3. `CREATE OR REPLACE FUNCTION private.broadcast_message_sync()` — same size
   branch for the `invalidate` fan-out.
4. `notification_config`: replace `banner.max_participants` with
   `banner.broadcast_threshold` = `<T>` (from the benchmark).
5. `CREATE FUNCTION public.message_realtime_config() RETURNS jsonb` + `GRANT
   EXECUTE TO authenticated`.
6. Drop nothing else; 104's gate logic is replaced in step 2.

Blast radius note: step 3 edits a `067` (deleted-message-privacy) function.
Its body is otherwise copied verbatim; the change is one `IF/ELSE` around the
existing loop. Reviewed as its own hunk.

### Frontend (held with the reliability stack — needs 105 live first)

- `packages/shared/src/messaging/messageBanner.ts` — `buildMessageBanner(payload,
  userId, opts?)` gains `opts.mutedConversationIds` / `opts.mutedChannelIds`;
  returns `null` when the message's conversation/channel is muted for the viewer.
- `packages/shared` — a `messageRealtimeConfig` query key + fetch helper.
- `apps/mobile/hooks/useConversationInboxBroadcasts.ts` + `apps/web/lib/hooks/useConversationInboxBroadcasts.ts` — **new**. Subscribes to
  `sync:message-inbox-conv:<id>` for `> threshold` conversations; wires
  `new_message` → `buildMessageBanner` (+ mute set) → `publishNotificationInsert`,
  and `invalidate` → unread-summary invalidation.
- `apps/mobile/hooks/useUnreadSummary.ts` + `apps/web/lib/hooks/useUnreadSummary.ts` — pass the viewer's muted-conversation set into the existing
  `new_message` handler (per-user path) for symmetry; otherwise unchanged.
- `apps/mobile/components/notifications/PushNotificationsHost.tsx` +
  `apps/web/app/providers.tsx` — mount the new hook (reads `myChats` +
  the threshold RPC).
- `apps/mobile/hooks/useChats.ts` / `apps/web/lib/messages/hooks.ts` — expose
  `participantCount` per conversation (compute from the already-fetched
  `conversation_participants`); no query change.
- Tests: `messageBanner.test.ts` extended for the mute argument; a new test for
  the mode-selection logic.

### Load harness — `weglue-lt`

`message-fanout.ts` gains `--mode hybrid`: build conversations at 10 / 50 / 100 /
300 / 500 participants, run both topic modes, and for each measure:

- message-INSERT p50 / p95 / p99 at concurrency 1 / 10 / 50
- delivery: sample subscribers on `sync:message-inbox-conv:<id>` receive
  `new_message`; count vs expected (participants − sender − muted)
- sender-self banner leak = 0; muted-participant banner leak = 0 (client filter)
- no duplicate `message_id` at a sample client
- `push_queue` delta unchanged from the pre-105 path
- `realtime.messages` row growth per message (1 for > T vs N for ≤ T)

## Determining T (from the benchmark, not chosen here)

Per-user mode's send cost scales with N; conversation mode's is flat. `T` is the
smallest participant count where conversation mode's message-INSERT p95 at 10×
concurrency is **materially** below per-user mode's **and** comfortably under a
UX budget (target: p95 < 800 ms). From the existing `message-fanout` data,
per-user mode is ~600–900 ms at 50 participants / 10× and ~2 s at 300 / 10×, so
`T` is expected to land in the 20–75 range — the benchmark fixes it.

## Rollout

1. Benchmark on staging → fix `T`.
2. Apply `105` to staging; re-run the §5 50-active regression and the hybrid
   `message-fanout` at 10/50/100/300/500.
3. Founder approval → apply `105` to production, then the frontend stack
   (subject to the other release gates: device logout QA, before-done
   triple-check, dependency-order review).

Migration 104 stays staging-only until 105 replaces it; it is not shipped.
