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
2. Supabase CLI installed and logged in (`supabase login`) on the machine that will run migrations — or hand the connection details to this session and it will run them.
3. A decision on **staging email** (see Step F): a separate Resend domain/key for staging, a mail catcher, or the built-in 2/hr mailer (functional tests only — the 500-email deliverability test needs realistic SMTP).

---

## Step A — Create the project (founder, dashboard)

Dashboard → **New project** in the **We Glue App** org:

- Name: `We Glue Staging`
- Region: **us-west-2** (same as prod)
- Database password: generate a strong one and **save it** (needed for `db push` and psql).
- Plan: **Free**.

Wait for provisioning (~2 min).

## Step B — Capture connection details (founder → this session)

From the new project's **Settings → API** and **Settings → Database**, record:

- Project ref (the `xxxxxxxxxxxxxxxxxxxx` in the URL) → this is `LOADTEST_STAGING_REF`
- Project URL (`https://<ref>.supabase.co`)
- `anon` public key
- `service_role` secret key
- Database connection string / password (for `supabase db push` and psql)

Hand these to this session (or keep them and run the commands yourself). The `service_role` key and DB password are secrets — do not commit them anywhere.

## Step C — Apply the migration chain

This is the clean-ledger validation.

```bash
# from the repo root, on branch codex/rollout-reliability-backend (has 099/100/101)
supabase link --project-ref <staging-ref>          # prompts for the DB password
supabase db push                                   # applies 001 → 101 in order
```

Notes / gotchas:

- `supabase link` rewrites `supabase/config.toml` `project_id`. **Do not commit that change** — it is local-only (`project_weglue_local_stack_hazards`).
- A `db push` `pgdelta` / cert error printed **after** a successful apply is cosmetic (`project_web_profile_and_062_released`). Confirm success by checking the ledger:
  ```bash
  psql "<staging-db-url>" -c "select version, name from supabase_migrations.schema_migrations order by version desc limit 5;"
  ```
  Expect the top row to be `101`.
- If any migration fails mid-chain, that is a **real finding** — capture the exact error and the failing file; it means the chain has an ordering or environment assumption that prod's incremental history hid. (Prod's ledger ends at **098**; `db push` will run 001→098 too, so this also re-validates the whole history.)
- Migrations `098` and `099` write a **hardcoded prod storage URL** into `profiles.avatar_url` for photo/camera avatars:
  `https://yoozrnosmqtaiksgcixc.supabase.co/storage/v1/object/public/pending-avatars/<token>.jpg`.
  On staging this is wrong (the object lives in staging storage). It is **harmless for the load tests** as long as synthetic signups use a preset avatar or omit `avatar_choice_type`. Flag for a follow-up migration to make this path relative / GUC-driven; do not fix it inline for the staging run.

## Step D — Fix the environment-specific bits the migrations hardcode

After `db push`, before any load run, against the staging DB:

1. **Push-dispatch URL.** Migration 046 seeds `notification_config.push.dispatch_url` = the **prod** send-push URL. Repoint it (or null it):
   ```sql
   -- point at staging's function once deployed (Step E):
   update notification_config
     set value = '"https://<staging-ref>.supabase.co/functions/v1/send-push"'
    where key = 'push.dispatch_url';
   -- OR, if not measuring push delivery this run, disable it:
   -- update notification_config set value = 'null' where key = 'push.dispatch_url';
   ```

2. **Vault secrets** (migration 071 reads these from `vault.decrypted_secrets` at cron run time; without them the worker crons fail closed):
   ```sql
   select vault.create_secret('<staging-account-deletion-secret>', 'account_deletion_worker_secret');
   select vault.create_secret('<staging-message-privacy-secret>',  'message_privacy_worker_secret');
   ```

3. **Worker cron URLs.** The account-deletion / message-privacy worker crons are scheduled with a `p_worker_url` argument. Re-run their scheduling function with the staging function URLs, **or** — simplest for a load run that isn't measuring those workers — unschedule them:
   ```sql
   select cron.unschedule('weglue-account-deletion-worker');
   select cron.unschedule('weglue-day10f-deleted-message-reconciler-daily');
   -- keep dispatch-push + process-event-reminders if the run measures push_queue / reminders
   ```

4. **101's retention crons** (`weglue-cron-job-run-details-retention`, `weglue-push-queue-retention`, `weglue-pending-avatars-orphan-sweep`) are self-contained (no external URL) and safe to leave scheduled.

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

Set the **user-managed** secrets (Supabase auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`):

| Secret | Staging value |
| --- | --- |
| `SUPPORT_EMAIL` | reuse `info@weglue.app` or a staging inbox |
| `RESEND_API_KEY` | a **staging** Resend key (or a throwaway; see Step F) |
| `RESEND_TRANSACTIONAL_FROM` | a verified staging sender, or reuse prod's if the same Resend account |
| `PUSH_DISPATCH_SECRET` | new random value; must match what `invoke_push_dispatch` sends |
| `ACCOUNT_DELETION_WORKER_SECRET` | new random; must match the vault secret in Step D.2 |
| `MESSAGE_PRIVACY_WORKER_SECRET` | new random; must match the vault secret in Step D.2 |

Setting any function secret redeploys **all** functions (+1 version each) — expected (`project_day10f_credential_incident`).

## Step F — Auth configuration (dashboard → Authentication)

Match prod except where noted. **Keep email confirmations ON** — the burst test must exercise real verification.

- **URL Configuration → Redirect URLs** — add the staging equivalents of prod's allow-list:
  `http://localhost:3000`, `http://localhost:3000/auth/confirm`, `http://localhost:3000/auth/reset-password`,
  and if a staging web deploy exists, its `/auth/confirm` and `/auth/reset-password`,
  plus the mobile deep links `weglue://auth/confirmed`, `weglue://auth/confirm-email`, `weglue://onboarding/profile-pic`.
  Site URL: the staging web URL, or `http://localhost:3000` if none.
- **Rate Limits** — set `Emails sent per hour = 1000`, keep `Verify/OTP = 30`, `Token refresh = 150`, `Sign in/Sign up = 30` (match prod).
- **Providers** — email/password only. No Google/Microsoft/Apple/phone/anonymous/magic-link.
- **`security_refresh_token_reuse_interval` — leave at the default 10. Do not change.**
- **`mailer_autoconfirm` = false. Do not enable.**
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

```
LOADTEST_SUPABASE_URL=https://<staging-ref>.supabase.co
LOADTEST_SUPABASE_ANON_KEY=<staging anon>
LOADTEST_SUPABASE_SERVICE_KEY=<staging service_role>
LOADTEST_STAGING_REF=<staging-ref>                 # must equal the ref in the URL
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
4. **Signup burst** — 500 accounts, `--arrival all` / `ramp` / `nat` variants. Measure signup p50/p95/p99, error classes (`over_email_send_rate_limit` vs 5xx vs timeout), verification emails accepted vs rejected, GoTrue pool saturation.
5. **Email reliability** — resend / reset / change-email at low rate; confirm the 60s per-identity cooldown behaviour.
6. **Concurrent-active** — 50 users, sustained window, realtime + feed/search/RSVP/like/comment/chat duty cycle. Measure query percentiles, realtime join/event rates, DB connections, error spikes.
7. **Photo-post fan-out** — 100 / 300 / 500 members × 1 / 10 / 50 concurrent. Pass criterion: **50 concurrent posts in a 500-member university complete reliably** — no DB instability, no connection exhaustion, no unintended duplicates, fan-out never fails the insert. Records notification-row amplification + push_queue growth/drain.
8. **Idempotency probes** — double-fire post / comment / event / RSVP / club-join with and without `client_tag`; confirm 100 collapses the write.
9. **BE-3 realtime measurement** — against the numbers from steps 6–7.
10. **BE-7 session verification** — drive the refresh-token rotation path under load; attempt to reproduce the unexpected logout with the AppState fix in place, then confirm it's gone.
11. **Report** — `pnpm --dir load-tests report` renders each run to markdown with the percentile tables and pass/fail.

## Step K — Teardown / cost control

- After a test campaign: **pause the staging project** from the dashboard.
- The synthetic-university `teardown` command removes exactly what `seed` created (matched by namespace tag).
- Rotate any staging worker secrets if they were shared in chat during setup.
- Do **not** apply 099/100/101 to **production** off the back of a green staging run without explicit founder approval — staging validation is a precondition, not the authorization.

## Open decisions for the founder

1. **Staging email:** dedicated Resend staging domain (realistic burst test) vs built-in mailer (functional only) vs mail catcher.
2. **Who runs `supabase db push`:** hand the staging DB URL + password to this session, or run it yourself and share the ledger output.
3. **Auto-pause:** accept the 7-day pause and un-pause per campaign, or keep it warm with a trivial scheduled ping.
4. **Resend account plan** (from `auth-email-capacity.md`): confirm Free vs Pro; a Resend Pro upgrade ($20/mo, Resend not Supabase) is the likely unblock for the real 500-email burst.
