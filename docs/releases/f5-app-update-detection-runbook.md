# F5 — automatic App Store / Play Store update detection — production runbook

Prepared 2026-09-04. **Nothing in this document has been executed.** No Vault
secret, no Edge Function deploy, no migration apply, no Vercel env change, no
production mutation. Branch `task/media-crop-reload-officer-tags-update`
stays undeployed until the founder runs these steps.

## What this ships

- Migrations **117, 118, 119** (`app_releases` gains `source`/`store_url`/
  `build_number`; `create_post`/`create_club_post` gain
  `p_image_dimensions`; `sync_store_app_release` becomes the 4-arg
  build-number-aware version).
- Edge Function **`sync-store-versions`** — polls the public iTunes lookup
  API (iOS) and the official Google Play Android Publisher API (Android)
  every 45 minutes, writes newly-detected public releases to `app_releases`,
  and fans out one `app_update` push per eligible device.
- Web: Admin Dashboard **App Releases → Check now**, which invokes the same
  function on demand.

Google's side is already done (per the founder): Android Publisher API
enabled, `weglue-play-version-checker` service account created, JSON key
issued, added to Play Console with read-only access. Everything below is the
Supabase/Vercel side.

## Two independent layers keep this from ever false-alarming

**The push gate is safe by construction, not just by this runbook's
ordering** (2026-09-04 correction). `sync_store_app_release()` (migration
119) only enqueues a push when it has confirmed BOTH: (a) the platform
already had a prior known public release on file, AND (b) this call
recorded a version/build that wasn't already on file. A platform's very
first detected release can never satisfy (a) — there is nothing yet to be
"newer than" — so a baseline/seed call can never push, regardless of
whether `app_releases` was pre-seeded first. Re-detecting an unchanged
version/build never satisfies (b). See
`supabase/scripts/test_119_sync_store_app_release_push_safety.sql` for the
committed regression test (first-ever baseline → no push; same version
again → no push; genuinely newer → one push per eligible user; repeated
detection of that newer version → no duplicate) — run against the real
`enqueue_push`/`user_wants_push`/`register_push_token`/`push_queue`
functions and tables in a throwaway `postgres:17` container on 2026-09-04:
13/13 assertions passed.

That said, **Step 6 below (seed the current versions) is still followed
before Step 7 (create the Vault secret, which arms the cron)** — belt and
suspenders. Two independent reasons a false push can't happen; neither one
is load-bearing on its own:
1. The RPC's own newer-than-previous gate (just described).
2. This runbook's ordering — migrations and the seed land before the cron
   can ever fire at all.

Follow the steps in order regardless; there's no cost to keeping both
protections active.

---

### Step 1 — Create the dedicated Supabase Secret API key

This key is the ONE thing that replaces the legacy service_role JWT as the
cron/Admin-Dashboard → Edge-Function transport credential (2026-09-04
security correction, commit `675b4062`). It is purpose-scoped to this one
function — not the project's general service key — so it can be rotated or
revoked independently without touching anything else. Creating it has no
effect on anything yet (nothing references it until Step 2).

- [ ] Supabase Dashboard → **Project Settings → API Keys** → create a new
  **Secret API key** (the `sb_secret_…` style key, not the legacy
  `service_role` key). Name it something identifiable, e.g.
  `store-version-sync`.
- [ ] Copy the value once. It is shown only at creation time. **Do not paste
  it into this chat, a commit, or any file in the repo.**

### Step 2 — Deploy the function and set its secrets

Safe to do before anything is wired to call it — the function will simply
401 every request until the migrations exist and something invokes it.

```bash
supabase link --project-ref yoozrnosmqtaiksgcixc   # if not already linked
supabase functions deploy sync-store-versions --project-ref yoozrnosmqtaiksgcixc
```

- [ ] Set the function's own copy of the Step 1 key, plus the Google service
  account JSON, **from the founder's machine** (values never appear in
  chat):
  ```bash
  supabase secrets set \
    STORE_SYNC_API_KEY='<the secret API key from Step 1>' \
    PLAY_ANDROID_PUBLISHER_KEY="$(cat weglue-play-version-checker.json)" \
    --project-ref yoozrnosmqtaiksgcixc
  ```
- [ ] Expect this to redeploy every function (+1 version each) — documented
  existing behavior (`project_day10f_credential_incident`), not a bug.
- [ ] `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` need no action — Supabase
  auto-injects them for the function's own `app_releases` writes.
- [ ] Confirm in Play Console that `weglue-play-version-checker` has at
  least **View app information (read-only)** on We Glue — per the founder,
  already granted.

### Step 3 — Set `STORE_SYNC_API_KEY` for the server-side web environment

This is what lets Admin Dashboard **Check now** call the function without a
secret ever reaching the browser (`apps/web/lib/admin/appReleasesActions.ts`
is a `"use server"` action that reads this from `process.env`).

- [ ] Vercel → the **web** project → **Settings → Environment Variables** →
  add `STORE_SYNC_API_KEY` = the SAME key from Step 1, scoped to
  **Production** (add Preview too only if you want Check now to work on
  preview deployments). **Do not** prefix it `NEXT_PUBLIC_` — that would
  ship it to every browser.
- [ ] Redeploy the web app (or trigger the next deploy normally) so the new
  env var is picked up.

### Step 4 — Apply migrations 117, 118, 119

```bash
supabase link --project-ref yoozrnosmqtaiksgcixc   # if not already linked
supabase db push --linked
```

This creates the `sync-store-versions` cron job (schedule `*/45 * * * *`),
but it stays fully inert — zero HTTP calls — until Step 7 creates the Vault
secret it checks for.

- [ ] Confirm the migration ledger now ends at 119:
  ```sql
  SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;
  ```
- [ ] Confirm 117's own fail-closed self-check passed (it raises inside the
  migration transaction if it didn't, so a clean `db push` already proves
  this — worth re-confirming directly):
  ```sql
  SELECT grantee, privilege_type FROM information_schema.role_table_grants
   WHERE table_name = 'app_releases' AND grantee IN ('anon','authenticated');
  -- expect exactly one row: authenticated | SELECT
  ```
- [ ] A cosmetic pgdelta certificate warning after an otherwise-successful
  `db push` is expected and not a failure (`project_web_profile_and_062_released`).

### Step 5 — Verify pg_cron + pg_net, and that the job is inert for now

Both extensions are already in use by other production jobs (retention
sweeps, push dispatch), so this should already be true — confirm rather than
assume:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net');
```

- [ ] Both rows present. If either is missing, migration 117's own
  `CREATE EXTENSION IF NOT EXISTS` already attempted it during Step 4 — a
  missing extension there logs `WARNING: store version sync extensions: …`
  instead of failing the migration; if you see that warning, enable the
  extension manually (Dashboard → Database → Extensions) and re-run just
  the cron-scheduling `DO $$ … $$` block from the tail of migration 117, or
  re-apply 117.
- [ ] Confirm the job exists and is scheduled:
  ```sql
  SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sync-store-versions';
  ```
  Expect one row, `schedule = '*/45 * * * *'`, `active = true`. "Active" here
  only means the job *runs* on schedule — each run still no-ops until Step 7.
- [ ] Confirm it really is a no-op right now (no Vault secret yet):
  ```sql
  SELECT name FROM vault.secrets WHERE name = 'store_version_sync_api_key';
  -- expect 0 rows
  ```

### Step 6 — Seed the current public versions in `app_releases`

**Do this before Step 7 creates the Vault secret**, as the second, redundant
layer described above. `sync_store_app_release()`'s own gate already means
the first live detection would record today's already-public version
WITHOUT pushing (it has no prior known public release to be newer than) —
but seeding first is still the right call: it makes `app_releases`
correctly reflect history from day one, and it means the very first live
detection is a routine "no change" run instead of "an app_releases row for
this platform appears out of nowhere."

`publish_app_release()` — the SEPARATE, deliberate admin-publish path, not
touched by this correction — still fans out its push unconditionally on
every call, by design (a human clicking "publish" always means to notify).
So seed with a **plain INSERT**, never through `publish_app_release()`, run
directly in the Studio SQL editor (or `psql`) as a privileged session:

- [ ] Look up the exact version currently live on each public store:
  - App Store Connect → the app's current **public** version (marketing
    version, e.g. `1.0.5`) and its exact listing URL.
  - Play Console → Production track → the current **release name** (may not
    exist) and its **version code** (versionCode, an integer — always
    present).
- [ ] Confirm there is no existing row for either (first deploy of this
  feature — expected empty):
  ```sql
  SELECT platform, version, build_number FROM public.app_releases
   WHERE (platform = 'ios' AND version = '<current live App Store version>')
      OR (platform = 'android' AND build_number = <current live versionCode>);
  ```
- [ ] If empty, insert both directly (adjust the iOS `store_url` to the
  exact App Store Connect listing URL; skip a row only if one already
  exists above):
  ```sql
  INSERT INTO public.app_releases (platform, version, build_number, is_public, source, store_url, released_at, updated_at)
  VALUES ('ios', '<current live App Store version>', NULL, true, 'manual',
          '<https://apps.apple.com/... exact listing URL>', now(), now());

  INSERT INTO public.app_releases (platform, version, build_number, is_public, source, store_url, released_at, updated_at)
  VALUES ('android', '<current live release name, or NULL>', <current live versionCode>, true, 'manual',
          'https://play.google.com/store/apps/details?id=com.weglue.app', now(), now());
  ```
- [ ] Verify no push was queued by this seed (a raw INSERT never calls
  `enqueue_push`, so this should already be guaranteed — confirm anyway):
  ```sql
  SELECT count(*) FROM public.push_queue WHERE category = 'account' AND created_at > now() - interval '2 minutes';
  ```
- [ ] Verify the seed:
  ```sql
  SELECT platform, version, build_number, is_public, source
    FROM public.app_releases ORDER BY platform, released_at DESC;
  ```

### Step 7 — Store the key in Vault as `store_version_sync_api_key` — this arms the cron

Only do this once Steps 4-6 are confirmed done. Run from the founder's
machine (Studio SQL editor, or `psql` against the linked project) — the
value never appears in chat:

```sql
SELECT vault.create_secret('<the secret API key from Step 1>', 'store_version_sync_api_key');
```

- [ ] Confirm it exists (reads metadata only, never the decrypted value):
  ```sql
  SELECT name, created_at FROM vault.secrets WHERE name = 'store_version_sync_api_key';
  ```
- [ ] From this point on, the next scheduled tick (within 45 minutes) — or
  the manual trigger in Step 8 right now — will make a real, authenticated
  call.

### Step 8 — Verify Apple detection end to end

Don't wait 45 minutes — trigger it directly. Either path works; the second
is exactly what Admin Dashboard "Check now" does under the hood.

- [ ] **Admin Dashboard** → App Releases → **Check now**, or:
- [ ] From the founder's machine (never paste the key into chat):
  ```bash
  curl -s -X POST 'https://yoozrnosmqtaiksgcixc.supabase.co/functions/v1/sync-store-versions' \
    -H "apikey: $STORE_SYNC_API_KEY" -H 'Content-Type: application/json' -d '{}' | jq .
  ```
- [ ] In the response's `checks` array, the `ios` entry should read
  `"ok": true`, `"detectedVersion"` equal to the version seeded in Step 6,
  `"changed": false` (because Step 6 already recorded it — `changed: true`
  here would mean Step 6 was skipped or the live version has since moved;
  re-check Step 6 if it's a surprise).
- [ ] Cross-check the operational log table:
  ```sql
  SELECT platform, checked_at, detected_version, ok, error
    FROM public.app_release_store_checks
   WHERE platform = 'ios' ORDER BY checked_at DESC LIMIT 3;
  ```
- [ ] Admin Dashboard's App Releases page shows **Healthy** for iOS.

### Step 9 — Verify Google detection end to end

Same trigger as Step 8 (one call checks both platforms); read the `android`
entry:

- [ ] `"ok": true` (NOT `"error": "android_play_api_not_configured"` — that
  specific value means `PLAY_ANDROID_PUBLISHER_KEY` is missing/invalid, not
  a real store failure).
- [ ] `"detectedVersion"` — may legitimately be `null` if Play has no dotted
  release name for the current production release; the versionCode is what
  actually drives comparisons, so also check:
  ```sql
  SELECT platform, version, build_number, released_at
    FROM public.app_releases WHERE platform = 'android'
   ORDER BY released_at DESC LIMIT 1;
  ```
  `build_number` should equal the versionCode looked up in Step 6.
- [ ] `"changed": false` for the same reason as Step 8 (Step 6 already
  recorded the current build).
- [ ] Admin Dashboard's App Releases page shows **Healthy** for Android.

### Step 10 — Confirm no secret is ever exposed client-side

- [ ] Browser DevTools → Network tab → click **Check now** on the Admin
  Dashboard → inspect the request the *browser* makes. It should hit the
  Next.js server action, not `supabase.co/functions/...` directly — the
  `apikey`/`STORE_SYNC_API_KEY` value must never appear in any request the
  browser itself issues, any client bundle, or `NEXT_PUBLIC_*`.
- [ ] After a production build, `grep -r STORE_SYNC_API_KEY apps/web/.next`
  should not match inside any client chunk — only server-side output.
- [ ] Confirm mobile has nothing referencing `STORE_SYNC_API_KEY`,
  `PLAY_ANDROID_PUBLISHER_KEY`, or `store_version_sync_api_key` (it doesn't
  — the mobile app only ever reads the public `app_releases` table via RLS).

### Step 11 — What happens next (no further action needed)

- The cron job fires every 45 minutes from here on. A genuinely newer public
  release on either store writes a new `app_releases` row and pushes
  `app_update` to every device with an active production push token on that
  platform, deduped so it fires exactly once per (platform, version or
  versionCode, user).
- The in-app badge, "New update!", the sidebar Update row, and the Update
  screen all pick it up on the next app foreground (`useAppUpdateStatus`,
  `staleTime` 5 min).
- Tapping the push, "New update!", or the sidebar Update row all land on the
  Update screen, whose **Update now** opens the correct store listing.

## Rollback

- **Disarm without reverting anything**: delete the Vault secret —
  `DELETE FROM vault.secrets WHERE name = 'store_version_sync_api_key';`
  — the cron's `WHERE EXISTS` guard makes every future run a silent no-op.
- **Fully stop the job**: `SELECT cron.unschedule('sync-store-versions');`
- **Function**: `supabase functions delete sync-store-versions --project-ref yoozrnosmqtaiksgcixc`
  (optional — an unscheduled/unauthenticated function sitting idle is not a
  live risk, since `verify_jwt = false` still requires the correct `apikey`).
- None of the above touches `app_releases` data already written, or removes
  migrations 117-119 (rolling those back is a separate, not-recommended,
  schema decision).

## Post-deploy Admin Dashboard parity check

No schema/RPC/RLS/storage shape changed by this runbook beyond what
migrations 117-119 already introduced (reviewed and validated separately —
see `project_media_reload_tags_update_task` memory, Round 3/4). This runbook
only provisions secrets and runs the migrations/deploy that were already
built and tested. `Admin Dashboard Impact: VERIFIED — NO UPDATE REQUIRED`.
