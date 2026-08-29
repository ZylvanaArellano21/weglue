# We Glue staging load-test harness

This is a laptop-sized Node/TypeScript harness for the We Glue Auth, PostgREST, Realtime, notification, and photo-post fan-out paths. It is intentionally not a production traffic tool and it never contains a Supabase URL, project ref, or key.

The runner uses `@supabase/supabase-js` instead of k6 so one process can use Auth, authenticated PostgREST, the service-role inspection path, and Realtime sockets. It also uses `pg` only when `LOADTEST_DATABASE_URL` is supplied, allowing the observer to read `pg_stat_activity`, `pg_stat_database`, and `cron.job_run_details` directly. No scenario is executed by the build or type-check commands.

## Safety and configuration

The hard safety rule is enforced in `src/config.ts`: every command that can contact Supabase hard-fails if either `LOADTEST_SUPABASE_URL` or `LOADTEST_DATABASE_URL` contains the production ref `yoozrnosmqtaiksgcixc`. The production ref is `yoozrnosmqtaiksgcixc`. Use a staging URL, anon key, service-role key, and a synthetic university UUID.

Install and compile once:

```sh
pnpm --dir load-tests install
pnpm --dir load-tests build
```

Required environment variables:

```sh
export LOADTEST_SUPABASE_URL='https://STAGING_REF.supabase.co'
export LOADTEST_STAGING_REF='STAGING_REF'
export LOADTEST_SUPABASE_ANON_KEY='staging-anon-key'
export LOADTEST_SUPABASE_SERVICE_KEY='staging-service-role-key'
export LOADTEST_UNIVERSITY_ID='00000000-0000-4000-8000-000000000001'
export LOADTEST_EMAIL_DOMAIN='staging.example.edu'
export LOADTEST_CONFIRM_WRITES='i-understand-this-writes-to-staging'
```

`LOADTEST_STAGING_REF` and the exact `LOADTEST_CONFIRM_WRITES=i-understand-this-writes-to-staging` approval are required for every write scenario, including seed and teardown. Synthetic load must be a deliberate act against a known staging project, never a default. `LOADTEST_STAGING_REF` must be the same 20-letter project ref parsed from the Supabase URL; the confirmation is environment-only and cannot be enabled from the JSON file. `report` is local-JSON-only and remains ungated.

`LOADTEST_EMAIL_DOMAIN` must be an educational domain accepted by the staging Auth hook and mapped to the synthetic university if the staging project uses domain mapping. Other options:

```sh
export LOADTEST_DATABASE_URL='postgresql://...staging pooler or direct connection...'
export LOADTEST_RESULTS_DIR='load-tests/results'
export LOADTEST_SEED_NAMESPACE='burst'
export LOADTEST_REQUEST_TIMEOUT_MS=20000
export LOADTEST_OBSERVE_INTERVAL_MS=5000
```

`LOADTEST_DATABASE_URL` is optional but required for full PostgreSQL observability. It must be a staging connection and is never written to result files. Instead of environment variables, set `LOADTEST_CONFIG_FILE=load-tests/config.example.json` to point at a private JSON file with the same camelCase fields; environment variables take precedence. Do not commit a private config file or any result containing credentials.

The service key is used only for synthetic data setup/teardown, safe row-count inspection, and the signup fallback onboarding writes needed when email confirmation means `signUp` returns no session. It is not printed or persisted.

## Seed and teardown

Seed one synthetic university population. The seed is idempotent for a namespace and size: profiles, three clubs, memberships, three future events, photo posts, and club chat conversations are reused when their deterministic markers already exist. Every created profile/club/event has seed markers; the manifest records exact IDs and passwords under the results directory.

```sh
LOADTEST_UNIVERSITY_ID='00000000-0000-4000-8000-000000000100' pnpm --dir load-tests seed -- --size 100 --namespace burst
LOADTEST_UNIVERSITY_ID='00000000-0000-4000-8000-000000000300' pnpm --dir load-tests seed -- --size 300 --namespace burst
LOADTEST_UNIVERSITY_ID='00000000-0000-4000-8000-000000000500' pnpm --dir load-tests seed -- --size 500 --namespace burst
```

The photo matrix needs all three manifests, and the three IDs must be distinct so the university fan-out recipient counts are actually ~100, ~300, and ~500. Other scenarios can use any manifest, with `--manifest load-tests/results/seed-burst-500.json` where needed. Teardown takes the exact manifest IDs and deletes only those synthetic rows/users. If the configured university already existed, teardown leaves it in place.

```sh
pnpm --dir load-tests teardown -- --manifest load-tests/results/seed-burst-500.json
```

Run teardown once per manifest. A seed user is a real staging Auth user; deletion is permanent within staging.

## Scenarios

### SIGNUP-BURST

Creates new unique educational-domain accounts and sends Auth signup requests over an arrival curve. `all` is a single laptop burst, `ramp` spreads requests across `--duration-ms`, and `nat` uses a bounded worker pool from one process so requests share the same campus egress IP. The harness cannot spoof source IPs; `nat` models the shared egress shape only.

```sh
pnpm --dir load-tests signup-burst -- --count 500 --arrival all
pnpm --dir load-tests signup-burst -- --count 500 --arrival ramp --duration-ms 300000
pnpm --dir load-tests signup-burst -- --count 500 --arrival nat --duration-ms 300000 --nat-concurrency 20
```

Each signup includes interests and activities in Auth metadata, then drives profile, interests, and activities writes. Results include signup p50/p95/p99, error rate, error classes including `429 over_email_send_rate_limit`, `5xx`, and `timeout`, plus `verification_emails_accepted` and `verification_emails_rejected`. A successful `signUp` with no session is counted as Auth accepting the verification email request; the service fallback only completes staging onboarding rows.

Expected cost: 500 Auth users, approximately 500 profile updates and 2,000 onboarding relationship inserts, plus Auth email sends. This directly quantifies the known 1,000/hour email-rate-limit gap; it does not try to work around it.

### VERIFY/RESET/CHANGE-EMAIL reliability

This is deliberately low-rate. It tests signup resend, password reset, and authenticated email change, capturing status/code/message and parsed cooldown seconds. The default is ten users, one of each operation, with a six-second pause between operations.

```sh
pnpm --dir load-tests email-reliability -- --manifest load-tests/results/seed-burst-100.json
pnpm --dir load-tests email-reliability -- --users 10 --operations resend,reset,change-email --interval-ms 6000
```

Expected cost: at most 30 Auth email operations by default. Increase slowly; the point is to observe the 60-second per-identity SMTP cooldown and 30-count verification/OTP limits, not to exhaust them accidentally.

### CONCURRENT-ACTIVE

Signs in up to 50 seeded students, opens three Realtime channels per student (home, club, unread), and sustains a duty cycle of feed read, search, club view, event view, RSVP, like, comment, and chat-message operations.

```sh
pnpm --dir load-tests concurrent-active -- --manifest load-tests/results/seed-burst-500.json --users 50 --duration-ms 600000 --duty-ms 5000
```

Results include per-operation latency percentiles, action errors, Realtime joins/errors/events, and observer snapshots. With the 5-second duty cycle the laptop attempts roughly 600 actions/minute across 50 users, plus 150 Realtime channels. Expected cost is 50 websocket/channel identities, normal PostgREST writes for RSVP/like/comment/message, and notification/push trigger work. The scenario is below the Realtime 200-user and 100-join/sec ceilings by design; snapshots show whether DB connections or downstream triggers become the limiting factor.

### PHOTO-POST FAN-OUT

This is the priority scenario. It inserts image-bearing `posts` rows so `notify_photo_post_university()` runs synchronously, for all sizes and concurrency levels. Image bytes are not uploaded: a staging-only invalid placeholder URL is used so the measurement isolates DB creation and fan-out rather than storage bandwidth. The matrix is 100/300/500 members × 1/10/50 concurrent posts.

```sh
pnpm --dir load-tests photo-fanout -- --namespace burst --members 100,300,500 --concurrency 1,10,50 --drain-wait-ms 5000
```

The result records p50/p95/p99 post DB-creation latency, failed inserts/timeouts, notification-row amplification, push queue status before/after and deltas, duplicate posts, and observer snapshots. With `LOADTEST_DATABASE_URL`, snapshots also include connection totals, `pg_stat_activity` wait events, blocked queries, `pg_stat_database` transaction/block/deadlock counters, and recent cron run details.

The max-case pass criteria are: all 50 posts complete, zero unintended duplicate rows, no observed connection exhaustion (`current_connections < 60`), no blocked/unstable DB evidence that makes the run unreliable, and no post insert failure caused by fan-out. The ~3,000 ms p95 creation number is guidance; correctness and stability are the decision bar. Fan-out amplification should be close to members minus one per post because the author is excluded. The push queue is observed for growth and drain; this harness does not dispatch or alter it.

Expected cost: up to 450 image-bearing post inserts over the full matrix, and approximately 225,000 notification/push trigger attempts in the 500-member cases if every recipient is eligible. On a free Supabase project this can be materially expensive in DB CPU and should be run only against staging.

### Duplicate-action / idempotency probes

Runs two concurrent creates for post, comment, event, RSVP, and club join, once without a tag and once with the same UUID `client_tag` where migration 100 defines the column. It records successful IDs, row counts, duplicates, unique errors, and cleans the probe rows afterward.

```sh
pnpm --dir load-tests idempotency -- --manifest load-tests/results/seed-burst-100.json
```

Migration 100 exact columns/indexes are `posts.client_tag` with `(author_id, client_tag)`, `events.client_tag` with `(created_by, client_tag)`, and `post_comments.client_tag` with `(user_id, client_tag)`. RSVP and `club_members` have natural unique keys but no `client_tag`; those are explicitly reported as `natural-key-only`, and the tagged attempt is expected to be schema-rejected rather than silently treated as idempotent.

## Results and reports

Each observed scenario writes a timestamped JSON file under `LOADTEST_RESULTS_DIR`. It contains config identity (URL, university ID, namespace only), raw samples, percentile-ready tables, error classes, scenario details, and before/during/after observations. It never contains keys or passwords. The observer takes a before snapshot, periodic during snapshots, and an after snapshot. Missing `LOADTEST_DATABASE_URL` is recorded as an observability warning, not silently presented as zero connections.

Render a short Markdown report:

```sh
pnpm --dir load-tests report -- --input load-tests/results/RESULT.json --output load-tests/results/RESULT.md
```

The report shows percentile tables, error classes, maximum observed connections, blocked-query samples, photo matrix verdicts, and `PASS`/`FAIL`/`UNKNOWN` for the max photo criteria. `UNKNOWN` means the evidence needed for that criterion was not available—for example, no direct database URL—not that the staging system passed.

## Free-plan reference ceilings

Use the report beside the staging Supabase dashboard/config for the declared limits: Postgres max connections 60; GoTrue DB pool 10; Realtime max concurrent users 200, joins/sec 100, events/sec 100, channels/client 100; Auth email send 1,000/hour; SMTP max frequency 60 seconds per identity; verify/OTP 30. The harness observes and quantifies these ceilings; it does not change Supabase settings, upgrade the project, deploy, push, or run against the production ref.
