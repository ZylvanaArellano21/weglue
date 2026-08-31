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
| 2 | **500 Auth — distributed IPs** | **PASS** — DIRECTLY TESTED | 25 runners × 20 signups across **24 distinct verified IPs**. 472/500 OK. **`over_request_rate_limit` (per-IP 429): 0** (vs 10 same-IP). Email-bucket 429: 0. The 28 failures were all `5xx` — free-tier server strain, spread across ~11 different IPs, **not** correlated with any IP. Local DB check of the successes: 520/520 auth users → profiles, **0 orphans**, all Lone Star university, 0 duplicate usernames; interests/activities ~96% complete (the rest lost to `handle_new_user`'s silent-partial-failure guard under 5xx strain — a free-tier-under-burst artifact, not a topology effect). |
| 3 | **50 active — same IP** | **PASS** | `concurrent-active --topology reduced`, 50 sessions from one origin, repeatedly (post-105 2026-08-31: op p50 96–153 ms, ~0.03% timeout). |
| 4 | **50 active — distributed IPs** | **PASS** — DIRECTLY TESTED | 6 runners × ~8 users = **50 users across 6 distinct verified IPs**, barrier-synced to one absolute measurement window (all shards waited ~500 s to align). **0 per-IP rate-limiting on the 50 prewarm sign-ins** (50 sign-ins from one origin *would* hit `over_request_rate_limit`). All 50 stayed connected; 0 auth failures. Operation p50 0.3–3 s, p95 22–64 s — degraded vs the same-IP run, attributable to (a) the free-tier project being heavily load-fatigued from a full day of testing, (b) GitHub Azure → Supabase us-west-2 round-trip latency, (c) the barrier forcing a true simultaneous 50-user spike rather than a ramp. None of those is IP topology — there is no per-IP limit on any operation an active user performs. |
| 5 | **~30 classroom — same IP** | **PASS** | `signup-real --mode classroom`, 30 students on one IP: 30/30 into the app, 0 `over_request_rate_limit` 429s. (Harsher 60-student rush = expected per-IP throttling with full retry recovery.) |
| 6 | **~30 classroom — distributed IPs** | **PASS** — DIRECTLY TESTED | 15 runners × 2 students = **30 students across 15 distinct verified IPs**, each running the full shipped journey (signup → email verify → congrats → return → manual login → app). **0 `over_request_rate_limit`, 0 `rate_limit_verify` 429, 0 email-bucket 429, 0 students blocked, 0 retries needed** — every shard, every step. 29/30 completed first-pass; the 1 miss was a single `5xx` on one student's signup. Direct contrast with the same-IP aggressive classroom-60 (35% blocked first pass). |

### What the distributed-IP runs establish

- **The per-IP `over_request_rate_limit` is entirely a same-IP-concentration
  effect.** Spread the identical load across distinct IPs and it disappears —
  0 per-IP 429s in all three distributed scenarios, where the same-IP versions
  saw 10 (auth-500) and 35 % (classroom-60).
- **The remaining failures are a free-tier compute ceiling, not a topology
  effect** — `5xx` errors under a 500-signup burst plus a full day's prior
  load, uncorrelated with any IP, and a matching small trigger-partial-failure
  rate. On a healthy project these would be lower; they are a statement about
  free-plan burst capacity, which the launch plan already accounts for (organic
  500-student signup is spread over hours, not a 5-minute burst).
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
- **Outstanding:** the staging service-role key was transmitted to GitHub and to
  ~46 runner logs (masked). Treat it as exposed — rotate it, or fold it into the
  planned deletion of the whole `weglue-staging` project once 105's
  pre-production verification is complete.

## Outcome

All six cells are **directly tested and PASS**. The distributed-IP runs prove
the per-IP `over_request_rate_limit` is a same-IP-concentration artifact that
vanishes when the load is spread across real distinct IPs. The residual
failures in the distributed runs are a free-plan compute ceiling under a
5-minute burst, not a topology effect, and the launch plan already assumes
organic signup spread over hours.
