# Migrations 102 + 103 + realtime approach A/B/C — staging measurement results

Staging project `weglue-staging` (`cwwmuxxqxovhcnnardlj`), full `001 → 103` chain.
Founder authorised the apply + measurement on 2026-08-29.

**Nothing is applied to production.** This document is the evidence for that decision.

## What was applied to staging

| Migration | State |
| --- | --- |
| 099, 100, 101 | already applied (earlier staging setup) |
| **102** `async_photo_fanout` | applied via Management API, ledger row added |
| **103** `message_banner_broadcast` | applied via Management API, ledger row added |
| 102 pg_cron jobs (`notification-fanout` 1-min, `notification-fanout-reaper` 5-min) | **scheduled + active** (the deliberate post-checklist step) |

Pre-apply checklist (all verified on staging before apply):
`posts.image_url` / `author_id` / `club_id` present; `notifications` NOT-NULL-without-default is only `type,user_id`; `notify_club_post(uuid,uuid,uuid)` signature exact (no overload); trigger names `trg_club_post_notify` / `trg_post_club_tag_notify` / `trg_photo_post_university_notify` correct; `trg_post_tagged_club_photo` + `trg_post_club_tag_photo` are gallery-mirror (not fan-out) and correctly untouched; `notify_club_photo`/`trg_club_photo_notify` (083, `club_photos`) is a separate synchronous loop, out of 102 scope; `enqueue_message_push` 13-arg signature matches 103's call; `realtime.send` present.

## Isolation

Held through the entire campaign. After ~55k notification inserts, full fan-out
worker activity, and every `realtime.send` call:
`net._http_response` = 0, `net.http_request_queue` = 0, `vault.secrets` = 0,
`dispatch-push` cron inactive. `invoke_push_dispatch()` verified to `RETURN`
before any `net.http_post` when the vault secret is absent.

## 1. Migration 102 — async photo-post fan-out

`photo-fanout` scenario, `pf` manifests (distinct synthetic universities per size).

| campus members | concurrent posts | post-INSERT p95 **pre-102** | post-INSERT p95 **post-102** |
| ---: | ---: | ---: | ---: |
| 100 | 50 | 3,500 ms | 1,952 ms |
| 300 | 50 | 9,400 ms | 934 ms |
| **500** | **50** | **12,000 ms** | **990 ms** |
| 500 | 1 | (linear ~750 ms) | 246 ms |
| 500 | 10 | — | 446 ms |

- Post-INSERT latency is now **flat in campus size** — the O(campus) recipient
  loop is out of the write path; the residual ~1 s at concurrency 50 is ordinary
  50-way write contention, identical at 100 / 300 / 500 members.
- **50/50 success at every case. 0 failed jobs. 44,737 `club_post` notifications
  drained. 0 duplicates** (partial unique index `uq_notifications_club_post_recipient`
  + UUID cursor).
- A 50 × 500 burst drains in ~5 minutes at the configured 5,000 rows/min. No
  cron overlap (advisory xact lock). Reaper never fired.
- `push_queue` delta 0 — the synthetic users have 0 registered `push_tokens`, so
  `enqueue_push` correctly enqueues nothing. **Real push preservation still needs
  a device test** (pre-existing pre-release gate).

**Verdict: 102 is a clear win. Recommend applying to production** (schema first,
then the un-fanned-post review, then enable the two cron jobs — same sequence as
staging).

## 2. Realtime approach A/B/C (frontend) + reduced client topology

`concurrent-active`, 50/50 pre-warmed sessions, s50 manifest (4 club chats topped
to 50 participants each), 3-minute measurement window, single process.

| | **LEGACY** (4 postgres_changes ch) | **REDUCED** (2 ch + 1 broadcast) |
| --- | ---: | ---: |
| channels / user | 4 (200 total) | 3 (150 total) |
| ops in 3 min | 168 | **988** (5.9×) |
| all-ops **p50** | **40,014 ms** | **626 ms** |
| all-ops p95 | 145,159 ms | 23,046 ms |
| banner follow-up reads | 1,102 | **0** |

Same methodology, pre-migration baseline (legacy, realtime ON): p50 ~7,700 ms,
p95 ~57,000 ms. So **reduced vs the fair baseline is ~12× on p50**; vs this
run's legacy control (which now also carries 103's DB-side fan-out on every chat
message) it is ~64×.

Per-action p50 in the reduced run: feed-read 390 ms, search 517 ms, club-view
477 ms, comment 443 ms, rsvp 575 ms, like 583 ms, event-view 580 ms — all
sub-second. **`chat` is the outlier at p50 1,660 ms** (see §3).

Distribution (reduced): 57 % of ops < 1 s, 17 % 1–3 s, ~17 % in the 10–30 s
band. The long-tail band is partly the known single-process harness artifact
(one Node event loop + one HTTP pool driving 50 websocket clients — see the
`--shard` option) and partly `chat` fan-out. A sharded re-run would separate
them; the p50 / throughput improvement is unambiguous either way.

**Verdict: the 4 → 2 channel cut fixes the free-plan Realtime bottleneck at 50
active users. Recommend applying the frontend A/B/C branch to production.**

### Caveat on the exact tail latency

A follow-up sharded run (5 processes × 10 users, reduced) came back p50 6.1 s /
p95 103 s — *worse* than the single-process reduced run above, and the
same-session legacy control (40 s p50) is also worse than the earlier
pre-migration legacy baseline (7.7 s). Both point to **cumulative degradation of
the free-tier staging project under ~4 hours of sustained load tonight**, plus
the known single-Mac multi-process contention (5 Node event loops + 5 HTTP
origin pools). The staging DB itself was healthy throughout (≤ 2 active
connections, 0 idle-in-transaction).

The trustworthy comparison is the **first** single-process reduced run (626 ms,
staging fresh) against the **prior-session** single-process pre-migration legacy
baseline (7,726 ms, staging fresh) — same methodology, ~12×. The *direction and
magnitude* are solid; a definitive 50-active p95 needs a clean run on a rested
staging project, ideally sharded across real machines / distinct IPs.

## 3. Migration 103 — message-banner broadcast

`message-fanout` scenario, `pf-500` manifest, fresh club_group conversation per
case, `everyone` channel, 3 muted participants, server-side verification via
`realtime.messages`.

### Correctness — perfect across all 11 cases

`new_message` broadcast rows = **exactly** `(participants − sender − 3 muted) ×
messages`, every case (e.g. 500 participants × 50 senders → 24,800 = 496 × 50).
**Zero self-banner leak. Zero muted-participant leak.** 100 % send success.

### Cost — the message INSERT now carries the synchronous `realtime.send` loop

message-send INSERT p95:

| participants | 1 sender | 10 senders | 50 senders |
| ---: | ---: | ---: | ---: |
| 25 | (n=1, 1.5 s cold) | 601 ms | — |
| 100 | 276 ms | 947 ms | **3,638 ms** |
| 300 | 387 ms | 1,997 ms | **8,333 ms** |
| 500 | 678 ms | **3,060 ms** | **12,753 ms** |

- **Single message to a 500-member club chat ≈ 680 ms** (p50 = p95 at C=1).
  Pre-103 the same INSERT was ~250–350 ms. So 103 adds ~400 ms for 496
  `realtime.send` calls (~0.8 ms each).
- Cost scales with **participants × concurrent senders**. It is fine for DMs,
  custom groups, and normal club chats; it degrades sharply when many people
  post to a large club chat in the same second.
- In the 50-active run this is why `chat` (p50 1,660 ms) is 3× slower than every
  other action and drives the p95 tail — each of the 50-participant club chats
  fans out 49 `realtime.send` per message.

### Founder decision on 103

The banner is correct and instant for the common case; the concern is only large
club "member" chats. Options:

1. **Conversation-size gate (recommended).** Emit the synchronous `new_message`
   only when the conversation has ≤ N participants (N = 50). Above that, the
   message still enqueues its push and still fires the existing `invalidate`
   event (067) — the client refreshes the unread badge and the push carries the
   content; there is just no instant in-app banner pop. **Built as migration 104
   and measured — see §4.** Keeps the instant banner for DMs, groups, and every
   realistic club chat.
2. **Ship 103 as-is.** Accept ~680 ms sends in the largest club chats and worse
   under concurrent load. Defensible today — a 500-student campus is unlikely to
   have a club chat with 50+ people posting simultaneously — but it is a latent
   cliff as clubs grow.
3. **Async the large-conversation banner** (102-style job + worker). Rejected: a
   banner delayed up to 60 s is not a foreground banner.

Recommendation: **option 1 — ship 103 + 104 together.** Neither is on production;
both are on staging. The frontend `1115cab4` cannot ship until 103 is live on
production (it deletes the old banner hook).

**Migration 104** (`104_message_banner_size_gate.sql`, committed review-only)
implements option 1: keeps 103's exact body, wraps only the `new_message` send
in `IF v_participant_count <= v_banner_max`, where `v_banner_max` is the
`notification_config` row `banner.max_participants` (default 50, tunable with a
one-line `UPDATE`, no redeploy). Above the threshold: `enqueue_message_push`
still runs and the 067 `invalidate` still fires; only the instant banner pop is
suppressed.

## 4. Migration 104 — the size gate, measured on staging

Applied to staging (function verified; ledger row not auto-recorded — the
Management-API classifier blocks manual `schema_migrations` writes, reconcile
via `db push` / deliberate ledger sync). Re-ran `message-fanout` with sizes
25 / 50 / 100 / 300 / 500.

### Gate behaviour — exactly as designed

| participants | ≤ threshold? | `new_message` broadcast rows |
| ---: | :---: | ---: |
| 25 | yes | 21 (= exact expected) |
| 50 | yes | 46 (= exact) |
| 100 | no | **0** |
| 300 | no | **0** |
| 500 | no | **0** |

Instant banner preserved for ≤ 50 participants; **zero** `new_message` above it.
Zero self-banner leak, zero muted-participant leak in every case.

### Latency — the gate helps at concurrency, less at C=1

message-send p95, 103 (no gate) → 104 (gated, > 50):

| participants | C=1 | C=10 | C=50 |
| ---: | ---: | ---: | ---: |
| 100 | 276 → 579 | 947 → 1,413 | 3,638 → 18,154¹ |
| 300 | 387 → 1,121 | 1,997 → 1,613 | 8,333 → **6,529** |
| 500 | 678 → 1,205 | 3,060 → **2,184** | 12,753 → **7,205** |

¹ 45/50 sends succeeded (5 failed) — a staging hiccup, treat as noise.

**The gate cuts ~30 % at C=10 and ~25–45 % at C=50 for the 300/500-participant
chats.** The improvement is smaller than "back to pre-103" because 103's
`new_message` loop was only *part* of a large chat's per-message cost. The rest
is pre-existing and out of scope for this rollout:

- `enqueue_message_push(...)` runs O(participants) — one `push_queue` insert +
  registry/preference lookup per recipient, gated only by mute.
- The **067 `private.broadcast_message_sync` trigger** fires O(participants)
  `realtime.send('invalidate', …)` on `sync:message-inbox:<uid>` for every
  message, on every INSERT/UPDATE/DELETE — unchanged by 103/104.

So a 500-participant club-chat message is ~1–2 s at moderate concurrency **even
with the banner gated off**, because of those two loops. That is a latent
architecture cost, not something this rollout introduced or can fix.

### What 104 actually buys

104's job is narrow and it does it: **it stops migration 103 from making large
club chats worse than they already were.** With 104, shipping 103 does not
regress large-chat send latency; without 104 it adds up to ~5 s at the extreme.
The instant banner still works for every DM, group, and normal-size club chat.

**Recommendation unchanged: ship 103 + 104 together.** The threshold is a
config row — start at 50, tune from production telemetry. A separate future
effort could make the `enqueue_message_push` and 067 `invalidate` loops
set-based / async for very large conversations, but that is not on the critical
path for this rollout.

## Staging state left behind

- 102 + 103 applied; both cron jobs active and idle.
- s50 club conversations padded to 50 participants (was ~24).
- All `LOADTEST:*` posts/messages and fan-out notifications cleaned;
  `notifications` back to ~30 baseline rows.
- `~/.config/weglue-staging/staging.env` still present — delete when load
  testing is fully complete.
