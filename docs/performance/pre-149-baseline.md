# Pre-149 scalability baseline (148 → 149)

Status: **harness implemented and verified offline; no load has been run.** Staging preparation, seeding and every campaign each need separate founder approval.

## 1. Purpose

Measure how the We Glue backend behaves under realistic authenticated student traffic with migrations **001–148**, then repeat the identical experiment with **only migration 149** added. The result answers two questions:

1. What concurrency does the pre-149 system sustain safely, and where does it degrade or break?
2. What does migration 149 (private `sync:block:<uid>` receive authorization) change, measured as paired differences under otherwise identical conditions?

The harness lives in `load-tests/`. It never changes application behavior, deploys nothing, and applies no migrations.

## 2. The exact 148 boundary

| Item | Value |
|---|---|
| Application contract | `9f16ae84af7b3959141c042bd049f3e47a6a72d1` (first-parent commit before the 149 merge) |
| Schema-148 merge | `3f9416d7157da8fcf57359702084d23d93bc9886` |
| Database pre-state | migrations 001–148, exactly as they exist at the contract commit |
| Excluded | `149_realtime_sync_block_auth.sql`, `150_dispatch_push_statement_wakeup.sql` |

Enforced by `src/contract.ts` and `src/preflight.ts`:

- The expected ledger is derived from `git ls-tree` at the contract commit. The live `supabase_migrations.schema_migrations` must match it exactly: no missing versions, no extras.
- The migration 149 and 150 files are pinned by SHA-256, so a silently edited artifact fails.
- **The ledger alone is not trusted.** Preflight fingerprints every function (`public`, `private`), policy (`public`, `private`, `realtime`, `storage`), trigger, publication, extension, cron job and `notification_config` row. It then checks the migration markers directly:
  - 149: `private.can_receive_block_sync(p_topic text)` and policy `realtime.messages:weglue_receive_block_sync`.
  - 150: triggers `trg_notifications_dispatch_insert` / `trg_notifications_dispatch_update` on `public.notifications`.

  At 148 all markers must be absent. At 149 only the 149 markers may be present. 150 is refused in both states. This matters in practice: a local stack inspected during implementation recorded ledger 148 but already carried both migration-150 triggers.

## 3. The 149 comparison rule

The post-state is the same staging project, compute, configuration, synthetic data, accounts, trace, seed, runner host, harness build and duration, with **only migration 149 applied**. `compare` rejects the comparison (verdict `INVALID`, exit code 2) unless:

- every controlled variable is identical across all compared runs: application contract, harness source hash, 149/150 artifact hashes, trace hash, synthetic-manifest hash, seed, namespace, controlled configuration hash, scenario, cache mode, plateau schedule, staging ref, push mode, k6 / supabase-js / Node versions, runner host (hostname, CPU model, CPU count) and database server version;
- replicates within one state have an identical ledger and identical fingerprint sections;
- the 149 ledger is exactly the 148 ledger plus `149`, and neither contains `150`;
- the fingerprint delta from 148 to 149 is **exactly** the two 149 objects, with nothing else added, removed or changed;
- no run is unfinished, interrupted, errored, or invalid (generator-bound).

## 4. Why production is forbidden

Production cannot represent 148 any more (its ledger is past 148, and `send-push` has been redeployed during P0.6-B), it holds real students' data, and load there could affect real users and the active P0.6-B validation. The harness therefore:

- hard-refuses the production ref `yoozrnosmqtaiksgcixc` in the URL, the configured ref, and the database URL (`src/config.ts`);
- accepts only the allowlisted staging ref `cwwmuxxqxovhcnnardlj`, requires the URL to be exactly `https://<ref>.supabase.co`, and requires the database URL to contain the staging ref;
- refuses keys whose JWT `ref` names another project;
- refuses a staging `push.dispatch_url` that targets production or any non-staging project;
- refuses any **active cron job** whose command calls production or another project. The contract schema's `sync-store-versions` job hard-codes the production URL, so it must be disabled on staging.

## 5. Staging requirements

1. A dedicated staging project at exactly 001–148 with a complete ledger (production has historical gaps, so it must not be cloned from production's ledger). Build it from the contract commit.
2. Recorded: plan, compute size, region, pooler mode, Auth rate limits, Realtime limits (concurrent clients **and** channel joins/second), disk IOPS, extensions, publications, cron jobs.
3. `notification_config.push.dispatch_url` null (`dispatch-disabled`) or pointing at staging (`staging-dispatch`). No production-calling cron job active.
4. An active university named `Load Test …` (its id goes in `LOADTEST_UNIVERSITY_ID`).
5. Edge Function inventory recorded in `LOADTEST_EDGE_FUNCTION_INVENTORY`, identical for 148 and 149.
6. A quiet window: no concurrent validation, migration, deployment or campaign.
7. A runner host with Node ≥ 20, k6 (not installed on this machine today), network reach to staging, and enough CPU. The supervisor stops if host CPU ≥ 85%.

## 5a. Prepared staging environment (2026-09-26)

Preparation only. Nothing was seeded, no load was generated, and production was not touched.

**Build.** On `cwwmuxxqxovhcnnardlj` (Free plan, Postgres 17.6), `supabase db reset --linked --no-seed` ran from a detached worktree at `9f16ae84`. The worktree held 142 migration files, with no 149 and no 150. It removed all previous staging data: 951 users, 21 clubs, 1,866 messages and 4 universities.

**Deviation: 8 data-seed migrations recorded, not executed.** The replay stopped at `095` (`zylvana21 profile not found`). Eight migrations need production-only data that no migration creates: the real profiles `zylvana21`, `sofiaruiz` and `KevinTS`, the Chess Club with the fixed id `e87b15ef…`, and 13 production club handles such as `TheAcademy`. Those eight are `095`, `096`, `106`, `107`, `116`, `120`, `123` and `132`. Each is pure data, with no DDL. With approval, they were marked applied (`supabase migration repair --status applied`). `097`–`148` were then applied with `supabase db push --include-all`, and the follow-up dry-run reports "up to date". So the schema, functions, policies, triggers, publications and cron definitions are exactly 148, while the production club and club-interest seed rows are absent. The workload uses only its own synthetic university, so it never reads those rows.

| Check | Result |
|---|---|
| Ledger | 142 versions, `001`…`148`, equal to the contract file list. `ledgerSha256` `94107665…0978be` |
| 149 / 150 markers | `migration149Function`, `migration149Policy`, `migration150InsertTrigger`, `migration150UpdateTrigger`: all absent |
| Schema fingerprint | 868 objects (cron, extension, function, notification_config, policy, publication, trigger) |
| `push.dispatch_url` | Replay set it to production's `send-push`, from an early migration. Nulled before any job could use it, so push mode is `dispatch-disabled`. `vault.secrets` is empty and `push_queue` is empty. |
| Cron | `sync-store-versions` (hard-codes the production URL) is **inactive**; it never ran. `dispatch-push` (every minute) and `process-event-reminders` (every 5 min) are active and staging-local; with no URL and no secret, dispatch returns before any HTTP call. `net._http_response` is empty, so staging has made no outbound request. |
| Edge Functions | none (`LOADTEST_EDGE_FUNCTION_INVENTORY=none`) |
| Auth | `jwt_exp` 3600, refresh-token rotation on, `rate_limit_token_refresh` 150 per 5 min per IP, `before_user_created` hook = `public.before_user_created`, which allows `.invalid` addresses. No custom access-token hook. |
| Realtime | 200 concurrent clients, 100 joins/s, 100 events/s |
| Campus data | Created by migrations: `Lone Star College – Montgomery` (6 clubs), `Texas A&M University – College Station`. Added for the test: `Load Test Pre-149 University` (`55da4a32-026d-413a-ac77-c252508542c0`), active, `allowlist` mode for `loadtest.invalid` only. |
| Users | 0 in `auth.users`; 0 synthetic push tokens; no other active client backends |
| Preflight (state 148) | **pass**, 2026-09-26T02:17:13Z |

**Resulting ceiling:** `min(150, floor(0.75 × 200))` = **150 users**. The planned peak is 15 joins/s against a budget of 75.

**Credentials:** the staging database password was rotated. It is stored with the anon and service keys (verified to be for this ref and role) in a 0600 file outside the repository. Nothing was printed or committed.

**Runner host:** k6 is not installed on this machine, and it is required before any plateau can run.

## 5b. Shakedown attempt (2026-09-26): stopped before any load

Approved scope: install k6 (Homebrew, **k6 v2.3.0**), seed the minimum fixture, and run the 1 → 5 user shakedown. **No load was generated.** The supervisor aborted at its leftover-rows check, and the environment was then found unfit.

**Fixture seeded** (namespace `wg-loadtest-pre149-shakedown`, Load Test Pre-149 University only):
- 5 synthetic users (`@loadtest.invalid`, placed on the Load Test campus by We Glue's own signup hook);
- 5 clubs, 100 events, 300 photo posts, 200 messages, 25 memberships, 10 follows, 5 likes, 5 comments;
- trigger-generated rows: 10 conversations, 20 channels, 450 notifications, 300 photo fan-out jobs.

A full before/after row-count diff of 119 tables shows writes only in synthetic scope:
- 0 notifications to non-synthetic users;
- 0 `push_queue` rows and 0 pg_net requests;
- 0 profiles outside the Load Test university.

Five password sign-ins succeeded with no Auth errors.

**Harness defects found and fixed** (none is a We Glue defect):
1. **Legacy keys:** staging has legacy JWT API keys disabled, so the harness now uses the project's publishable and secret keys.
2. **Seed permissions:** the 148 schema grants `service_role` only `SELECT` on every fixture table, so the service-role seed could never write. Users now sign up through the Auth admin API with the campus slug, and the fixture is written by the database owner in one atomic transaction.
3. **Seed message ordering:** seed messages were inserted before membership and without a user identity, so We Glue's `channel_restricted` trigger correctly rejected them. They are now posted after membership, under each sender's JWT claims, and the trigger evaluates and passes normally.
4. **SQL binding:** scoped cleanup and count statements received more bind parameters than they referenced, and Postgres rejects that. That was the campaign abort. Every harness statement is now bound densely and has been executed against the real staging schema in a rolled-back transaction.

**Staging anomaly, the blocker:** pg_cron's scheduler, running since 2026-08-29, survived the reset with a stale job cache. It executes three jobs that are no longer in `cron.job` and cannot be unscheduled:

| Job | Command | Schedule |
|---|---|---|
| #7 | `cleanup_orphaned_pending_avatars()` | — |
| #8 | `process_notification_fanout()` | every minute |
| #9 | the fan-out reaper | every 5 min |

`pg_stat_statements` counts about 39,000 calls to #8. After the seed it began draining the fixture's photo fan-out jobs, 10 per minute, writing `club_post` notifications after the seed watermark. None of these jobs makes an HTTP call, but they are an uncontrolled writer outside the 148 contract. Preflight now refuses any recent run of a job absent from `cron.job` (`assertNoUnlistedCronRuns`). Clearing the stale cache needs a staging database restart.

## 6. Synthetic-data rules

- Accounts are created with the Auth Admin API as confirmed users: `wg-loadtest-<namespace>-<n>@loadtest.invalid` (reserved TLD, so no email can be delivered), deterministic passwords, `user_metadata.loadtest_namespace`. No OTP, confirmation email or signup flow is exercised.
- Profiles have `is_seed = true` and the Load Test university. The seeder refuses to reuse any profile that is not seed data in that university.
- IDs are name-based UUIDs derived from namespace and index (`k6/lib/uuid.js`, shared by Node and k6).
- Fixture (default 250 users): clubs of 5 / 25 / 75 / 150 / 250 members with two officers each. The Members conversation and main channel are the ones `handle_club_created` creates. The seed adds 40 messages per conversation, 100 events (every fifth in the past), 300 posts (image URLs on `example.invalid`), two follows, one like and one comment per user, every tenth user private, and representative channel mutes and message hides.
- Content is created before memberships, so fixture creation does not fan out club-post, event or message notifications. Campaign writes do exercise the real fan-out.
- `messages.client_tag` is a `uuid` column. Campaign sends use deterministic UUID tags, and the namespace marker (`<namespace>:action:…:t:<send-ms>`) travels in the content.
- **No push tokens.** Preflight refuses if any synthetic user has one. No request touches `push_tokens`, `/functions/v1`, Expo, Auth signup/OTP, or Storage (`assertAllowedStages`).
- After seeding, the database clock is recorded as `seededAt`. Everything a synthetic user owns after that instant is campaign-generated and resettable.

## 7. Workload model

`src/trace.ts` produces a deterministic, SHA-256-sealed action trace from `(namespace, seed, users)`:

- **Archetypes** follow the approved 60 / 25 / 15 mix (browser / social / communicator), assigned so that every plateau prefix stays within ±1 user of the mix (150 users → 90 / 38 / 22).
- **Pacing** is uniform 8–20 s think time (≈ 14 s mean).
- **The first action of every plateau is a cold authenticated launch.** It covers `my_access_state`, the profile, interests, `my_sync_university_id` and the app release, then `get_unread_summary`, the full `getMyChats` embed, message hides, channel mutes and officer clubs, then Home posts (three-stage fan-out) and Home events.
- Journeys (`k6/lib/journeys.js`) mirror the app's `Promise.all` groups at the contract commit: home, events, discover (including `search_discovery`), club profile (`get_club_profile_events`, `club_shared_identities`), notifications (list, mark read, unread summary), inbox, thread (messages, hides, `cleared_before`, shared identities, restricted senders, `mark_conversation_read`), message send, and social writes (RSVP or save, toggled on then off).
- Writes are about 10% of actions. Realtime delivery latency is measured from the send time embedded in each message.

**Realtime** (`src/realtime-worker.ts`, one process per 25 users per plateau). Each user holds the app's always-on topology:

- private broadcast channels (`private: true`) for `sync:access:<uid>`, `sync:university:<uni>`, `sync:message-inbox:<uid>` and `sync:block:<uid>`;
- public `postgres_changes` channels `notifications:<uid>:<salt>:<n>` and `club-sync:<salt>:<n>`, with the app's bindings;
- `sync:message:<conversation>` for communicators;
- `sync:message-inbox-conv:<conversation>:<epoch>` for every banner-active conversation, staggered 180 ms.

At 148 the `sync:block` join is **expected to be denied** (its receive policy arrives in 149). It is recorded separately and excluded from the valid-join failure rate. Like the app, the client does not retry an Unauthorized denial. At 149 the same denial is a failure. Reconnects use the app's jittered ladder (1–1.5 s, 2–3 s, 5–7.5 s, then 10–15 s).

**Scenarios**:
- `steady` (default): the plateau ramp.
- `cold-connect`: users arrive at 1, 3, 5 or 10 per second.
- `reconnect`: at the midpoint of each hold, every socket is closed uncleanly, simulating a shared-network drop, and time to full resubscription is measured.

## 8. Ramp

`min(150, floor(0.75 × verified Realtime limit))` is the ceiling. Requests above it are refused rather than clamped. Planned joins per second (arrival rate × 12 channels, the maximum per user) must stay within 75% of the verified joins-per-second limit.

| Plateau users | 1 | 5 | 10 | 25 | 50 | 75 | 100 | 150 |
|---|---|---|---|---|---|---|---|---|
| Hold | 5 min | 5 min | 10 min | 10 min | 10 min | 10 min | 10 min | 15 min |

Each plateau is an **independent run**:
1. Sessions are refreshed outside the measurement window. Refreshes are spaced so that any 5-minute window stays within 75% of the verified per-IP `rate_limit_token_refresh` (`LOADTEST_VERIFIED_TOKEN_REFRESH_LIMIT`). At 150 this means at least 2,703 ms between refreshes (≤ 112 per window), so a full 150-session pass takes up to about 8 min. The plateau's token-coverage check includes that pass.
2. Load ramps up over 2 min, holds, then ramps down over 30 s.
3. A 5-min idle cooldown follows.
4. The supervisor classifies the plateau and **does not advance past a degraded plateau or any hard stop.**

A 15-minute idle baseline precedes every campaign. At 150 users one run takes about 2 h 30 min.

## 9. Metrics

- **k6, per plateau**:
  - p50/p90/p95/p99/max for interactive journeys, cold launch, and each journey;
  - per-60 s window interactive p95, error rate and timeout rate;
  - status-code counts (0, 401, 403, 404, 409, 429, 5xx);
  - requests/s, iterations, dropped iterations, bytes, connect/TLS p95, synthetic write count;
  - raw per-request NDJSON (`k6-p<n>.json.gz`).
- **Realtime, per window and shard**:
  - attempts, subscribed, expected-unauthorized, unauthorized, errors and timeouts per topic kind;
  - join latencies, full-resubscription times and incomplete resubscriptions;
  - delivered `new_message` events, delivery latency, duplicates;
  - event-loop lag.
- **Observer (every 5 s, whole campaign)**:
  - connections (total, active, idle, lock-waiting) against `max_connections`;
  - deadlocks, blocked-query age, longest transaction;
  - commits, rollbacks, temp bytes;
  - pending pushes and oldest pending push age, `pg_net` queue depth, notifications generated;
  - non-synthetic recipients and foreign-conversation writes;
  - host CPU, memory and disk IOPS from the Supabase Metrics API (node_exporter series), where available.
- **Generator**: host CPU every 5 s.
- **Not captured automatically; the operator records these from the dashboard**: API/Auth/Realtime reports, provider quota messages (`too_many_*`), Query Performance (`pg_stat_statements`), and logs.

## 10. Hard stops

Any hard stop ends the campaign, and the cooldown still runs so recovery is observed.

| Source | Condition |
|---|---|
| Config / preflight | production or non-allowlisted target; ledger or marker mismatch; push dispatch or cron reaching production; synthetic push token; leftover run rows |
| k6 (abort) | request errors > 5% (after 60 s); timeouts > 1% (after 60 s); interactive p95 > 5 s (after 120 s); cold-launch p95 > 15 s |
| Realtime worker | valid join failures > 2% (at least 50 attempts); join p95 > 15 s; full-resubscription p95 > 15 s; event-loop lag p95 > 50 ms (run invalid) |
| Observer | any new deadlock; blocked query > 30 s; connections ≥ 85% for 60 s; CPU ≥ 90% for 2 min; memory ≥ 90% for 60 s; disk IOPS ≥ 95% of limit for 2 min; `pg_net` queue > 500; a synthetic actor notifying a non-synthetic user; a synthetic user writing outside manifest conversations |
| Supervisor | generator CPU ≥ 85% for 15 s (run invalid); any worker non-zero exit; operator creates `EXTERNAL_HARD_STOP` in the run folder or sends Ctrl-C |
| Operator (dashboard) | provider quota errors, unexpected queue growth, or any of the resource conditions above when the Metrics API is unavailable |

k6 thresholds are cumulative over the plateau run, which approximates the approved "for N seconds" windows. The windowed evaluation below applies the approved degradation rules exactly.

## 11. Capacity definitions (as implemented in `src/analyze.ts`)

- **Broken**: any hard stop; or, over the plateau, request errors > 5%, timeouts > 1%, interactive p95 > 5 s, cold-launch p95 > 15 s, valid join failures > 2%, full-resubscription p95 > 15 s, or users that never fully resubscribed.
- **Degraded**: in **two consecutive 60 s hold windows**, any of:
  - interactive p95 > 2× the low-load reference and at least 250 ms worse (the reference is the first plateau with ≥ 20 interactive samples);
  - request errors ≥ 1%;
  - Realtime join p95 > 2 s or valid join failures ≥ 0.5% (windows with ≥ 20 attempts);
  - database CPU or connections ≥ 70%.

  A plateau is also degraded if dropped iterations reach 0.5%, if the last minute of cooldown is not within 10% of idle health (connections ≤ max(idle × 1.1, idle + 2); CPU ≤ idle + 0.10), or if recovery could not be verified.
- **Invalid**: generator-bound (event-loop lag, host CPU, or dropped iterations > 1%). This is never reported as system capacity.
- **Safe**: none of the above.
- **Safe tested concurrency** (per state): the highest plateau that is safe in **every** replicate. It requires at least two replicates.
- **Degradation / breaking point**: the earliest across replicates. The recommendation is the plateau before the breaking point.

## 12. Reproducibility

- One trace file and one synthetic manifest are generated once and reused unchanged for every 148 and 149 run. Both hashes are recorded and compared.
- The per-user action order, entities, think times and message tags are identical across runs. VU *n* is always synthetic user *n* − 1.
- Every run writes `run-manifest.json` containing:
  - the harness git HEAD and a source hash of `src/`, `k6/` and `package.json`;
  - the contract commit and the 149/150 artifact hashes;
  - the full preflight report: ledger, ledger hash, per-object schema fingerprint, markers, push mode, cron inventory, server version;
  - the trace and seed hashes, the controlled configuration and its hash;
  - tool versions and the runner host;
  - the planned plateaus, per-plateau start, load-end and cooldown-end times, session refresh counts and exit codes;
  - the status and stop reason.

  The manifest is refused if it contains any key, database URL or token.
- Between runs, `reset-actions` returns the fixture to its seed state in one transaction, then runs `VACUUM (ANALYZE)` on the six affected tables, so each phase starts from the same logical and physical state.
- Cold and warm runs are labelled (`LOADTEST_CACHE_MODE`) and never mixed in one comparison.

## 13. Execution procedure (requires separate approval at each step)

1. **Environment preparation**: build staging at exactly 001–148 from the contract commit; disable production-calling cron jobs; set push dispatch to null or a staging URL; create the `Load Test …` university; record limits and inventory.
2. `pnpm install --frozen-lockfile`, `pnpm --filter @weglue/load-tests build`, then `pnpm --filter @weglue/load-tests test`.
3. Export the variables from `load-tests/.env.example`. `plan` is offline. `preflight` is read-only.
4. With write approval: `seed` → `trace` → `prepare-auth` (paced sign-ins). Archive the manifest and trace hashes.
5. **1–5-user shakedown**: `LOADTEST_REQUESTED_USERS=5`, short labels. Verify rows, joins, the 148 `sync:block` denial, deliveries, and `reset-actions`.
6. With campaign approval: two or more 148 replicates (`LOADTEST_RUN_LABEL=r1`, `r2`, …), with `reset-actions` before each. `campaign` repeats preflight, refuses leftover run rows, and runs the idle baseline and plateaus.
7. Freeze the 148 artifacts. After 149 is separately validated, apply **only** migration 149 to the same staging project. Set `LOADTEST_EXPECTED_STATE=149` and change nothing else. `preflight` must pass the 149 markers.
8. Run the same number of 149 replicates with the same trace, manifest and host.
9. `compare --pre <148 run dirs> --post <149 run dirs> --out <prefix>`.
10. Cleanup (write approval): `cleanup` after all artifacts are archived.

The operator watches the Supabase dashboard throughout and creates `EXTERNAL_HARD_STOP` in the run folder to stop.

## 14. Cleanup procedure

- **`reset-actions`** runs between runs and phases in one transaction. It first aborts if any non-campaign message exists in synthetic conversations after `seededAt`, or if any synthetic actor notified a non-synthetic user. It then:
  - deletes synthetic users' notifications and push-queue rows created after `seededAt`;
  - deletes the campaign messages (namespace marker, synthetic sender, manifest conversation, after `seededAt`);
  - deletes all synthetic RSVPs and saves (the fixture has none);
  - restores seed-time notifications to unread and resets participants' `last_read_at` to `seededAt`.

  It finishes with `VACUUM (ANALYZE)`.
- **`cleanup`** (final): runs `reset-actions`, then deletes the manifest clubs that are still seed data in the namespace (cascading their conversations, channels, messages, events and posts), then deletes each synthetic Auth user (cascading the profile and every per-user row). The Load Test university is kept as an environment fixture.
- Known residual drift, not reset: `clubs.last_activity_at` and cumulative database statistics counters.

## 15. Comparison procedure

`node load-tests/dist/src/cli.js compare --pre … --post … --out results/compare-148-149` writes JSON and Markdown:

- the verdict: `VALID`, `INCONCLUSIVE` (fewer than two replicates per state), or `INVALID` (with every invalidating problem);
- the replicate pairs (sorted by run label);
- per-state safe tested concurrency, degradation point and breaking point, and whether replicates agree;
- per plateau:
  - interactive p50/p95/p99 and cold-launch p95;
  - error, timeout and request rates;
  - Realtime join p95 and valid join failures;
  - `sync:block` subscribed and expected-unauthorized counts and `sync:block` join p95;
  - full-resubscription p95 and delivery latency p95;
  - database connections, CPU and commits/s, notifications generated, pending pushes;
  - p95 for every journey.

  Each metric shows both means, the percent change, per-pair percent changes, the mean paired change with a t-based 95% confidence interval, and the raw sample counts per run.

## 16. Differences from the original proposal

- File layout: `observer-worker.ts` replaces `observer.ts`, and one shared `k6/lib/journeys.js` replaces `k6/journeys/*.ts`. The same module is executed by k6 and verified by Vitest. Analysis lives in `analyze.ts`, comparison in `compare.ts`.
- Bounded Storage/media reads are **not implemented**: fixture images are on `example.invalid`, and media needs its own campaign.
- The chat fan-out at 5/25/75/150 members is exercised through the steady mix (communicators send into conversations of every size), not as a separate isolated scenario.
- The per-journey windowed p95 is not available. Window-level degradation uses overall interactive p95; per-journey p95 is reported per plateau.
- "Missing" Realtime events are not computed. Only deliveries, duplicates and latency are.
- Supabase API/Auth/Realtime report metrics and `pg_stat_statements` are recorded by the operator, not scraped.
- Password sign-ins are paced (default 10 s apart) to stay under per-IP Auth limits, so preparing 150 sessions takes about 25 minutes before the first campaign.
