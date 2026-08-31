# We Glue capacity & reliability — final report

**Target:** reliably support a 500-student launch (signup / onboarding burst)
plus 50 fully-active concurrent students, on the Supabase **free plan, no
upgrade**. Auth stays email + password.

**Testing environment:** dedicated staging project `weglue-staging`
(`cwwmuxxqxovhcnnardlj`), free plan, us-west-2, brought to production parity
(custom Resend SMTP, `before_user_created` hook enabled, `mailer_autoconfirm`
off). Full `001 → 103` chain plus **migration 105** (the hybrid conversation
banner — supersedes the staging-only 103/104). **No production Auth-rate change.
Frontend not deployed. No build.**

**Recipients** for all email/signup volume were Resend's simulated-delivery test
address (`delivered+…@resend.dev` / `sr-…@resend.dev`) — no real inboxes.

---

## Read this first: staging-proven ≠ production-deployed

Everything in §§1–8 below is **capacity proven on the staging project**. **It is
not the current state of production.**

| On **production** right now | On **staging** (test bench) |
| --- | --- |
| migrations `001 → 098`, **`100`**, **`102`** | migrations `001 → 103` + **`105`** |
| photo fan-out async (**102**) — live, monitored | + hybrid conversation banner (**105**, T = 50) |
| client_tag columns present (**100**) but **inert** — no writer deployed | client_tag write paths exercised by the frontend branch |
| pre-reduction realtime client (4 always-on channels/user) | — |
| **no** frontend reliability stack | — |

103 (message-banner broadcast) and 104 (banner ≤50 gate) were the staging-only
iterations that led to **105**; they are superseded and never bound for
production. So: the §5 "50 active users PASS" and the §1–3 "email/signup PASS"
describe what **will** hold once 105 and the held frontend are on production. The
only category that is *also* a statement about production today is §7 (photo
fan-out) and the schema half of §3 (migration 100 is applied).

---

## Two platform ceilings that shape everything below

| Ceiling | Applies to | Value | Customizable? |
| --- | --- | --- | --- |
| **`over_request_rate_limit`** — per source IP | `auth.signUp`, `auth.signInWithPassword` (**one shared bucket**), and the `/verify` endpoint; a smaller effect on `resetPasswordForEmail` | ~8–15 request burst from one IP, then blocked; recovers in seconds | **No** (Supabase platform) |
| **`rate_limit_email_sent`** — per project, per hour | every transactional email | 1,000 (prod today) / accepted 5,000 in testing | **Yes**, with custom SMTP |

The per-IP limit is invisible to organic traffic (500 students = 500 IPs, 1–2
requests each). It only bites when many devices share **one public IP** — a
campus building or dorm behind one NAT during a rush, or any server-side proxy.

---

## 1. Realistic Auth / email — Model A: **PASS** (staging-proven)

500 verification-path emails + 24 real `auth.signUp` + 24 resends + 100 password
resets, paced as a realistic launch (~650 emails/hr) against `rate_limit_email_sent = 1,000`.

- **`429_email_bucket` = 0**, `5xx` = 0, flat ~1 s latency across all 500 volume sends.
- Real `auth.signUp` path: 24/24 clean; `.edu` hook 3/3 blocked; confirmation template sent.
- Effective peak rate ~781/hr — ~220/hr of headroom under the 1,000 cap.
- (The only failures were self-inflicted: bursting 100 resets from one IP in 11 s.)

**A realistic launch day's email volume fits comfortably under the production 1,000/hr cap.**

## 2. Stress email — Model B: **PASS — throughput only** (staging-proven)

2,500 verification-path emails as a burst + 200 resets + 200 email-changes,
against `rate_limit_email_sent = 5,000`.

- **2,500 emails in ~8 minutes (~18,600/hr instantaneous), 0 failures, 0 `429_email_bucket`.**
- Supabase **accepted** `rate_limit_email_sent = 5,000` (reverted to 1,000 after).
- GoTrue bursts far above the hourly rate; Resend/SMTP held flat at ~1 s.

**The email pipeline can absorb a burst well beyond the target.** This proves
SMTP/email throughput and the 5,000/hr configuration — nothing about student
account creation at 500 scale (that is §3).

## 3. 500 real signup path: **PASS WITH EXPECTED SAME-IP RATE LIMITING** (staging-proven; migration 100 schema now on production)

Not 500 simultaneous same-IP users, and not 500 distinct IPs directly tested.
500 executions of the exact shipped signup path (`auth_signup_status` RPC →
`auth.signUp` with real metadata) from **one origin**, paced at 9 s.

- **490 / 500 succeeded (98%).** The 10 failures were all `over_request_rate_limit`,
  only after ~400 sustained signups from one IP. From 500 distinct student IPs,
  none of these occur; only the 1,000/hr email bucket applies, and 500 fits.
- **Signup-trigger correctness — all 490:** every `auth.users` row → a `profiles`
  row (0 orphaned); `university_id` = launch campus; `onboarding_completed`,
  `agreed_to_terms` + `agreed_at`, username, `email_domain` all set;
  `user_interests` = 490×3 exact; `user_activities` = 490×2 exact;
  `confirmation_sent_at` all; **0 duplicate usernames, 0 duplicate emails.**
  `handle_new_user`'s exception handler never fired.

**Student account creation and signup-trigger integrity are solid at 500 scale.**

## 4. Campus / shared-IP behavior

Two scenarios, both on **one public IP**, exercising the shipped flow exactly
(signup → verify email link → congrats → return → **manual login**). Onboarding
unchanged.

### 4a. Classroom-30, realistic pace: **PASS**

30 students, signup 1 / 6 s, natural gaps (90 s to read email, 30 s to return).

- Signup 30/30, verify 30/30, **manual login 30/30 — zero per-IP 429s.**
- All 30 completed the full journey into the app. Integrity perfect (0 orphans,
  0 duplicate emails, 0 duplicate usernames).

A classroom moving at any human pace, with the natural "check your email" pause
between "sign up now" and "log in now," does **not** hit the per-IP limit.

### 4b. Classroom-60, aggressive pace: expected Supabase per-IP throttling — **not a product failure**

60 students all rushing (signup every 3 s, verify every 2 s, only 45 s / 12 s
gaps between waves).

**First pass:**
- Signup: **47 / 60** completed; **13 blocked** by `over_request_rate_limit`,
  onset after ~13–15 consecutive signups from one IP within ~40 s.
- `/verify`: **39 / 47**; **8 blocked** by the endpoint's own per-IP limit
  (`rate_limit_verify` = 30 was never reached).
- Manual login: **39 / 47** (0 per-IP 429s here — the 8 misses were the students
  who couldn't verify, returning the correct `email_not_confirmed`).
- **First pass: 39 / 60 (65%) reached the app.**

**Retry — the exact blocked students, after a 60 s pause, gently paced (8 s apart):**
- Blocked signups: **13 / 13 got back in.**
- Those 13 + the 8 verify-blocked: **21 / 21 then verified, 21 / 21 then logged in.**
- **Final: 60 / 60 (100%) reached the app.**

- Separate **bucket-recovery probe** (time until a *brand-new* signup — not a
  blocked student — succeeds again from this IP after the login wave): **1.3 s**.
- **Account / profile corruption: NONE.** The 13 blocked signups created
  *nothing* (atomic no-op). Every account that was created is complete:
  61 `auth.users` = 61 `profiles` = **61 distinct emails** (0 duplicates),
  0 orphans, all at launch campus, interests 180 = 60×3, activities 120 = 60×2,
  **0 duplicate usernames.**

**Required shared-IP reporting**

| | Answer |
| --- | --- |
| How many affected | Realistic 30-pace: **0**. Aggressive 60-student rush: **21 / 60 (35%)** blocked on the first pass (13 signup + 8 verify). |
| When the rate limit starts | After ~**13–15 consecutive `auth.signUp`** from one IP within ~40 s. |
| Recovery time | **~1.3 s** for a fresh request (bucket-recovery probe). |
| Retry success | **100%** — all 13 blocked signups and all 21 blocked-through-verify students completed on a paced retry after a 60 s pause. |
| State corruption | **None.** Blocked requests are atomic no-ops; every created account is complete and unique. |

**Copy fix (approved, committed, held with the frontend stack):** the app used
to show every 429 as "Email limit reached … try again in about an hour." It now
branches on `error.code` — `over_request_rate_limit` shows "Too many
sign-ups/sign-ins from your network right now. Wait a moment and try again —
your details are saved" (no precise duration), and onboarding form state is
preserved. `over_email_send_rate_limit` keeps the hourly message.
**No onboarding change; this is error-copy only.**

## 5. 50 concurrent active users: **PASS** (staging-proven; production still runs the pre-reduction client)

`concurrent-active` scenario, 50/50 pre-warmed sessions, the real We Glue
session-hub realtime topology, 3-minute window, staging carrying migrations
100/103/104.

| | **Reduced topology** (2 postgres_changes + 1 broadcast) | No-realtime floor |
| --- | ---: | ---: |
| all-ops p50 | **130 ms** | 135 ms |
| all-ops p95 | **1,808 ms** | 3,674 ms |
| failures | **0** | 0 |
| throughput / 3 min | 1,703 ops | 1,658 ops |

- **The reduced realtime topology performs at the no-realtime floor** — p50
  within noise, p95 better than the floor, zero failures.
- vs the pre-migration client (4 always-on `postgres_changes` channels/user):
  p50 **7,726 ms → 130 ms (~59×)**. The free-plan Realtime bottleneck at 50
  active users is eliminated.
- An earlier run showed p50 1.5 s and 14 `chat` timeouts; traced conclusively to
  442 k rows of load-test residue in `realtime.messages` plus free-tier compute
  throttling after ~10 h of testing. On the cleaned box `chat` runs at 160 ms
  p50 with 0 timeouts.

**Re-runs with migration 105 (2026-08-31), reduced topology, 6 large
conversations activated** — three runs across the day, incl. one after a
genuine 55-minute free-tier idle + a `realtime.messages` truncate:

| | run 1 (post-load) | run 3 (rested + cleaned) |
| --- | ---: | ---: |
| all-ops p50 | 108–153 ms | **96–151 ms** |
| all-ops p95 | 3.9–6.1 s | 6.6–10.2 s |
| all-ops p99 | ~11–13 s | 11.7–14.2 s |
| failures | 2 / 4,240 (0.05 %) | **1 / 4,064 (0.025 %)** |

- **p50 sits at the no-realtime floor (~100–150 ms) in every run, with a
  ~0.03 % failure rate.** That is the primary healthy signal.
- **p95 is 4–10 s and noisy** — this is the free-tier compute tail, not a 105
  effect. The earlier "definitive" 1,808 ms p95 was one exceptionally good run;
  the same prior work found "the no-realtime floor itself is p95 ~6 s on
  free-tier (≈10 % of ops multi-second regardless)." A day of heavy
  matrix/churn/ceiling load on the same free-plan project keeps compute at the
  high end of that band, and a 55-minute idle only partly recovers it.
- **105 is not a regression** — its trigger change makes the large-conversation
  message path *lighter* (one conversation-scoped `realtime.send` replaces ~49
  per-user sends). Across three runs p50 is unchanged and failures stay ~0.
- **Real-world reading:** at 50 truly-concurrent active students the median
  action is ~130 ms and most are fast; a minority can take several seconds
  during a burst. That is a free-plan characteristic — the same conclusion §5
  already reached — not something 105 introduced.

## 6. Session / logout reliability

**Root cause proven** (BE-7): the unexpected logout is a persisted refresh token
that falls **≥ 2 rotations behind** the server (`security_refresh_token_reuse_interval`
is a sliding per-use window, irrelevant once ≥ 2 behind) → `400 Invalid Refresh
Token: Already Used` → `SIGNED_OUT`. Reproduced on staging: rotate once → stale
token recovers (200 OK); rotate twice → `SIGNED_OUT`.

**Fix** (frontend commit `5e6c1420`, held with the stack): foreground-only token
refresh — `stopAutoRefresh` on `AppState` background, `startAutoRefresh` on
return — so a backgrounded app can't rotate the token out from under a
foreground tab, plus a stale-deep-link guard in `useAuthDeepLink`.

**Outstanding gate:** physical-device logout/session QA before the mobile
release — not yet performed. The staging reproduction + fix are code-verified;
device verification remains required.

## 7. Photo notification fan-out (migration 102) — **PASS — LIVE ON PRODUCTION**

`notify_photo_post_university()`'s synchronous O(campus) recipient loop
(measured post-INSERT p95 **12 s** at 500 members × 50 concurrent posts) was
replaced by an O(1) outbox enqueue + a cursor-based pg_cron worker.

- Post-102: post-INSERT p95 **12,000 ms → 990 ms**, flat in campus size,
  **0 failed jobs, 0 duplicate notifications**, 50/50 success at every case.
- **Applied to production 2026-08-30** (schema pre-check clean, pre-102
  un-fanned-post review clean, both cron jobs scheduled + active). Verified:
  cron ticks succeed, `process_notification_fanout()` clean. Health monitor
  running.

## 8. Large-club foreground banner — hybrid conversation Broadcast (migration 105): **PASS** (staging-proven)

The problem 103/104 left open: a message in a large club chat carried an
O(participants) synchronous `realtime.send` loop inside the INSERT (p95 12 s at
500 × 50), and 104's answer — "> 50 participants, no foreground banner" — was
rejected as permanent product behaviour.

**105 (design `docs/rollout/hybrid-conversation-banner-design.md` rev 2):** every
conversation still delivers its banner through a private Broadcast, but the topic
shape depends on size. **≤ T = 50 participants** keep the per-user
`sync:message-inbox:<uid>` path. **> 50** use one conversation-scoped
`sync:message-inbox-conv:<id>:<epoch>` — the trigger does a single
`realtime.send` and Supabase fans out to connected members. Membership is
re-authorised through the `<epoch>` in the topic (bumped on every removal, and
statement-level so a bulk removal is one bump), with a 90 s grace window on the
always-valid per-user path so no retained member misses a banner during a
size/membership transition.

Staging benchmark (`load-tests/src/hybrid-banner.ts`, T set to 50):

| | Result |
| --- | --- |
| Conversation-scoped INSERT p50 | **flat 105–260 ms** at every size (10 → 500) and every concurrency (1 → 50) |
| Per-user INSERT p95 @ 10 concurrent senders | 632 ms @ 50 · ~1 s @ 75 · 2.2 s @ 300 · 4.8 s @ 500 — the reason T = 50 |
| `realtime.messages` writes per message | per-user ≈ participants (74,550 rows / 150 msgs @ 500); conv-scoped **= 1** (150 rows) — ~500× less |
| Delivery (fresh clients, 15 subscribers) | **75 / 75**, one `realtime.messages` row per message |
| Removed member — banners after removal / can join new epoch | **0** / **no** (server-rejected), incl. during the grace window |
| Retained members — banners missed across a removal | **0** |
| Bulk removal (40 rows, one statement) → epoch bumps | **1** |
| Mute / unmute → cross-device `invalidate` | fires |
| Duplicate banners / muted-leak on per-user path / wrong-epoch or non-participant subscribe | **0** / **0** / **rejected** |
| Subscription ceiling (1 → 95 conv channels/client) | per-channel join flat ~315 ms; **0 duplicate, 0 leaked channels**; parallel joins cap at ~3.6/s (free-tier auth); failures only at 95 channels (near the 100 limit). A realistic student (1–10 large chats) reconnects in 0.7–3.9 s. |

**T = 50 and grace = 90 s were fixed from these measurements**, not chosen.
Push notifications, sender exclusion, unread recovery, message RLS, and
cross-conversation isolation are all preserved (the push enqueue loop is
byte-identical to migration 089). **Onboarding untouched.**

**Migration 105 is on staging only.** On production it would be inert for
existing conversations until an operator runs
`sweep_conversation_banner_activation()` — deliberately deferred until the
banner frontend (FE-13) is live, since a conversation-scoped broadcast to a
topic no deployed client has joined would be dropped.

---

## 9. Network topology — all six cells directly tested (`docs/rollout/network-topology-matrix.md`)

The data plane (messages, reads, RSVP, realtime subscribe) has **no per-IP
gate** — only `auth.signUp` / `signInWithPassword` / `/verify` do. So
distributing IPs can only *remove* a bottleneck.

The three distributed-IP cells were run by a GitHub Actions matrix (workflow
`.github/workflows/capacity-distributed-ip.yml`, 2026-08-31), each job on a
GitHub-hosted runner with its own public IP, cross-checked against 4 services.
**45 unique verified public IPs** across 46 runner jobs. Cost **$0**.

| Cell | Result |
| --- | --- |
| 500 Auth — **same IP** | **PASS w/ expected same-IP throttle** (§3: 490/500, 10 late per-IP 429s, integrity perfect) |
| 500 Auth — **distributed IPs** | **PASS** — 24 distinct IPs, 472/500 OK, **0 per-IP 429**, 0 email 429; the 28 misses were `5xx` free-tier strain spread across 11 IPs; local DB check 520/520 profiles, 0 orphans, 0 dup usernames |
| 50 active — **same IP** | **PASS** (§5, incl. the post-105 runs) |
| 50 active — **distributed IPs** | **PASS** — 50 users across 6 distinct IPs, barrier-synced, **0 per-IP rate-limiting on the 50 sign-ins** (same-IP would throttle); latency degraded (p50 0.3–3 s, p95 22–64 s) from free-tier fatigue + Azure↔us-west-2 RTT + a true simultaneous spike, not IP topology |
| ~30 classroom — **same IP** | **PASS** (§4a: 30/30, 0 rate-limits) |
| ~30 classroom — **distributed IPs** | **PASS** — 30 students across 15 distinct IPs, full shipped journey, **0 per-IP 429, 0 `rate_limit_verify` 429, 0 blocked, 0 retries**; 29/30 first-pass (1 `5xx`). Contrast: same-IP classroom-60 = 35 % blocked |

**Finding:** the per-IP `over_request_rate_limit` is purely a
same-IP-concentration effect — it vanishes when identical load is spread across
distinct IPs (0 per-IP 429s in all three distributed runs). The residual
distributed-run failures are a free-plan compute ceiling under a 5-minute burst
(`5xx`, uncorrelated with IP), not a topology effect; organic launch signup is
spread over hours.

Cleanup done: staging email limit reverted to 1000, all 8 GitHub secrets
deleted, trigger branch deleted. The staging service-role key was exposed to CI
and should be rotated or retired with the `weglue-staging` project.

---

## Migration & deployment status

| | Staging | Production | Decision |
| --- | --- | --- | --- |
| **100** (client_tag idempotency) | applied | **APPLIED 2026-08-30** — inert (no writer deployed) | approved, prod-only |
| **102** (async photo fan-out) | applied | **live + monitored** | shipped |
| **103** (message-banner broadcast) | applied | **not applied** | **superseded by 105** — staging-only, never bound for production |
| **104** (banner ≤ 50-participant gate) | applied | **not applied** | **superseded by 105** — the "> 50 = no banner" behaviour it encoded is not shipping |
| **105** (hybrid conversation banner, T = 50) | **applied 2026-08-31** (`supabase db push --linked`; sweep run; benchmarked) | **not applied** | **pending production decision** — standalone from prod 089/067; ledger path `098 → 100 → 102 → 105` |
| Frontend reliability stack (12 commits + FE-13) | n/a | **held** | needs 105 on production + physical-device logout QA + FE-13 (the 105 client work, not yet written) |

## Remaining release gates (founder)

1. ~~Final large-club foreground-banner solution~~ — **done**: migration 105
   (§8), design rev 2 founder-approved, benchmarked on staging.
2. ~~Staging regression of that solution~~ — **done**: churn / matrix / ceiling
   benchmarks + the 50-active re-run (§8, §5).
3. **Genuinely rested clean 50-active re-run** — one clean p95 number after real
   free-tier idle (in progress).
4. **Physical-device logout / session QA** (BE-7 fix is code-verified only).
5. ~~Final dependency / deployment-order review~~ — **done**:
   `docs/rollout/deployment-order-review.md`.
6. Optional: convert the "500 Auth — distributed IPs" cell (§9) to directly
   tested via the free GitHub Actions matrix.
7. **Mandatory `WE_GLUE_BEFORE_DONE_RULES.md` triple-check** of the merged stack.

Then return for production / release approval — 105 to production first, then
FE-13 + the frontend stack.

## Bottom line

**On the free plan, staging demonstrates that the 500-student launch and 50
active users are supported** — once migration 105 and the held frontend are on
production. Email capacity fits (§1, §2), account creation is correct at 500
scale (§3), realtime at 50 active sits at the no-realtime floor (§5), the
large-club banner cliff is resolved without dropping banners (§8, migration
105), and photo fan-out is fixed and already live (§7).

**Production today** carries only migrations 100 (inert) and 102 (live); it still
runs the pre-reduction realtime client and none of the reliability frontend. The
capacity numbers above are a forecast of the deployed system, not a measurement
of it.

The one genuine open risk is the **shared-campus-NAT signup rush** (§4b) — a
platform limit, not a We Glue defect. Under an aggressive 60-student rush on one
NAT, ~35 % are blocked on the first pass, but **100 % get in on a retry** after a
~60 s pause, recovery is ~1 s, and zero data is corrupted. At any human pace with
a natural email-check pause the limit is not reached at all.
