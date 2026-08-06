# PR #29 release runbook — four-way sync

Prepared 2026-08-06. **Nothing in this document has been executed.** No merge, no
remote migration, no Vercel deploy, no production mutation.

Founder decisions this runbook is built on:

1. **Hold both PRs** until PR #30 is reviewed.
2. **You run `supabase db push`** — the credential stays with you.
3. **Migrations first, then merge**, letting Vercel's GitHub integration deploy.

---

## The one rule that makes the order non-negotiable

Production is at migration **068**. Two things break if the order is wrong:

**A. Web before database.** PR #29's web code calls three RPCs that do not exist
in production yet — `club_shared_identities`, `conversation_shared_identities`,
`conversation_restricted_senders`. If Vercel deploys before the migrations are
applied, club member lists, message threads and attachment cards throw for real
students. So: **database first, web second.**

**B. One PR's migrations applied alone.** PR #29 owns 069, 070, 072, 073, 074,
075; PR #30 owns 071. Supabase records applied migrations by version and refuses
to insert a version below the highest already applied. Apply either PR alone and
the other's versions become out-of-order inserts that `supabase db push` rejects
without `--include-all`. So: **both merged before the first apply.**

Verify mechanically at any time — read-only, touches no database:

```bash
python3 supabase/scripts/check_migration_order.py
```

---

## Step 0 — Preconditions

- [ ] PR #30 reviewed and you are willing to merge it.
- [ ] PR #29 reviewed (head `970bc395`).
- [ ] You know whether Vercel auto-deploys on push to `main`. If it does, do not
      merge until Step 2 is green.
- [ ] Nobody else is mid-apply on production.

**Concurrent work to be aware of:** the `weglue` folder is on branch
`fix/messages-tab-corrections` and holds an untracked
`supabase/migrations/076_message_tab_categories_and_suggestions.sql`. It does not
collide with 069–075, but 076 must be applied *after* this range, and that branch
should be rebased on the merged `main` before it is pushed.

---

## Step 1 — Merge both PRs into `main`

Merge order between them does not matter; both must land before Step 2.

```bash
gh pr merge 30 --squash          # or --merge, whichever this repo uses
gh pr merge 29 --merge
```

Then confirm `main` holds a gapless range:

```bash
git fetch origin
git ls-tree --name-only origin/main supabase/migrations/ | tail -8
# expect: 068, 069, 070, 071, 072, 073, 074, 075 — no gap, no duplicate
python3 supabase/scripts/check_migration_order.py
```

**If Vercel auto-deploys on merge**, production web is now ahead of the database
for the length of Step 2. Keep that window short, or turn off auto-deploy for
this release and promote manually in Step 3.

---

## Step 2 — Apply the migrations to Supabase production

Run from a checkout of the merged `main`, not from a feature branch.

```bash
git checkout main && git pull
supabase link --project-ref yoozrnosmqtaiksgcixc
supabase db push          # applies 069 → 075 in numeric order
```

`supabase db push` will list the pending files first. **Expect exactly seven, in
this order:**

```
069_web_permission_parity.sql
070_cross_platform_event_permission_parity.sql
071_cron_worker_secret_parity.sql
072_protected_identity_immutability.sql
073_blocking_override_and_club_identity.sql
074_shared_context_identity_and_attachment_blocking.sql
075_client_table_privileges.sql
```

If it lists anything else, or offers `--include-all`, **stop** — the order
assumption has been violated.

### Before you push: the 073 duplicate preflight

Already run read-only on 2026-08-06 against `yoozrnosmqtaiksgcixc`: **zero name
conflicts, zero handle conflicts, zero empty names, zero NULL-university clubs.**
073 applies with no rename and no invented number. Re-run it if any club has been
created or renamed since:

```bash
# read-only; creates, updates and deletes nothing
supabase/scripts/preflight_073_production_duplicates.sql
```

**Handle nuance, corrected:** applying 073 does **not** rewrite existing handles.
The derivation trigger is `BEFORE INSERT OR UPDATE`, so the six production clubs
keep their current handles until an officer next edits them. Four of them
currently carry a handle that does not match their own name (`Chess Club` →
`stock-market-club`, `Clay Club` → `nature-club`, `Film club` → `clay-club`,
`Tech Club` → `number-club`); those correct themselves on the next edit.

### Verify the database after the push

```sql
-- 1. Ledger reaches 075 with nothing missing.
SELECT string_agg(version, ',' ORDER BY version)
  FROM supabase_migrations.schema_migrations WHERE version >= '069';
-- expect: 069,070,071,072,073,074,075

-- 2. The three new RPCs the web build depends on exist and are student-callable.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS student_callable
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('club_shared_identities',
                     'conversation_shared_identities',
                     'conversation_restricted_senders');
-- expect: three rows, all true

-- 3. Attachment reads are block-aware (the FIX 1 security change).
SELECT position('blocked_user_ids' IN
       pg_get_functiondef('private.active_chat_attachment_readable(text)'::regprocedure)) > 0
       AS attachment_policy_is_block_aware;
-- expect: true

-- 4. Protected tables are still closed to clients (075 self-check, re-asserted).
SELECT has_table_privilege('authenticated','public.admin_audit_events','SELECT') AS must_be_false,
       has_table_privilege('anon','public.posts','SELECT')                       AS must_also_be_false,
       has_table_privilege('authenticated','public.posts','SELECT')              AS must_be_true;
-- expect: false, false, true
```

**What 075 does on production:** effectively nothing visible. Production already
carries the legacy Supabase default privileges, so the grants are already true
there. 075 exists so a *rebuilt* database — disaster recovery, a new environment,
a staging clone — comes up working instead of denying every read. Its fail-closed
self-check runs during the push and aborts if a protected table is ever exposed.

---

## Step 3 — Vercel production

If auto-deploy is on, the merge in Step 1 already triggered it; just confirm the
deployment that is **live** was built from the merged `main` commit. If you
turned auto-deploy off, promote now — after Step 2 is green, never before.

Smoke-check on production web, signed in as a real student:

- [ ] A club profile loads (name, members, tabs).
- [ ] A club member list shows everyone, including anyone you have blocked.
- [ ] Opening a blocked person's profile shows **"This account isn't available"**;
      opening someone *you* blocked shows **"You blocked this student" + Unblock**.
- [ ] A message thread with an image loads the image.
- [ ] Block that sender → the row stays, shows **"This attachment is no longer
      available."**, and no image loads. Unblock → the image returns.

---

## Step 4 — Local folders

```bash
# this repo
git checkout main && git pull

# the weglue folder — it is on fix/messages-tab-corrections with 27 uncommitted
# entries, so do NOT check main out there. Its refs are already fetched and its
# local main already points at origin/main.
cd /Users/zylvanaarellanocampos/weglue && git fetch origin
```

---

## Mobile is deliberately NOT in this release

PR #29 changes mobile code — the attachment delivery rewrite, the shared-context
identity fallbacks, the directional blocked-profile screen and the cache clear.
**None of it reaches phones without an EAS release, which is not authorized here**
(development rule 6). After this release, mobile source and shipped mobile app are
intentionally out of sync.

What that means for the security fix in the meantime, stated precisely:

- Once 074 is applied, the shipped mobile client **cannot mint a new signed link**
  for a blocked pair — Storage refuses at mint time.
- The residual gap is only a link **already minted before the block** on an
  un-updated client, bounded by its 60-second TTL.
- The web fix removes even that, because web no longer mints links at all.

Close it fully by scheduling a mobile release of the merged `main` through the
normal analysis-then-approval path.

---

## If something goes wrong

- **`db push` offers `--include-all`** → the ledger is out of order. Do not accept.
  Stop and re-run `check_migration_order.py`.
- **Web errors about a missing function after deploy** → Step 2 did not complete.
  Finish the push; the web build needs no change.
- **A 073 collision appears** (it did not in the preflight) → the push aborts with
  `club_name_already_exists_at_university` and nothing partially applies. Resolve
  by renaming one club deliberately. **Never** append a number — the design
  rejects collisions outright rather than inventing suffixes.
- Migrations 069–075 are forward-only. There is no down-migration; a rollback
  means a point-in-time restore, so verify Step 2 before Step 3.
