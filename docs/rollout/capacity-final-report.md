# We Glue capacity & reliability — final report

**Target:** reliably support a 500-student launch (signup / onboarding burst)
plus 50 fully-active concurrent students, on the Supabase **free plan, no
upgrade**. Auth stays email + password.

**Testing environment:** dedicated staging project `weglue-staging`
(`cwwmuxxqxovhcnnardlj`), free plan, us-west-2, brought to production parity
(custom Resend SMTP, `before_user_created` hook enabled, `mailer_autoconfirm`
off). Full `001 → 104` migration chain. **No production Auth-rate change.
Frontend not deployed. No build.**

**Recipients** for all email/signup volume were Resend's simulated-delivery test
address (`delivered+…@resend.dev` / `sr-…@resend.dev`) — no real inboxes.

---

## Read this first: staging-proven ≠ production-deployed

Everything in §§1–6 below is **capacity proven on the staging project** with the
full `001 → 104` chain and the held frontend behaviour. **It is not the current
state of production.**

| On **production** right now | On **staging** (test bench) |
| --- | --- |
| migrations `001 → 098`, **`100`**, **`102`** | migrations `001 → 104` |
| photo fan-out async (**102**) — live, monitored | + message-banner broadcast (**103**), banner ≤50 gate (**104**) |
| client_tag columns present (**100**) but **inert** — no writer deployed | client_tag write paths exercised by the frontend branch |
| pre-reduction realtime client (4 always-on channels/user) | — |
| **no** frontend reliability stack | — |

So: the §5 "50 active users PASS" and the §1–3 "email/signup PASS" describe what
**will** hold once the migrations and the held frontend are on production. The
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

---

## Migration & deployment status

| | Staging | Production | Decision |
| --- | --- | --- | --- |
| **100** (client_tag idempotency) | applied | **APPLIED 2026-08-30** — inert (no writer deployed) | approved, prod-only |
| **102** (async photo fan-out) | applied | **live + monitored** | shipped |
| **103** (message-banner broadcast) | applied | **not applied** | **HOLD** — large-conversation synchronous fan-out cliff unresolved; DM/small-group path only is validated |
| **104** (banner ≤ 50-participant gate) | applied | **not applied** | **NOT the accepted final product behaviour** — may stay staging-only as a test/safety mechanism; "conversation > 50 participants loses foreground banners" must not ship as permanent |
| Frontend reliability stack (12 commits) | n/a | **held** | needs the final message-banner backend + physical-device logout QA |

## Remaining release gates (founder)

1. **Final large-club foreground-banner solution** — a design that does not
   drop the banner for large conversations and does not carry the synchronous
   O(participants) `realtime.send` cliff. 103 + 104 are held on this.
2. **Staging regression** of that solution.
3. **Physical-device logout / session QA** (BE-7 fix is code-verified only).
4. **Mandatory `WE_GLUE_BEFORE_DONE_RULES.md` triple-check.**
5. **Final dependency / deployment-order review.**

Then return for production / release approval.

## Bottom line

**On the free plan, staging demonstrates that the 500-student launch and 50
active users are supported** — once the migrations and the held frontend are on
production. Email capacity fits (§1, §2), account creation is correct at 500
scale (§3), realtime at 50 active sits at the no-realtime floor (§5), photo
fan-out is fixed and already live (§7).

**Production today** carries only migrations 100 (inert) and 102 (live); it still
runs the pre-reduction realtime client and none of the reliability frontend. The
capacity numbers above are a forecast of the deployed system, not a measurement
of it.

The one genuine open risk is the **shared-campus-NAT signup rush** (§4b) — a
platform limit, not a We Glue defect. Under an aggressive 60-student rush on one
NAT, ~35 % are blocked on the first pass, but **100 % get in on a retry** after a
~60 s pause, recovery is ~1 s, and zero data is corrupted. At any human pace with
a natural email-check pause the limit is not reached at all.
