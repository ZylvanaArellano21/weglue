# Staging Supabase project — setup runbook

Status: runbook only. Nothing here is executed until the founder creates the project and hands over the connection details. No production change.

## Why

A dedicated staging Supabase project is the critical path. It is the only environment that unblocks:

- **Full migration-chain validation** — a fresh project applies `001 → 101` against a real GoTrue schema (the local Docker stack cannot: its `supabase/postgres` image resets `auth.*` to a 2018 schema, so `email_confirmed_at` etc. are missing — see `project_weglue_local_stack_hazards`).
- **Migrations 099 / 100 / 101 staging application** — currently branch-only, validated only in `BEGIN/ROLLBACK` on the drifted local DB.
- **BE-3 Realtime measurement** — needs concurrent connections against real Realtime tenant limits.
- **BE-7 session / refresh-token backend verification** — needs real auth traffic; the unexpected-logout root cause stays "probable, not proven" until reproduced + verified here.
- **BE-6 load harness** — signup burst, concurrent-active, photo-post fan-out, idempotency probes.
- **The 500 Auth/onboarding burst tests and the 50 active-user tests.**

## Cost and plan

- The org **We Glue App** (`xzvqhyfdoetgpkiabnfm`) is on the **free** plan with **one** project (prod `yoozrnosmqtaiksgcixc`). Supabase free allows **2 active projects per org**, so a staging project is **$0 and not a Supabase upgrade**.
- **Free projects pause after 7 days of inactivity.** A staging project used in bursts will pause between test campaigns; un-pausing from the dashboard takes a few minutes. Plan test campaigns in blocks and pause deliberately afterward.
- Some free limits are **org-wide, not per-project** (notably monthly active users and egress). 500 synthetic signups ≈ 500 MAU against the 50,000 org limit — negligible. Egress from load runs is small (no media). Not a concern at this scale, but do not leave synthetic load running idle.
- **Region: `us-west-2`** — match prod so latency numbers transfer.

## Prerequisites (founder)

1. Supabase dashboard access to the **We Glue App** org.
2. Supabase CLI installed and logged in (`supabase login`) on the founder's machine. Migrations run either from that machine or from this session — but only ever with the DB password supplied through the environment (`SUPABASE_DB_PASSWORD`), never pasted into the conversation (see Step B).
3. A decision on **staging email** (see Step F): a separate Resend domain/key for staging, a mail catcher, or the built-in 2/hr mailer (functional tests only — the burst-deliverability test needs realistic SMTP).

---

## Step A — Create the project (founder, dashboard)

Dashboard → **New project** in the **We Glue App** org:

- Name: `We Glue Staging`
- Region: **us-west-2** — this is **verified** as production's region (Management API `GET /v1/projects/{ref}` → `"region": "us-west-2"`). Match it; there is no documented reason to diverge.
- Database password: generate a strong one and **save it in a password manager**.
- Plan: **Free**.

Wait for provisioning (~2 min).

## Step B — Connection details and the secrets rule

**Secrets never enter this chat.** The founder shares exactly one non-secret value with this session:

- **Project ref** (the `xxxxxxxxxxxxxxxxxxxx` in the project URL) → `LOADTEST_STAGING_REF`. This is public and safe to paste.

Everything else stays in the founder's local environment / the Supabase vault, never in the conversation:

| Value | Where it lives | Used by |
| --- | --- | --- |
| DB password | `SUPABASE_DB_PASSWORD` env var in the founder's shell, or entered at the `supabase link` prompt | `supabase link`, `supabase db push`, psql |
| `service_role` key | `LOADTEST_SUPABASE_SERVICE_KEY` in the founder's local `load-tests` env / config file (git-ignored) | load harness, observability collector |
| `anon` key | `LOADTEST_SUPABASE_ANON_KEY` in the same local file (public-ish, but keep it out of chat for consistency) | load harness signup path |
| worker / dispatch / Resend secrets | `supabase secrets set` run from the founder's machine, and `vault.create_secret(...)` run via psql by the founder | edge functions, cron worker jobs |

If this session needs to run `supabase db push` or psql, the founder exports `SUPABASE_DB_PASSWORD` (and the already-present `SUPABASE_ACCESS_TOKEN`) in the shell this session's tools inherit — the session reads it from the environment, never from a message. Alternatively the founder runs those commands themselves and pastes back only non-secret output (the migration ledger, cron job list, verification counts).

## Step C — Isolation-gated migration apply

`supabase db push` replays `001 → 101`. Several **historical** migrations, during their own execution, seed the production send-push URL into `notification_config` (046) and schedule cron jobs that reference production worker URLs (061 / 071 / 091). None of these historical files may be edited. Instead the apply is gated so that **at no point — not even for one cron tick — can staging contact production**.

### Why staging cannot reach production (the structural guarantee)

Read `invoke_push_dispatch()` (migration 046) and the worker cron bodies (061 / 071). Every one of them makes its outbound `net.http_post` call **conditional on a `vault.decrypted_secrets` row**:

- `invoke_push_dispatch()` returns early if `push_queue` has no pending rows **and** returns early if `push_dispatch_secret` is not in the vault (`IF v_url IS NULL OR v_secret IS NULL ... RETURN;`) — the `net.http_post` line is never reached.
- The account-deletion and message-privacy worker jobs are `SELECT net.http_post(...) FROM vault.decrypted_secrets s WHERE s.name = '<worker>_secret'` — with the secret absent, the `SELECT` returns **zero rows** and `net.http_post` is never evaluated.
- `process_event_reminders()` reads `events` — empty on a fresh project.

**No migration creates any vault secret** (verified: migrations only ever *read* `vault.decrypted_secrets`). So on a fresh staging project the three secrets — `push_dispatch_secret`, `account_deletion_worker_secret`, `message_privacy_worker_secret` — are **absent**, and every prod-URL-bearing job short-circuits before any HTTP call. The prod URL that migration 046 writes into `notification_config.push.dispatch_url` is inert data until a human both (a) repoints it and (b) creates the vault secrets — which is Step D, done deliberately, staging-only, after verification.

The **vault secrets are therefore the last thing created in this whole runbook** (end of Step E), only after the config is repointed to staging, the cron jobs are deactivated/re-pointed, and the isolation check below has passed.

### C1 — Pre-apply lockdown (psql to staging, before `db push`)

```sql
-- Belt: shrink pg_net's request TTL so anything that somehow gets enqueued
-- during the apply expires before the worker can deliver it. (Default 6h.)
ALTER DATABASE postgres SET pg_net.ttl = '5 seconds';
```

### C2 — Apply

```bash
# repo root, branch codex/rollout-reliability-backend (has 099/100/101)
export SUPABASE_DB_PASSWORD=...        # founder's shell only; never in chat
supabase link --project-ref <staging-ref>
supabase db push                       # 001 → 101, in order
```

### C3 — Immediate neutralize (psql, the moment `db push` returns)

```sql
UPDATE cron.job SET active = false;                         -- freeze every scheduled job
UPDATE notification_config SET value = 'null' WHERE key = 'push.dispatch_url';
DELETE FROM net.http_request_queue;                         -- purge anything queued
```

### C4 — Prove isolation (psql — this is a STOP gate)

First confirm the pg_net table names on this version (`\dt net.*`; on pg_net 0.20 the response table is `net._http_response` and the queue is `net.http_request_queue` — adjust the queries if they differ).

```sql
-- Any actually-delivered request to the production ref? Expect 0.
SELECT count(*) FROM net._http_response WHERE url ILIKE '%yoozrnosmqtaiksgcixc%';
-- Anything still queued toward it? Expect 0 (C3 purged it).
SELECT count(*) FROM net.http_request_queue WHERE url ILIKE '%yoozrnosmqtaiksgcixc%';
-- Any cron run that touched the prod ref? Inspect; expect only 'succeeded' no-ops
-- (empty-queue / missing-secret returns) or nothing at all.
SELECT jobid, jobname, status, return_message, start_time
FROM cron.job_run_details
WHERE command ILIKE '%yoozrnosmqtaiksgcixc%' OR return_message ILIKE '%yoozrnosmqtaiksgcixc%'
ORDER BY start_time DESC;
```

**If `net._http_response` shows any row whose `url` contains the production ref, STOP.** Isolation failed; do not proceed to seeding, function deploy, or vault-secret creation. Investigate (which job, what secret was present) and report before any further step.

### C5 — Restore staging-safe operation

```sql
ALTER DATABASE postgres RESET pg_net.ttl;
-- Re-activate ONLY jobs that are self-contained or already re-pointed at staging:
UPDATE cron.job SET active = true
 WHERE jobname IN (
   'process-event-reminders',
   'weglue-cron-job-run-details-retention',   -- migration 101, no external URL
   'weglue-push-queue-retention',             -- migration 101, no external URL
   'weglue-pending-avatars-orphan-sweep'      -- migration 101, no external URL
 );
-- 'dispatch-push' stays inactive until Step D repoints push.dispatch_url to
-- staging AND Step E creates the staging push_dispatch_secret vault entry.
-- The account-deletion / message-privacy worker jobs stay inactive for load
-- runs that do not measure them; re-point + re-activate only if a run needs them.
```

### Validation notes

- `supabase link` rewrites `supabase/config.toml` `project_id`. **Do not commit that change** — local-only (`project_weglue_local_stack_hazards`).
- A `db push` `pgdelta` / cert error printed **after** a successful apply is cosmetic (`project_web_profile_and_062_released`). Confirm success:
  ```sql
  SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;
  ```
  Top row = `101`.
- A migration failing mid-chain is a **real finding** — capture the exact error + failing file. (Prod's ledger ends at **098**; `db push` runs 001→098 too, re-validating the whole history against a real GoTrue schema.)
- Migrations `098` and `099` write a hardcoded **prod storage URL** into `profiles.avatar_url` for photo/camera avatars (`https://yoozrnosmqtaiksgcixc.supabase.co/storage/v1/object/public/pending-avatars/<token>.jpg`). This is **passive data, not a call** — nothing in staging fetches it. It is harmless for the load run **provided synthetic signups use a preset avatar or omit `avatar_choice_type`** so the branch is never hit. A follow-up migration to make the path relative / GUC-driven is tracked separately; do **not** edit 098/099 inline.

## Step D — Fix the environment-specific bits the migrations hardcode

After `db push`, before any load run, against the staging DB:

This runs **after** Step C's isolation gate has passed and **before** any vault secret exists.

1. **Push-dispatch URL** — repoint `notification_config` from the prod URL that migration 046 seeded:
   ```sql
   -- if this run measures push delivery, point at the staging function (Step E):
   UPDATE notification_config
      SET value = '"https://<staging-ref>.supabase.co/functions/v1/send-push"'
    WHERE key = 'push.dispatch_url';
   -- otherwise leave it 'null' (set in C3) and skip re-activating dispatch-push.
   ```

2. **Worker cron jobs** — for a load run that does not measure the account-deletion or message-privacy workers, leave them inactive (C3 already deactivated them):
   ```sql
   -- optional, to remove them entirely rather than leave inactive:
   SELECT cron.unschedule('weglue-account-deletion-worker');
   SELECT cron.unschedule('weglue-day10f-deleted-message-reconciler-daily');
   ```
   To actually exercise them, re-run their scheduling functions with the **staging** function URLs (and only then create their vault secrets in Step E). Never leave them scheduled with the prod URL and active.

3. **Retention crons** (`weglue-cron-job-run-details-retention`, `weglue-push-queue-retention`, `weglue-pending-avatars-orphan-sweep`) from migration 101 are self-contained (no external URL) — re-activated in C5, safe.

4. **The pending-avatars / storage prod-URL data** (098/099) — nothing further to do here; it is inert and the load run avoids the code path (Step C validation notes).

## Step E — Edge functions + staging secrets

Deploy the 6 functions to staging:

```bash
supabase functions deploy delete-account --project-ref <staging-ref>
supabase functions deploy send-report-email --project-ref <staging-ref>
supabase functions deploy send-push --project-ref <staging-ref>
supabase functions deploy process-account-deletion-jobs --project-ref <staging-ref>
supabase functions deploy delete-message --project-ref <staging-ref>
supabase functions deploy reconcile-deleted-messages --project-ref <staging-ref>
```

Set the **user-managed** secrets via `supabase secrets set` **from the founder's machine** (Supabase auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`). None of these values appear in chat:

| Secret | Staging value |
| --- | --- |
| `SUPPORT_EMAIL` | reuse `info@weglue.app` or a staging inbox |
| `RESEND_API_KEY` | a **staging** Resend key (see Step F) |
| `RESEND_TRANSACTIONAL_FROM` | a verified staging sender |
| `PUSH_DISPATCH_SECRET` | new random; must equal the `push_dispatch_secret` vault entry below |
| `ACCOUNT_DELETION_WORKER_SECRET` | new random; only if that worker is being exercised |
| `MESSAGE_PRIVACY_WORKER_SECRET` | new random; only if that worker is being exercised |

Setting any function secret redeploys **all** functions (+1 version each) — expected (`project_day10f_credential_incident`).

### Vault secrets — the LAST step, and only for jobs this run exercises

Create these **only after** Step D repointed the config to staging and Step C4's isolation check passed. Creating a vault secret is what "arms" the corresponding cron job — so create only the ones a run needs, and confirm `notification_config.push.dispatch_url` points at **staging** (not `'null'`, not prod) first.

```sql
-- Only if measuring push delivery:
SELECT vault.create_secret('<staging-push-dispatch-secret>', 'push_dispatch_secret');
-- Only if exercising the workers (with their crons re-pointed to staging URLs):
-- SELECT vault.create_secret('<staging-account-deletion-secret>', 'account_deletion_worker_secret');
-- SELECT vault.create_secret('<staging-message-privacy-secret>',  'message_privacy_worker_secret');
```

Then re-activate the now-safe job(s):
```sql
UPDATE cron.job SET active = true WHERE jobname = 'dispatch-push';  -- only after the above
```

## Step F — Auth configuration (dashboard → Authentication)

Match prod except where noted. **Keep email confirmations ON** — the burst test must exercise real verification.

- **URL Configuration → Redirect URLs** — add the staging equivalents of prod's allow-list:
  `http://localhost:3000`, `http://localhost:3000/auth/confirm`, `http://localhost:3000/auth/reset-password`,
  and if a staging web deploy exists, its `/auth/confirm` and `/auth/reset-password`,
  plus the mobile deep links `weglue://auth/confirmed`, `weglue://auth/confirm-email`, `weglue://onboarding/profile-pic`.
  Site URL: the staging web URL, or `http://localhost:3000` if none.
- **Rate Limits** — start at prod parity (`Emails sent per hour = 1000`, `Verify/OTP = 30`, `Token refresh = 150`, `Sign in/Sign up = 30`) for the **realistic** model, then raise `Emails sent per hour` toward **5,000** for the **stress** model and record whether Supabase accepts the value on Free + custom SMTP (see `auth-email-capacity.md` → Staging test matrix; the two models are validated separately). This is a **staging** change only — do not touch production; if 5,000/hr proves out, the exact production field + target value goes to the founder for later approval.
- **Providers** — email/password only. No Google/Microsoft/Apple/phone/anonymous/magic-link.
- **`security_refresh_token_reuse_interval` — leave at the default 10. Do not change.**
- **`mailer_autoconfirm` = false. Do not enable.**
- **Secure Email Change — leave DISABLED on staging** (`mailer_secure_email_change_enabled = false` / `double_confirm_changes = false`), mirroring production, so the email-change leg of the capacity test measures the real single-mail behavior. Enabling double-confirm email change is a **separate security decision** tracked for before final release — out of scope here.
- **SMTP — decide:**
  - *Realistic (needed for the 500-email deliverability test):* configure a **staging Resend domain** (a subdomain like `staging.weglue.app` with its own SPF/DKIM/DMARC) and its SMTP key. Signup now uses **personal emails** (Gmail/Outlook.com/iCloud — migration 093 blocks `.edu`), so the deliverability question is "does a low-volume domain sending 500 messages in an hour land in Gmail's inbox" — do a **real test send to a Gmail address** and check placement before the burst.
  - *Functional only:* leave the built-in mailer (2/hr). Signup/verify/reset flows work; the burst-volume email test is not meaningful.
  - Do **not** point staging at the prod Resend SMTP key.

## Step G — Seed baseline data

Signup maps email domain → university via `resolve_signup_university_id` (migration 042). The load harness seeds synthetic universities, but the burst's synthetic signups need a `universities` row whose domain matches `LOADTEST_EMAIL_DOMAIN`:

```sql
insert into universities (name, ...) values ('Load Test University', ...);
-- match whatever resolve_signup_university_id keys on (domain / name);
-- inspect 042 + the current universities schema on staging first.
```

The harness's `seed` command builds the club/member/event/post fixtures for the fan-out and concurrent-active scenarios.

## Step H — Realtime

- The Realtime publication is set by the migration chain — verify:
  ```sql
  select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 2;
  ```
- Free-plan Realtime tenant limits (`max_concurrent_users: 200`, `max_joins_per_second: 100`, `max_events_per_second: 100`) are **the same on staging as prod**, so BE-3's measurements transfer directly. Confirm via `GET /v1/projects/<staging-ref>/config/realtime` once created.

## Step I — Wire the load harness

The `load-tests/` package (branch `codex/rollout-reliability-loadtests`) is not yet in the pnpm workspace:

```bash
# add "load-tests" to pnpm-workspace.yaml packages, then:
pnpm install
pnpm --dir load-tests build      # tsc, currently unverified
```

Config (env or `LOADTEST_CONFIG_FILE` JSON):

Written to a **git-ignored** local file on the founder's machine — never committed, never pasted in chat:

```
LOADTEST_SUPABASE_URL=https://<staging-ref>.supabase.co
LOADTEST_SUPABASE_ANON_KEY=<staging anon>
LOADTEST_SUPABASE_SERVICE_KEY=<staging service_role>
LOADTEST_STAGING_REF=<staging-ref>                 # the one non-secret value; must equal the ref in the URL
LOADTEST_CONFIRM_WRITES=i-understand-this-writes-to-staging
LOADTEST_UNIVERSITY_ID=<the seeded universities.id>
LOADTEST_EMAIL_DOMAIN=<domain matching that university>
LOADTEST_DATABASE_URL=<staging db url>             # for the observability collector
```

The harness **refuses to run** against the prod ref and refuses any write scenario without `LOADTEST_STAGING_REF` matching the URL **and** the exact `LOADTEST_CONFIRM_WRITES` token.

## Step J — Validation sequence

Run in this order; capture output at each step.

1. **Migration-chain check** (Step C) — ledger ends at 101, no failures.
2. **099 / 100 / 101 behavioural spot-checks** on staging:
   - 099: a signup does **not** run `generate_club_recommendation_batch` in-txn; `get_my_club_recommendations` lazily generates once verified+onboarded; `maybe_enqueue_student_joined` only fires for verified + onboarding-complete + same-university.
   - 100: `posts` / `events` / `post_comments` have `client_tag` + the partial unique indexes; a duplicate `(owner, client_tag)` insert raises `23505`.
   - 101: the tightened `posts` bucket policy; the 3 retention crons scheduled; `cleanup_orphaned_pending_avatars()` runs without the `protect_delete` error.
3. **BE-6 seed** — 100 / 300 / 500-member synthetic universities.
4. **Signup burst — realistic model** (`auth-email-capacity.md` model a): ~500 verify + ~100 resend + ~50 reset ≈ 650 email-triggering requests in an hour, against `Emails sent per hour = 1000`. `--arrival all` / `ramp` / `nat`. Measure signup p50/p95/p99, error classes (`over_email_send_rate_limit` vs 5xx vs timeout), verification emails accepted vs rejected, GoTrue pool saturation.
5. **Signup burst — stress / headroom model** (model b): 500 verify + 500 resend #1 + 500 resend #2 + 500 reset + 500 email-change ≈ 2,500 email-triggering requests, against a raised `Emails sent per hour` (target 5,000; record what Supabase accepts). Same metrics. **PASS requires BOTH models green** — do not mark email capacity passed on model a alone.
6. **Email failure-mode tests** (outbox stays test-first — this decides whether direct SMTP is enough): (i) burst throughput at model b; (ii) provider **rejection** (Resend 4xx / quota / bad recipient); (iii) provider **timeout / transient 5xx**; (iv) **auth state after a failed delivery** — is the user recoverable (unconfirmed, can resend) or broken? If any of (ii)–(iv) can corrupt a required Auth flow, that triggers "return with the smallest email-delivery isolation architecture" — do not build it now.
7. **Email reliability** — resend / reset / change-email at low rate; confirm the 60s per-identity cooldown behaviour and single-mail email change (Secure Email Change disabled).
8. **Concurrent-active** — 50 users, sustained window, realtime + feed/search/RSVP/like/comment/chat duty cycle. Measure query percentiles, realtime join/event rates, DB connections, error spikes.
9. **Photo-post fan-out** — 100 / 300 / 500 members × 1 / 10 / 50 concurrent. Pass criterion: **50 concurrent posts in a 500-member university complete reliably** — no DB instability, no connection exhaustion, no unintended duplicates, fan-out never fails the insert. Records notification-row amplification + push_queue growth/drain.
10. **Idempotency probes** — double-fire post / comment / event / RSVP / club-join with and without `client_tag`; confirm 100 collapses the write.
11. **BE-3 realtime measurement** — against the numbers from steps 8–9.
12. **BE-7 session verification** — drive the refresh-token rotation path under load; attempt to reproduce the unexpected logout with the AppState fix in place, then confirm it's gone.
13. **Feed count-query check** (BE-8 spec) — measure feed-read row/payload volume at the 50-active target; this is the data that decides whether the aggregate-RPC spec gets implemented.
14. **Report** — `pnpm --dir load-tests report` renders each run to markdown with the percentile tables and pass/fail.

## Step K — Teardown / cost control

- After a test campaign: **pause the staging project** from the dashboard.
- The synthetic-university `teardown` command removes exactly what `seed` created (matched by namespace tag).
- Staging secrets stayed out of chat throughout; if that was ever violated, rotate them.
- Do **not** apply 099/100/101 to **production** off the back of a green staging run without explicit founder approval — staging validation is a precondition, not the authorization.

## Do not change (staging or production)

- `security_refresh_token_reuse_interval` — stays 10.
- `mailer_autoconfirm` — stays false.
- `mailer_secure_email_change_enabled` / `double_confirm_changes` — stay false on staging to mirror prod for this test. **Enabling secure (double-confirm) email change is a separate security decision for before final release.**
- Any historical migration file (046 / 061 / 071 / 091 / 098 / 099 …). All environment overrides are post-apply `UPDATE` / `ALTER` statements, never edits.
- Production anything. Every step here is staging-only. A raised staging email rate limit that proves out is reported to the founder as a proposed production change, not applied.

## Open decisions for the founder

1. **Staging email:** dedicated Resend staging domain (needed for the real burst-deliverability test) vs built-in 2/hr mailer (functional only) vs mail catcher.
2. **Running `supabase db push`:** the founder exports `SUPABASE_DB_PASSWORD` in the shell this session's tools inherit (session reads it from env, never chat), **or** the founder runs `link` + `push` + the Step C psql blocks themselves and pastes back only the non-secret output (ledger, cron list, isolation-check counts).
3. **Auto-pause:** accept the 7-day pause and un-pause per campaign, or keep it warm with a trivial scheduled ping.
4. **Resend account plan** (`auth-email-capacity.md`): confirm Free vs Pro; a Resend Pro upgrade ($20/mo, Resend — not Supabase) is the likely unblock for the real burst.
5. **Stress-model email limit:** confirm staging may raise `Emails sent per hour` toward 5,000 for model b (staging only; no production change without separate approval).
