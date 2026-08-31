# Final large-club foreground-banner design — hybrid private Broadcast (rev 2)

**Status: revised design for founder approval. No code. Migration 105 not
written. Benchmark required before implementation is approved.**

Rev 2 incorporates the founder's five revision points: (1) no
threshold-transition missed banners, backend owns the threshold, clients hold
subscriptions independently of it; (2) server-enforced membership revocation via
a versioned topic; (3) T is a controlled backend release setting, not
hot-tunable; (4) full UX/security preservation incl. cross-device mute; (5)
expanded benchmark.

Migrations 103 and 104 remain **staging-only**. 105 is authored standalone from
the current production definitions (089 `handle_message_push`, 067
`broadcast_message_sync`) and does not depend on 103/104 reaching production.

---

## Product requirement (unchanged)

Message-send latency and foreground-banner latency stay **effectively instant
regardless of conversation size**. No `>N = no banner`. No worker-delay banner.
No `postgres_changes` path that recreates the measured Realtime bottleneck.

---

## Architecture

### Two delivery topics, one always valid

| Topic | Auth | Lifetime | Carries |
| --- | --- | --- | --- |
| `sync:message-inbox:<user_id>` (exists, 067) | `auth.uid() = <user_id>` — **never stale** | permanent, one per user | `invalidate` today; rev 2 adds `new_message` for the per-user path |
| `sync:message-inbox-conv:<conversation_id>:<banner_epoch>` (**new**) | `is_conversation_participant(<conversation_id>) AND conversations.banner_epoch = <banner_epoch>` | per (conversation, epoch); a new epoch = a new topic string | `new_message` and `invalidate` for large active conversations |

The per-user topic is the **safety net**: its authorization can never go stale,
so every member always has one guaranteed-valid delivery path. The
conversation topic is the **scale optimization**: one `realtime.send` per
message instead of one per recipient.

### Backend-owned conversation state (new columns on `conversations`)

```
banner_broadcast_active  boolean     NOT NULL DEFAULT false
banner_epoch             integer     NOT NULL DEFAULT 0
banner_epoch_changed_at  timestamptz NOT NULL DEFAULT now()
```

- **`banner_broadcast_active`** — false→true (one-way in normal operation) when
  participant count first reaches `T`. Never auto-reverts (a club chat that
  drops from 60 to 45 stays conv-scoped; costs nothing, avoids flapping).
  Deactivation only via the controlled T-change runbook (§ "T").
- **`banner_epoch`** — bumped on **activation** and on **any participant
  removal** while active. Not bumped on joins (a new member simply subscribes to
  the current epoch topic).
- **`banner_epoch_changed_at`** — start of the grace window.

These three columns are returned by `getMyChats` / `getMyConversations` (both
already `SELECT conversations.*`). **Clients read only these columns** — they
never learn `T`.

### The send rule (in `handle_message_push`, rev 105)

```
v_stable := v_conv.banner_broadcast_active
        AND (now() - v_conv.banner_epoch_changed_at) > v_grace;   -- v_grace from notification_config, default 90s

IF v_stable THEN
    -- one send, O(1), independent of participant count
    PERFORM realtime.send(payload, 'new_message',
        'sync:message-inbox-conv:' || NEW.conversation_id || ':' || v_conv.banner_epoch, true);
ELSE
    -- the migration-103 per-user path over a FRESH participant list
    FOR v_recipient IN
        SELECT cp.user_id FROM conversation_participants cp
        WHERE cp.conversation_id = NEW.conversation_id
          AND cp.user_id <> NEW.sender_id
          AND cp.muted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM channel_mutes chm
                          WHERE NEW.channel_id IS NOT NULL
                            AND chm.channel_id = NEW.channel_id
                            AND chm.user_id = cp.user_id)
    LOOP
        PERFORM realtime.send(payload, 'new_message',
            'sync:message-inbox:' || v_recipient.user_id, true);
    END LOOP;
END IF;
```

The `enqueue_message_push` loop is **byte-for-byte from 089** and runs on every
message at every size — push notifications are completely unchanged.

`broadcast_message_sync` (067, rev 105) gets the **same `v_stable` branch** for
its `invalidate` fan-out: stable → one `invalidate` on the conv topic; otherwise
the existing per-participant `invalidate` on each `sync:message-inbox:<uid>`. The
`sync:message:<conversation_id>` open-thread ping is unchanged.

---

## Point 1 — no missed banner at the per-user ↔ conv-scoped transition

The client does **not** need to learn `T` at the instant the backend switches a
conversation. The switch is a two-phase, backend-driven sequence:

1. **Activation.** Participant count reaches `T`. The
   `conversation_participants` trigger sets `banner_broadcast_active = true`,
   bumps `banner_epoch`, sets `banner_epoch_changed_at = now()`, and fires an
   `invalidate` to **every current participant's** `sync:message-inbox:<uid>`
   (their always-valid topic).
2. **Grace window (`v_grace`, default 90s).** `v_stable` is still false, so
   `handle_message_push` keeps using the **per-user path** — no banner is
   delivered through a topic any client has not joined yet. Meanwhile each
   client's `invalidate` handler refetches `getMyChats`, sees
   `banner_broadcast_active = true` + the new `banner_epoch`, and subscribes to
   `sync:message-inbox-conv:<id>:<epoch>`.
3. **Steady state.** After `v_grace`, `v_stable` becomes true and delivery moves
   to the conversation topic — which every online client already joined during
   the grace window.

A client that was offline for the whole grace window resubscribes on reconnect
(`refetchOnReconnect`) and, while it was offline, received its real **push
notification** through the unchanged `enqueue_message_push` path — no regression
versus today (a killed app never shows a foreground banner).

**`message_realtime_config()` RPC is removed from the design.** The client's
entire rule is: always hold `sync:message-inbox:<myId>`; additionally hold
`sync:message-inbox-conv:<id>:<epoch>` for every conversation where
`banner_broadcast_active` is true, re-keyed on `banner_epoch`. `T` lives only in
the backend activation check.

---

## Point 2 — server-enforced membership revocation

Supabase authorizes a private channel **at join time and caches the result**.
Removing a student from `conversation_participants` does **not** close their open
subscription. Today this is tolerable for `sync:message:<conv_id>` only because
its payload is empty and every refetch is RLS-guarded. The `new_message` banner
payload is **self-contained** (sender name, preview) — it must not reach a
removed member. It also cannot become a fetch-on-receive design (that is exactly
the per-message fan-out read that approach B removed).

### Mechanism: versioned topic + fresh-list grace

- **The topic string carries `banner_epoch`.** On any removal
  (`conversation_participants` DELETE — covers leave, kick, block, club-leave),
  the trigger **bumps `banner_epoch`** and sets `banner_epoch_changed_at =
  now()`.
- **The backend never sends to the old epoch topic again.** Future
  `new_message` / `invalidate` for that conversation address
  `sync:message-inbox-conv:<id>:<new_epoch>`. The removed member's cached
  subscription to `:<old_epoch>` is now a dead topic — it receives nothing.
- **The removed member cannot follow.** Their client drops the conversation from
  `getMyChats` (they are no longer a participant) and tears the channel down. If
  a buggy or hostile client attempts `:<new_epoch>` directly, authorization is
  `is_conversation_participant(<id>) AND conversations.banner_epoch =
  <new_epoch>` — both checked server-side in one indexed query; a non-member
  fails the first term.
- **No valid member misses a banner during the change.** The epoch bump also
  resets the grace window, so for `v_grace` seconds `handle_message_push`
  delivers that conversation per-user over a **freshly-read participant list**
  (removed member already excluded). Remaining members resubscribe to
  `:<new_epoch>` within that window, nudged by the `invalidate` the trigger
  sends to each of their `sync:message-inbox:<uid>` topics.

### Bulk-removal safety

A mass removal (club deleted, 500 rows deleted in one statement) must not fire
500 epoch bumps and 500 per-user grace fan-outs. The epoch-bump trigger is
**`AFTER DELETE ... FOR EACH STATEMENT`** with a transition table: it bumps each
affected conversation's epoch **once** per statement. When the conversation
itself is soft-deleted (`conversations.deleted_at`), `handle_message_push`
already early-returns — no banner work at all.

### Why not rely on join-time auth alone

Plain `is_conversation_participant` on an **unversioned** conv topic would leave
the removed member joined to the live topic forever (cached auth, never
re-evaluated) and every subsequent message would leak to them. The epoch is what
moves the backend's sends to a topic string the removed member is not on and
cannot join.

### Optional hardening (not core scope)

Extend the existing `sync:message:<conversation_id>` open-thread case in
`can_receive_message_sync` to also require current membership. Deferred to avoid
disturbing open-thread sync for legitimate users mid-churn; noted for a later
pass.

---

## Point 3 — T is a controlled release setting, not hot-tunable

- `T` is stored as `notification_config` key `banner.broadcast_threshold`, read
  **only** by the backend activation check. `v_grace` is
  `banner.epoch_grace_seconds` (default 90), also backend-only.
- Changing `T` does **not** instantly re-route any conversation. A conversation
  activates only when its `conversation_participants` trigger next recomputes and
  sees `count >= T`.
- To apply a lowered `T` to conversations that already qualify, run a **one-time
  sweep** (a migration step or an ops runbook entry): for each conversation with
  `count >= T AND NOT banner_broadcast_active`, activate + bump epoch +
  `changed_at = now()` + `invalidate` its participants. Every swept conversation
  gets its own 90s grace window, so **no client misses a banner** during the
  sweep.
- The design therefore does **not** promise a one-line live `UPDATE`. `T`
  changes are deliberate, versioned, and always transition clients through the
  grace mechanism.
- Initial `T` value: chosen from the benchmark below and written into migration
  105.

---

## Point 4 — UX / security preservation

| Requirement | Mechanism |
| --- | --- |
| **Mute** | Per-user path: `handle_message_push` already filters `muted_at IS NULL` and `channel_mutes` — muted members get no `new_message` (server-enforced). Conv-scoped path: the single broadcast reaches all joined members, so the **client** drops the banner when the conversation/channel is in the viewer's muted set — `buildMessageBanner(payload, userId, { mutedConversationIds, mutedChannelIds })` returns `null`. The mute sets come from `getMyChats` (which already selects `muted_at`) + the channel-mutes query. |
| **Cross-device mute/unmute** | New trigger `trg_conversation_mute_sync`: `AFTER UPDATE OF muted_at ON conversation_participants` and `AFTER INSERT OR DELETE ON channel_mutes` → `realtime.send('{}', 'invalidate', 'sync:message-inbox:' || user_id, true)`. Every one of that user's devices refetches `getMyChats`, updates its mute set, and the banner filter is immediately consistent. Verified explicitly in the benchmark (mute on device A → device B stops bannering within one round-trip). |
| **Sender exclusion** | Per-user path: loop excludes `sender_id`. Conv-scoped path: `buildMessageBanner` already returns `null` when `payload.sender_id === userId`; the sender is a member and receives its own broadcast, then drops it. |
| **No duplicate banners** | Each message takes exactly one path (`v_stable` true or false), delivered on exactly one topic per client. `ForegroundNotificationBanner` keeps a session `shownIds` Set keyed by `message_id` as belt-and-suspenders for reconnect replay. |
| **No missed banners during size/membership changes** | The grace window (§ Points 1 & 2): every activation and every removal keeps delivery on the always-valid per-user path over a fresh list until clients have joined the new epoch topic. |
| **Push notifications** | `enqueue_message_push` loop unchanged from 089 — runs every message, every size, fresh participant list. |
| **Unread recovery** | `broadcast_message_sync` (067) gets the same `v_stable` branch; clients handle `invalidate` identically on the per-user and conv topics; the 60–90s `useUnreadSummary` poll remains the backstop. |
| **Message RLS** | Broadcast payload is presentation-only; message bodies are still read through `messages` RLS on every real fetch. Conv-topic auth (`is_conversation_participant`) is a subset of message-read visibility. |
| **No cross-conversation leakage** | Topic is per-conversation; auth requires membership in **that** conversation and the current epoch. |
| **Onboarding** | Untouched. No onboarding file is in scope. |

---

## Migration 105 — schema + functions (outline, not code)

Authored standalone from production definitions. One `BEGIN/COMMIT`.

1. **`ALTER TABLE conversations`** — add the three `banner_*` columns above
   (defaults make it a metadata-only change; existing rows all start inactive).
2. **`public.can_receive_conv_banner(p_conv_id uuid, p_epoch int) RETURNS boolean`**
   — `STABLE SECURITY DEFINER`, single query:
   `EXISTS (SELECT 1 FROM conversation_participants cp JOIN conversations c ON
   c.id = cp.conversation_id WHERE cp.conversation_id = p_conv_id AND cp.user_id
   = auth.uid() AND c.banner_epoch = p_epoch)`.
3. **`private.can_receive_message_sync(text)`** — add a case:
   `WHEN p_topic ~ '^sync:message-inbox-conv:<uuid>:<int>$' THEN
   public.current_student_can_access_app() AND
   public.can_receive_conv_banner(<uuid>, <int>)`. Existing two cases unchanged.
4. **`public.handle_message_push()`** — replace from the 089 body: keep the
   `enqueue_message_push` loop exactly; replace the in-loop `new_message` send
   with the `v_stable` branch above; resolve `v_grace` from `notification_config`.
5. **`private.broadcast_message_sync()`** — replace from the 067 body: keep the
   `sync:message:<conv_id>` ping; wrap the per-participant `invalidate` loop in
   the same `v_stable` branch.
6. **`public.refresh_conversation_banner_state(p_conv_id uuid)`** — recompute
   count; activate + bump epoch on first crossing of `T`; bump epoch on removal
   while active; always set `banner_epoch_changed_at` and `invalidate` current
   participants when it changes anything.
7. **Triggers on `conversation_participants`:**
   - `AFTER INSERT ... FOR EACH ROW` → `refresh_conversation_banner_state(NEW.conversation_id)` (activation only; no bump).
   - `AFTER DELETE ... FOR EACH STATEMENT` (transition table) → one
     `refresh_conversation_banner_state` per affected conversation (epoch bump).
8. **`trg_conversation_mute_sync`** — `AFTER UPDATE OF muted_at ON
   conversation_participants` + `AFTER INSERT OR DELETE ON channel_mutes` →
   `invalidate` to the affected user's `sync:message-inbox:<uid>`.
9. **`notification_config`** — insert `banner.broadcast_threshold` = `<T>` and
   `banner.epoch_grace_seconds` = `90` (`ON CONFLICT DO NOTHING`). Replaces
   104's `banner.max_participants`.
10. Grants: `can_receive_conv_banner` / `refresh_conversation_banner_state`
    `REVOKE FROM PUBLIC, anon, authenticated`; `EXECUTE` to the roles that own
    the triggers, matching 067's pattern.

Blast radius: steps 4 and 5 each `CREATE OR REPLACE` one hot trigger function;
each is reviewed as a single hunk against its production baseline. Nothing is
dropped.

---

## Client scope

Relative to the `claude/rollout-reliability-frontend` branch state (where the
A/B/C realtime refactor already lives). Backend 105 must be live on the target
environment before any of this ships.

- **`packages/shared/src/messaging/messageBanner.ts`** —
  `buildMessageBanner(payload, userId, opts?)` gains
  `opts.mutedConversationIds` / `opts.mutedChannelIds`; returns `null` when the
  message's conversation or channel is muted for the viewer. Sender exclusion
  unchanged.
- **`apps/mobile/hooks/useConversationBannerChannels.ts`** +
  **`apps/web/lib/hooks/useConversationBannerChannels.ts`** — **new.** Input:
  the `myChats` / conversations list + the viewer's mute sets. For each
  conversation with `banner_broadcast_active === true`, subscribe
  `sync:message-inbox-conv:<id>:<banner_epoch>` (channel key includes the
  epoch, so an epoch bump re-subscribes and drops the stale channel). On
  `new_message` → `buildMessageBanner(...)` → `publishNotificationInsert`. On
  `invalidate` → the same unread/conversations invalidation `useUnreadSummary`
  uses. Joins are staggered ~100–300ms after the critical channels
  (`notifications`, `sync:message-inbox:<uid>`) to protect Realtime joins/sec on
  reconnect.
- **`apps/mobile/hooks/useUnreadSummary.ts`** +
  **`apps/web/lib/hooks/useUnreadSummary.ts`** — the `sync:message-inbox:<uid>`
  `new_message` handler (per-user path) passes the viewer's mute sets into
  `buildMessageBanner` for symmetry; the `invalidate` handler additionally
  invalidates `['myChats', userId]` / the conversations query so a
  `banner_epoch` change propagates to `useConversationBannerChannels`.
- **`apps/mobile/components/notifications/PushNotificationsHost.tsx`** +
  **`apps/web/app/providers.tsx`** — mount `useConversationBannerChannels`.
- **`apps/mobile/services/chatService.ts` (`getMyChats`)** +
  **`apps/web/lib/messages/service.ts` (`getMyConversations`)** — include the
  three `banner_*` conversation columns in the existing select (no new query;
  `conversations.*` already selected — confirm the explicit column lists carry
  them).
- **`apps/mobile/hooks/useChats.ts` / `apps/web/lib/messages/hooks.ts`** —
  expose `participantCount` per conversation from the already-fetched
  `conversation_participants` (used only for benchmark instrumentation and
  future UI; not required for the subscription rule).
- Tests: `messageBanner.test.ts` extended for the mute args; a new test for the
  `banner_broadcast_active` / epoch subscription-selection logic.
- **No `message_realtime_config()` RPC. No client knowledge of `T`. No
  onboarding file touched.**

---

## Benchmark plan (expanded)

Harness on `codex/rollout-reliability-loadtests` (`weglue-lt`). Two scenarios.

### A. `message-fanout.ts --mode hybrid-v2` — steady-state cost

Matrix: participant counts **10 / 50 / 100 / 300 / 500** × sender concurrency
**1 / 10 / 50**, each in **per-user mode** and **conv-scoped mode**.

Additionally, subscriber-side load: test with sampled users belonging to
**1 / 5 / 10 / 20+ conversations** (distinguishing total conversations from
large/active conversations, since only active ones get a dedicated channel).

### B. `conv-membership-churn.ts` — transitions & revocation (new)

- A conversation crossing `T` upward while messages are posted continuously —
  assert **zero missed banners** for every retained member across the grace
  window.
- Members removed (single and bulk / whole-statement) from an active
  conversation while messages are posted — assert the removed member receives
  **zero** `new_message` payloads after the removal commit (including during
  grace), and retained members miss **zero**.
- Cross-device mute: mute on client A, assert client B stops delivering banners
  for that conversation within one round-trip; unmute reverses it.

### Metrics (both scenarios)

- message INSERT **p50 / p95 / p99**
- foreground-banner delivery **p50 / p95** (send → client receives)
- channel **join latency**
- **cold-start / reconnect time** (join all channels for a 1 / 5 / 10 / 20+
  conversation user)
- Realtime **joins/sec** sustained before errors
- Realtime **events/sec** sustained
- **authorization failures** (must be 0 for valid members/epoch; must be 100%
  for removed members and stale epochs)
- **DB authorization pressure** — `can_receive_conv_banner` calls/sec, query
  time, `connection_pool: 2` saturation on join storms
- **mute leaks** (0)
- **removed-member leaks** (0, including during grace)
- **duplicate banners** (0)
- **missed banners** (0, including across size/membership transitions)

### Determining T

`T` = the smallest participant count where conv-scoped INSERT p95 at 10×
concurrency is materially below per-user mode **and** under a p95 < 800ms UX
budget, cross-checked against the reconnect/join-storm cost of the extra
per-conversation channels at that threshold. Expected range 20–75; the benchmark
fixes the number, which is written into migration 105.

---

## Benchmark results (staging `cwwmuxxqxovhcnnardlj`, 2026-08-31)

Harness: `load-tests/src/hybrid-banner.ts` (`--parts matrix,ceiling,churn`),
`seed-pf-500` manifest. Migration 105 live on staging; `notification_config`
`banner.broadcast_threshold` set to 50, `banner.epoch_grace_seconds` 90.

### Correctness (churn part) — all pass

| Check | Result |
| --- | --- |
| Single removal → epoch bump, grace window reset, conversation stays active | pass |
| Removed member banners received during grace (per-user path, fresh list) | **0** |
| Retained members messages missed across the transition | **0** |
| Removed member can join the new-epoch topic | **false** (server-rejected) |
| Removed member banners after grace; retained members on new epoch | 0 / all received |
| Bulk removal (40 rows, one statement) → epoch bump count | **1** |
| Mute / unmute → `invalidate` on the user's per-user topic | 1 / 1 |
| Crossing T on join → auto-activate + epoch → 1 | pass |
| Non-participant / wrong-epoch subscribe to a conv topic | **rejected** everywhere |
| Duplicate banners at a sample subscriber | **0** everywhere |
| Muted subscriber on the per-user path | **0** (server-filtered) |
| Conv-topic delivery, fresh clients (15 subs × 5 msgs) | **75 / 75**, 1 `realtime.messages` row per message |

### Steady-state INSERT cost (matrix part)

`conv-scoped` INSERT p50 is **flat 105–260 ms at every size and concurrency**.
`per-user` INSERT climbs with participants × concurrent senders:

| participants | per-user p95 @ 10 senders | conv-scoped p95 @ 10 senders |
| --- | --- | --- |
| 50 | 632 ms | 231 ms |
| 75 | ~1,000 ms | 248 ms |
| 100 | 760–935 ms | 300 ms |
| 300 | 2,160–2,600 ms | 1,650 ms |
| 500 | 4,750 ms | 10,300 ms* |

`realtime.messages` rows written per message: per-user ≈ participants (74,550
rows for 150 messages at 500 participants); conv-scoped = **1** (150 rows). About
500× less Realtime write load at 500 participants. (*the 500×10/50 conv-scoped
p95 is free-tier tail contention, not fan-out — the row count confirms one send;
p50 there is 1.4–2.2 s vs per-user 1.9–5.8 s.)

### Subscription ceiling (ceiling part) — 1 / 5 / 10 / 20 / 50 / 95 conv topics per client

| conv channels | cold join p50 | reconnect p50 | parallel joins/s | cold fails | reconnect fails | dup / leaked channels |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.7 s | 1.4 s | 2.4 | 0 | 0 | 0 / 0 |
| 5 | 1.9 s | 2.4 s | 3.3 | 0 | 0 | 0 / 0 |
| 10 | 3.7 s | 3.9 s | 3.4 | 0 | 0 | 0 / 0 |
| 20 | 7.5 s | 6.4 s | 3.5 | 0 | 0 | 0 / 0 |
| 50 | 16.7 s | 18.0 s | 3.6 | 0 | 0 | 0 / 0 |
| 95 | 50.8 s | 20.5 s | 3.6 | 6 | 236 | 0 / 0 |

Per-channel join is **flat ~315 ms** — no per-channel degradation. Parallel
join throughput caps at **~3.6 joins/s** (the free-tier realtime-auth
`connection_pool: 2` ceiling); DB connection count does not spike during a
reconnect storm. **Zero duplicate channels and zero leaked channels** at every
level. Failures appear only at 95 channels (near the free-tier
`max_channels_per_client: 100`), where auto-rejoin of ~96 channels cannot finish
within a 20 s window at 3.6/s.

**Implication for T:** with T = 50 a student holds a dedicated channel only for
club chats ≥ 50 members — realistically 1–10, i.e. 0.7–3.9 s cold start / 1.4–3.9
s reconnect, all with zero failures. Lowering T would push more conversations
into dedicated channels and toward the 3.6/s reconnect ceiling; raising it would
expose larger conversations to the per-user INSERT cliff. **T = 50** is the
point where the per-user path's p95 is still under the 800 ms UX budget and the
channel budget stays comfortable.

### T and grace — chosen from the data

- **T = 50** — last participant count where per-user INSERT p95 stays < 800 ms at
  10 concurrent senders; keeps dedicated channels rare.
- **grace = 90 s** — zero missed banners for retained members in the churn test;
  connected clients resubscribe in 1–2 s; covers a backgrounded mobile client
  that foregrounds within the window.

Both written into migration 105.

### 50-active regression (reduced topology, 105 live, 6 large conversations activated)

Three runs, incl. one after a genuine 55-minute free-tier idle + a
`realtime.messages` truncate. Every run: operation **p50 ~96–153 ms** at the
no-realtime floor (all of chat / rsvp / like / feed-read / search / club-view /
event-view / comment), **~0.03% failure rate** (1–2 timeouts per ~4,000+ ops),
0 banner follow-up reads. p95 was 4–10 s and noisy across runs — the free-tier
compute tail (prior work: the no-realtime floor is itself p95 ~6 s on this
tier), not a 105 effect: p50 and failure rate are flat across all three runs.
105 makes the large-conversation message path *lighter* (one conv-scoped send
replaces ~49 per-user sends).

---

## Rollout

1. Benchmark (A + B) on staging → fix `T` and `v_grace`.
2. Write migration 105; apply to staging; re-run scenario B + the 50-active
   regression against the reduced Realtime topology.
3. Founder approval → apply 105 to production, then release the frontend stack
   (still gated on physical-device logout QA, `WE_GLUE_BEFORE_DONE_RULES.md`
   triple-check, and the dependency-order review).

103 and 104 stay staging-only and are never bound for production; the
production ledger path for this work is `… 098 → 100 → 102 → 105`, and 105's
function bodies derive from the current production definitions, not from
103/104.
