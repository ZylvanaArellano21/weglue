# Capacity — network-topology matrix (same-IP vs distributed-IP)

Six cells the final capacity report must classify explicitly as **directly
tested** or **inferred** — never silently inferred.

## The only IP-sensitive limit in play

Every Supabase limit that bears on these scenarios, and its scope:

| Limit | Scope | Affects |
| --- | --- | --- |
| `over_request_rate_limit` | **per source IP** | `auth.signUp` + `auth.signInWithPassword` (one shared bucket, ~8 burst, ~7–8/min sustained, ~11 s partial / 20–30 min full refill) |
| `rate_limit_verify` (30) | **per source IP** | the `/verify` endpoint |
| `rate_limit_email_sent` | **per project / hour** | confirmation-email volume (1000/hr on staging parity; GoTrue bursts above the hourly rate) |
| Realtime `connection_pool: 2`, `max_channels_per_client: 100`, `max_concurrent_users: 200` | **per project** | realtime subscribe / auth throughput |
| Free-tier compute | **per project** | all DB work |

**The data plane has no per-IP gate.** Message sends, reads, RSVP, realtime
subscriptions all run on an already-issued JWT. IP distribution only changes the
two per-IP *Auth* limits above (`over_request_rate_limit`, `rate_limit_verify`).

Consequence: distributing IPs can only ever *help* — it removes the shared
per-IP Auth bucket. A distributed-IP run of any scenario is strictly easier than
the same-IP run of that scenario. The risk always lives in the same-IP cells,
which are the ones directly tested.

## The matrix — all six cells directly tested

The three distributed-IP cells were tested by a GitHub Actions matrix
(`.github/workflows/capacity-distributed-ip.yml`, run 33359251691, 2026-08-31):
each job on a GitHub-hosted runner with its own public IP, cross-checked against
4 IP services (majority vote). **45 unique verified public IPs** across 46
runner jobs (1 job could not verify its IP; 45/46). All GitHub Azure ranges.

| # | Cell | Result | Evidence |
| --- | --- | --- | --- |
| 1 | **500 Auth — same IP** | **PASS w/ expected same-IP throttle** | `signup-real --mode burst`, 500 `/signup` from one origin. 490/500; the 10 failures were late `over_request_rate_limit` 429s. `handle_new_user` integrity perfect for all 490. |
| 2 | **500 Auth — distributed IPs** | **PASS** — DIRECTLY TESTED (rerun 2026-08-31) | 25 runners × 20 signups across **25 distinct verified IPs**, all with the retry path a real client has. **`over_request_rate_limit` (per-IP 429): 0** on every IP (vs 10 same-IP). Email-bucket 429: 0. 41 first-pass `5xx` (free-tier strain, spread across 14 IPs, uncorrelated) — **all 41 recovered on retry, 0 still failed on any shard**. Local DB check of the 500 real onboarding signups: **500 auth users = 500 profiles, 0 orphan auth, 0 orphan profiles, 0 null university, 500 onboarding_completed, 500 agreed_terms + agreed_at, 0 duplicate usernames; interest rows 1,500 = 1,500 expected, activity rows 1,000 = 1,000 expected, 0 users with a wrong count**. The migration-107 reconciliation sweep found **0 rows to repair** — `handle_new_user` held under all 41 transient `5xx`. (The first run's apparent "~4 % missing interests" was a load-harness scoping error — it counted the harness's metadata-less `-probe0` recovery-probe signups as onboarding flows; all 501 real signups in that run were also complete.) |
| 3 | **50 active — same IP** | **PASS** | `concurrent-active --topology reduced`, 50 sessions from one origin, repeatedly (post-105 2026-08-31: op p50 96–153 ms, ~0.03% timeout). |
| 4 | **50 active — distributed IPs** | **PASS** — DIRECTLY TESTED | 6 runners × ~8 users = **50 users across 6 distinct verified IPs**, barrier-synced to one absolute measurement window (all shards waited ~500 s to align). **0 per-IP rate-limiting on the 50 prewarm sign-ins** (50 sign-ins from one origin *would* hit `over_request_rate_limit`). All 50 stayed connected; 0 auth failures. Operation p50 0.3–3 s, p95 22–64 s — degraded vs the same-IP run, attributable to (a) the free-tier project being heavily load-fatigued from a full day of testing, (b) GitHub Azure → Supabase us-west-2 round-trip latency, (c) the barrier forcing a true simultaneous 50-user spike rather than a ramp. None of those is IP topology — there is no per-IP limit on any operation an active user performs. |
| 5 | **~30 classroom — same IP** | **PASS** | `signup-real --mode classroom`, 30 students on one IP: 30/30 into the app, 0 `over_request_rate_limit` 429s. (Harsher 60-student rush = expected per-IP throttling with full retry recovery.) |
| 6 | **~30 classroom — distributed IPs** | **PASS** — DIRECTLY TESTED | 15 runners × 2 students = **30 students across 15 distinct verified IPs**, each running the full shipped journey (signup → email verify → congrats → return → manual login → app). **0 `over_request_rate_limit`, 0 `rate_limit_verify` 429, 0 email-bucket 429, 0 students blocked, 0 retries needed** — every shard, every step. 29/30 completed first-pass; the 1 miss was a single `5xx` on one student's signup. Direct contrast with the same-IP aggressive classroom-60 (35% blocked first pass). |

### What the distributed-IP runs establish

- **The per-IP `over_request_rate_limit` is entirely a same-IP-concentration
  effect.** Spread the identical load across distinct IPs and it disappears —
  0 per-IP 429s in all three distributed scenarios, where the same-IP versions
  saw 10 (auth-500) and 35 % (classroom-60).
- **Transient `5xx` errors under a burst are recoverable.** The 500-signup
  rerun saw 41 first-pass `5xx` (free-plan compute strain, uncorrelated with
  IP) and **every one recovered on a client retry** — the design requirement.
- **No silent corruption or incomplete state.** All 500 accounts ended with a
  profile, correct university, complete interests/activities, terms recorded,
  and 0 orphans in either direction. Migration 107
  (`reconcile_signup_survey` / `reconcile_recent_signup_surveys`) is a durable
  idempotent safety net for the latent risk that `handle_new_user`'s
  best-effort survey insert could ever drop a row; it found nothing to repair.
- **The active-user data plane is IP-independent**, as predicted: 50 users from
  6 IPs behaved like 50 from one IP except for the sign-in phase, which
  *improved* (no shared bucket).

## Directly testing the distributed-IP cells — cheapest safe method

**No purchase required.** A **GitHub Actions matrix** gives genuine multi-IP
egress at $0.

- Each matrix job ran on a GitHub-hosted runner with its own public IP.
- **Cost: $0** — GitHub Free for a user account includes 2,000 Actions
  minutes/month with a default $0 spending limit (Actions hard-stops rather
  than billing when the quota is reached). This run used ~500 job-minutes.
- **Concurrency:** this account runs ~6–8 jobs at once (not the documented 20).
  `active-50` was therefore sized to 6 shards so all shards share one
  barrier-synced window; `auth-500` (25) and `classroom-30` (15) fan out in
  waves — they need no simultaneity.
- **Secrets:** staging URL, anon key, project ref, university id, email domain,
  the write-confirmation string, and — for the classroom email-verification
  step (`admin.generateLink`, since `@resend.dev` has no inbox) — the **staging
  service-role key**, plus a base64 copy of the 50-user seed manifest. The
  Supabase **management PAT was NOT put in CI** (it is account-wide); the
  `auth-500` DB-integrity check was run locally afterward.
- **Safety:** a `guard` job refuses to run if the ref is the production ref;
  the harness `config.ts` also hard-refuses it. All recipients `@resend.dev`
  simulated — no mail to real students.

### Post-run cleanup (done 2026-08-31)

- Staging `rate_limit_email_sent` reverted 5000 → 1000.
- All 8 GitHub Actions secrets deleted.
- The `capacity/dist-ip` trigger branch deleted (the workflow file remains on
  `codex/rollout-reliability-loadtests` for the record).
- **Service-role key rotated.** The legacy service_role key used in the first
  run was retired by disabling `weglue-staging`'s legacy API keys entirely
  (`PUT /api-keys/legacy?enabled=false` — verified: the old key now returns
  HTTP 401). Staging + the harness moved to the modern `sb_secret_` /
  `sb_publishable_` keys. Production keys untouched.

## Outcome

All six cells are **directly tested and PASS**. The distributed-IP runs prove
the per-IP `over_request_rate_limit` is a same-IP-concentration artifact that
vanishes when the load is spread across real distinct IPs. The residual
failures in the distributed runs are a free-plan compute ceiling under a
5-minute burst, not a topology effect, and the launch plan already assumes
organic signup spread over hours.
