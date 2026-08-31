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

## The matrix

| # | Cell | Classification | Evidence / reasoning |
| --- | --- | --- | --- |
| 1 | **500 Auth — same public IP** | **DIRECTLY TESTED** | `signup-real --mode burst`, 500 real `/signup` calls from one origin. 490/500 succeeded; the 10 failures were late `over_request_rate_limit` 429s after ~400 sustained from the single origin. `handle_new_user` integrity perfect for all 490 (0 orphans, university, interests 490×3, activities 490×2, 0 dup usernames, `confirmation_sent_at` all set). Classified in the capacity report as "PASS WITH EXPECTED SAME-IP RATE LIMITING." |
| 2 | **500 Auth — distributed public IPs** | **INFERRED (strong)** — *direct test recommended* | Per-IP bucket is the only thing that changes; with each IP under its ~8 burst, expect ~500/500. Project-global concerns already cleared at this volume by cell 1: `rate_limit_email_sent` handled 500 confirmation emails, `handle_new_user` handled 490 concurrent inserts. Direct confirmation is cheap (see below) and worth doing — it validates the per-IP model at 500 scale and rules out any project-global signup contention that cell 1's own rate-limiting could have masked. |
| 3 | **50 active — same public IP** | **DIRECTLY TESTED** | `concurrent-active --topology reduced`, 50 sessions from one origin, 8–10 min measurement windows, repeatedly (incl. the post-105 regression 2026-08-31: op p50 108–153 ms, 0.05% timeout rate). The data plane has no per-IP limit, so this run already exercises the real bottleneck (realtime + DB, both project-global). |
| 4 | **50 active — distributed public IPs** | **INFERRED (near-certain)** | Identical to cell 3. 50 active users operate on existing JWTs; there is no per-IP limit on any operation they perform. Realtime and DB limits are project-global and already saturated in cell 3. Distributing IPs changes nothing measurable. Direct testing has ~zero information gain. |
| 5 | **~30 classroom — same public IP** | **DIRECTLY TESTED** | `signup-real --mode classroom`, 30 students on one public IP: 30 signup → verify → login at realistic classroom pace. 30/30 into the app, 0 `over_request_rate_limit` 429s. (The harsher 60-student rush was also run — expected per-IP throttling with full retry recovery, classified as an aggressive stress test, not a product failure.) |
| 6 | **~30 classroom — distributed public IPs** | **INFERRED (strong)** | Each student's device on cellular or a campus-Wi-Fi NAT sees its own (or a lightly-shared) per-IP bucket instead of one shared bucket. Strictly easier than cell 5, which passed. The genuinely conservative classroom case — a whole class behind one NAT — *is* cell 5. |

## Directly testing the distributed-IP cells — cheapest safe method

**No purchase required.** A **GitHub Actions matrix** gives genuine multi-IP
egress at $0.

- Each matrix job runs on a fresh GitHub-hosted runner with a **distinct public
  IP** (GitHub's Azure pool). A matrix of 20–40 jobs = 20–40 distinct source IPs.
- Cost: **$0** on a public repo; on a private repo, ~40 job-minutes against the
  included monthly quota (2,000 min free tier).
- Secrets needed: **staging URL + anon key only**. The `/signup` path does not
  use the service-role key, so no privileged credential is exposed to CI. (The
  anon key is a client-side value by design.)
- Safety: points only at staging `cwwmuxxqxovhcnnardlj` (the harness's
  `config.ts` already hard-refuses the production ref). Test recipients stay on
  `@resend.dev` simulated addresses — no mail to real students.

### Runbook (cell 2 — 500 Auth, distributed IPs)

1. Workflow `.github/workflows/capacity-distributed-ip.yml`, `workflow_dispatch`
   only, matrix `shard: [0..24]` (25 jobs).
2. Each job: `LOADTEST_* ` from repo secrets/vars, then
   `node dist/cli.js signup-real --mode burst --shard <n>/25 --count 20`
   (20 signups × 25 shards = 500, each shard from its own runner IP).
3. Post-run (one job, `needs: all`): the existing `triggerVerification` query
   against staging — assert 500/500 auth.users → profiles, 0 orphans,
   interests/activities counts, 0 duplicate usernames, `confirmation_sent_at`
   all set, and **0 `over_request_rate_limit` 429s** (the distinguishing result
   vs cell 1).
4. Teardown job: `node dist/cli.js teardown --manifest <shared>`.

Expected result: **500/500, 0 per-IP 429s**, integrity identical to cell 1's 490.

### Optional (cells 4 & 6)

The same workflow can carry two extra jobs — a 2-shard `concurrent-active` slice
and a 3-runner `signup-real --mode classroom` slice — for belt-and-suspenders
coverage of cells 4 and 6. Information gain is low (see the table); include only
if the founder wants every cell green by direct test rather than by mechanism.

### Alternative (if GitHub Actions is unavailable)

20–50 nano VMs (Hetzner CX22 / Fly.io shared-cpu-1x / DigitalOcean s-1vcpu-512mb),
each with its own IPv4, for ~1 hour: **≈ $1–2 total** (Hetzner ~€0.006/hr ×
50 × 1 hr ≈ €0.30 plus IPv4 fees ~€0.001/hr; Fly/DO similar). Same harness, one
shard per VM. Reported here for completeness — **not** to be provisioned without
explicit approval.

## Recommendation

- Cells **1, 3, 5**: directly tested → report as **PASS (directly tested)**.
- Cell **2**: run the free GitHub Actions matrix to convert INFERRED → DIRECTLY
  TESTED. One workflow, $0, ~15 min.
- Cells **4, 6**: report as **INFERRED**, with the mechanism stated (no per-IP
  limit on the data plane / distributed-IP is strictly easier than the tested
  same-IP case). Direct testing optional and low-value.

No infrastructure will be provisioned and nothing will be spent without explicit
founder approval.
