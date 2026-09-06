# Migration-ledger reconciliation (versions 115 / 116 / 120)

**Branch:** `chore/migration-ledger-reconcile` (PR #104)
**Status:** prepared — NOT merged, NOT applied. No `supabase db push`. No production ledger write.
**Blocks:** the whole interest-system rollout. This PR merges first; the production ledger is
reconciled (via `supabase migration repair`) only under separate founder authorization; only then
may the backend-interest PR's migrations be applied.

**Principle:** historical migrations are an immutable record. This reconciliation never re-numbers,
deletes, or rewrites a historical migration, never runs a *modified* historical seed, and never
deletes a production ledger row. It restores the authentic files and uses the Supabase CLI's
dedicated `migration repair` operation to re-record the one ledger row that was hand-deleted.

---

## 1. What went wrong

`supabase db push` and `supabase migration list` match migrations **by version number only** — they never compare a local file's contents against the recorded `supabase_migrations.schema_migrations.statements`. Once production has a row for a version number, that number is "applied" forever regardless of what the repo's file with that number says.

Between 2026-09-01 and 2026-09-04, several clubs were seeded by running the seed SQL **directly against production from an out-of-sync worktree** — outside the repo migration flow. Those runs recorded ledger rows that `main` never authored under those numbers, and `main` had meanwhile used some of the same numbers for unrelated migrations.

### Production ledger today (versions ≤ 121)

| Version | `name` | In repo `main`? | Notes |
|---|---|---|---|
| 115 | `seed_math_society_club` | ❌ (repo 115 is a different migration) | Math Society club is live (member_count 6). |
| 116 | *(no row)* | ❌ | Had `seed_music_club` on 2026-09-03; row later removed by hand. Music Club is live. |
| 117 | `app_releases_store_sync` | ✅ `117_app_releases_store_sync.sql` | matches |
| 118 | `post_image_dimensions` | ✅ `118_post_image_dimensions.sql` | matches |
| 119 | `app_releases_build_number` | ✅ `119_app_releases_build_number.sql` | matches |
| 120 | `seed_philosophy_club` | ❌ (was an untracked file only) | Philosophy Club has since been **deleted**; successor is **The Academy**. |
| 121 | `sync_store_app_release_role_guard_fix` | ✅ `121_sync_store_app_release_role_guard_fix.sql` | matches |

### The three divergences

**Version 115 — content mismatch.**
Repo `main` has `115_disable_rotate_chat_invitation.sql` (from PR #94, merged 2026-09-02), which rewrites `public.rotate_chat_invitation(uuid)` into a read-only no-op. Production's version 115 is instead `seed_math_society_club`. **PR #94's DB change never reached production** — verified: `public.rotate_chat_invitation(uuid)` in prod is still the original *rotating* implementation (`UPDATE chat_invitations SET revoked_at = now(); RETURN get_or_create_chat_invitation(...)`). `db push` treats 115 as applied and skips the file permanently.

Commit `c7d21bed` had already `git mv`'d the repo's real 116/117/118 → **117/118/119** to survive this collision, which is why 117–119 now line up with production exactly.

**Version 116 — file renamed away, row later deleted.**
`116_seed_music_club.sql` existed only on the unmerged PR #93 branch `chore/seed-math-society-club` (commit `c9d5f38a`). It was run against production on 2026-09-03 (Music Club created), recording ledger row `116 = seed_music_club` — independently confirmed at the time via `supabase migration list --linked` and a direct ledger read (see `c7d21bed` commit message). That ledger row was then **removed by hand** sometime after 2026-09-04. The Music Club row itself is untouched (now claimed, President = a real student, not zylvana21).

**Version 120 — prod-only, never committed.**
`supabase/migrations/120_seed_philosophy_club.sql` existed only as an **untracked working-tree file** — `git log --all` shows zero commits touching it on any branch. It was run directly against production (Philosophy Club created), recording `120 = seed_philosophy_club`. The untracked file is byte-identical to the recorded statement.
**Philosophy Club has since been removed from production.** Its officers recreated it as **"The Academy"** (`handle = TheAcademy`, member_count 7, student-claimed, created 2026-09-04), which keeps the same philosophy focus. The Academy is a distinct club row (different id / created_at / officers), not a rename.

### Not corrupted — just mismatched
No data is wrong. Every seeded club that should exist, exists (Math Society, Music Club); the one that was intentionally removed (Philosophy Club) is gone. The problem is purely that **repo files and the production ledger disagree on versions 115/116/120**, which makes `supabase db push` from any branch unsafe.

---

## 2. What this branch does

| Version | Change on this branch | Effect on production |
|---|---|---|
| **115** | Header note added to `115_disable_rotate_chat_invitation.sql` explaining the shadow. **No SQL change.** The Math Society seed SQL is preserved in §4 below for the record — it is **not** re-added as a migration file because version 115's number is taken and renaming the historical file is off-limits. | None from this PR. The lost read-only/no-rotation behaviour **is** reapplied — as forward migration **`127_disable_rotate_chat_invitation.sql`** in the backend-interest PR — so production ends up matching the approved contract. Production migration 115 and its ledger row are left untouched. |
| **116** | `116_seed_music_club.sql` restored **byte-identical to what production originally ran** (commit `c9d5f38a`) — the `RAISE EXCEPTION 'Music Club already exists'` guard is kept exactly. It is **not** turned into a re-runnable skip-if-exists. Plus `supabase/scripts/reconcile_ledger_116.sql` — a documented manual fallback. | The ledger row is restored with **`supabase migration repair --linked --status applied 116`** (see §5), which records `(116, seed_music_club, [<file text>])` **without executing the SQL** — Music Club is never inserted again. A plain `db push` does **not** do this (verified — see §5). |
| **120** | The untracked `120_seed_philosophy_club.sql` is committed **byte-identical to what production ran** (the exact prod `statements` text + the standard `;` terminator). No behaviour change, no neutralization. Its form (authentic vs. neutralized placeholder) is a **founder decision** — see §6. | None. Version 120 is already in the prod ledger, so `db push`/`migration repair` never touch it. Only a from-scratch `supabase db reset` would replay it. |

### Rollout / merge order (see §3)
- PR #104 files do **not** overlap the backend-interest PR (122–127 + harness + manifest + types + docs) or PR #103 (frontend). All three are disjoint.
- **PR #104 → `main` first.** Then, under separate founder authorization, `supabase migration repair --linked --status applied 116`. Then the backend-interest PR's migrations may be applied.

---

## 3. Rollout position — three clean stages

Production schema must never lead `main`. Migrations are applied to production **only after** the
PR that contains them is merged to `main`.

### A — Ledger reconciliation
1. **PR #104** → review → **merge to `main`** (founder approval).
2. **Separate founder authorization** → reconcile the production ledger:
   `supabase migration repair --linked --status applied 116`
   (records the 116 row from the authentic local file; runs no SQL). No other production action.

### B — Backend interest system
3. Create **`backend/interest-system`** PR off `main`, containing only the production-required DB
   portion: migrations **122–126**, the new **`127_disable_rotate_chat_invitation.sql`**, the DB
   regression harness (`test_122_126_interest_matching.sql`) + its `harness_manifest.py` entry,
   `packages/database/src/types.ts` DB-type additions, and the interest-matching design/status docs.
   **No frontend/Admin/mobile code.**
4. Revalidate 122–127 against the reconciled state + the actual 13 production club handles
   (incl. `TheAcademy`, not `PhilosophyClub`). Review → **merge to `main`**.
5. **Separate founder authorization** → `supabase db push --linked` (applies 122–127 only; 116 is
   already in the ledger from stage A, so this is a plain push — no `--include-all`).
6. **Verify the production backend** — `set_my_interests`, weighted `rank_eligible_clubs`,
   `get_my_club_recommendations` ≥ 2, `get_phone_discovery_categories` = 22, `admin_tx_*`,
   `rotate_chat_invitation` is now the read-only no-op, one real end-to-end signup.

### C — Frontend
7. Rebase/update **PR #103** onto `main` so only the frontend/Admin/mobile implementation remains.
   Review → merge → **Vercel Production deploy**.
8. Verify web + Admin Dashboard + matching manually.
9. **Mobile release — separate, later authorization.**

---

## 4a. Supabase CLI behaviour — verified 2026-09-05 (CLI 2.116.0, disposable ledger DBs)

**`supabase migration repair --linked --status applied 116` is the correct mechanism.**
Tested against a throwaway DB whose ledger held 115, 117–121 but not 116, with the authentic
`116_seed_music_club.sql` in the tree:

```
$ supabase migration repair --db-url <disposable> --status applied 116
Repaired migration history: [116] => applied
```
Result row: `version='116'`, `name='seed_music_club'`, `statements` = **1-element array** whose
element is the full file text with the **trailing `;` stripped** (ends `END $$`), `created_by` NULL
— identical in shape to the existing prod rows for 115 and 120. **The SQL was not executed** (no
Music Club created). This is exactly the format Supabase expects.

**Plain `supabase db push` will NOT apply 116 (or reconcile its row).**
```
$ supabase db push --db-url <disposable> --dry-run
Error: Found local migration files to be inserted before the last migration on remote database.
       Rerun the command with --include-all flag to apply these migrations: ... 116_seed_music_club.sql
```
`db push` exits and applies nothing when any local file sits below the remote head and is missing
from the remote ledger.

**`supabase db push --include-all` is UNSAFE against production.** It would attempt *every* gap
(on prod: 051, 099, 101, 103, 104, 105, 116) — migrations that were deliberately skipped. Never
use `--include-all` on production.

**Therefore:** run `migration repair` for 116 first (stage A step 2). After that, version 116 is no
longer a gap, and a plain `supabase db push` cleanly applies 122–127 (stage B step 5). The other
prod ledger gaps (051, 099, 101, 103, 104, 105) have **no local file**, so `db push` does not flag
them.

---

## 4b. Migration 116 — authentic SQL (verbatim, `seed_music_club`)

`supabase/migrations/116_seed_music_club.sql` on this branch is byte-identical to commit `c9d5f38a`
— including the `RAISE EXCEPTION 'Music Club already exists at Lone Star College'` guard. It is
**not** modified to be re-runnable. It runs cleanly only on a from-scratch `supabase db reset`
(where Music Club does not yet exist); against production the ledger row is restored by
`migration repair`, so the file is never executed there.

---

## 4. Production version 115 SQL — `seed_math_society_club` (verbatim, for the record)

This is what production actually ran as version 115. Kept here because the version-115 file slot in the repo is occupied by `115_disable_rotate_chat_invitation.sql` and renaming historical migrations is out of scope. The Math Society club is live in production.

```sql
-- Create the Math Society club at Lone Star College with zylvana21 as President.
-- Same seed-club pattern as 095/096/106/107: plain INSERTs so the standard triggers
-- fire (handle_club_created builds the club_group + officer_chat conversations,
-- handle_club_join adds the officer to both chats, update_club_member_count keeps
-- member_count in sync, private.derive_club_handle derives the handle,
-- sync_university_name fills the denormalised university text column).

DO $$
DECLARE
  v_university_id UUID;
  v_zylvana       UUID;
  v_zylvana_name  TEXT;
  v_math          UUID;
BEGIN
  SELECT id INTO v_university_id FROM universities WHERE name = 'Lone Star College';
  IF v_university_id IS NULL THEN
    RAISE EXCEPTION 'Lone Star College university not found';
  END IF;

  SELECT id, COALESCE(NULLIF(btrim(full_name), ''), username)
    INTO v_zylvana, v_zylvana_name
    FROM profiles WHERE username = 'zylvana21';
  IF v_zylvana IS NULL THEN
    RAISE EXCEPTION 'zylvana21 profile not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM clubs
    WHERE lower(name) = 'math society' AND university_id = v_university_id
  ) THEN
    RAISE EXCEPTION 'Math Society already exists at Lone Star College';
  END IF;

  INSERT INTO clubs (name, description, university_id, is_seed, claimed, is_active, member_count)
  VALUES (
    'Math Society',
    'A community for students who love mathematics. Members work through problems together, '
    || 'prepare for competitions, hear from faculty and guest speakers, and explore how math '
    || 'connects to careers in research, data, finance, and engineering.',
    v_university_id, false, false, true, 0
  )
  RETURNING id INTO v_math;

  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_math, v_zylvana, 'officer');

  INSERT INTO club_officers (club_id, user_id, display_name, role_title, display_order)
  VALUES (v_math, v_zylvana, v_zylvana_name, 'President', 0);

  RAISE NOTICE 'Math Society club id=%', v_math;
END $$;
```

---

## 6. Migration 120 — authentic SQL vs. neutralized placeholder (FOUNDER DECISION)

`120_seed_philosophy_club.sql` is committed on this branch **byte-identical to what production ran**
(the exact `statements` text from the prod ledger row + a `;` terminator). Its long-term form is an
open decision.

### Does a from-scratch rebuild diverge from the historical sequence?

**Yes — materially, and it already did before this reconciliation, independent of 120's form.**

- **Historical sequence:** version 120 created a "Philosophy Club" row (+ `club_members`,
  `club_officers`, and the `club_group` / `officer_chat` conversations its triggers build).
- **Current production:** that Philosophy Club was later **hard-deleted out of band** — there is
  **no migration anywhere** that records the deletion. Its successor **"The Academy"**
  (`handle = TheAcademy`) was created **through the app**, so no migration creates it either.
- A full-ledger `supabase db reset` therefore **cannot reproduce current production's club set**
  regardless of what 120 contains: it would be missing The Academy, Climbing Club, Accounting Club,
  ASAP, Asian American Association, Economics Club, Technology Club, Human Services, Mavericks in
  Recovery — every club created via the app rather than a seed migration. (Only SGA, Engineering,
  Math Society and Music Club have seed migrations.) The DB regression harness already compensates
  by inserting the 13 real handles itself; a real disaster-recovery would restore from a database
  backup, not by replaying migrations.

So with **authentic 120**: a fresh rebuild recreates a club production has since removed, on top of
an already-incomplete club set. With **neutralized 120**: a fresh rebuild omits it, slightly closer
to "current prod has no Philosophy Club", but the file no longer states what version 120 did (only
a comment does), and it still can't produce a prod-equivalent club set.

### Trade-off

| | Preserve authentic SQL | Neutralized placeholder |
|---|---|---|
| Migration file = what actually executed | ✅ yes | ❌ no (only a comment) |
| Consistent with the 116 decision (authentic, unmodified) | ✅ yes | ❌ no |
| Fresh `db reset` recreates the since-deleted Philosophy Club | ⚠️ yes (harmless in dev; wrong for a hypothetical migration-only prod rebuild) | ✅ no |
| Fresh `db reset` produces a prod-equivalent club set | ❌ no (unrelated clubs missing anyway) | ❌ no |
| Effect on the real production rollout | none (120 already in the ledger; `repair`/`push` skip it) | none |

### Recommendation

**Preserve the authentic SQL** (current state of this branch), for three reasons:
1. It is consistent with the 116 decision and the stated principle — historical migrations are an
   immutable record of what ran.
2. The neutralization only "protects" a from-scratch rebuild that is already non-authoritative for
   club data (many prod clubs have no seed migration), so the protection buys very little.
3. The correct way to represent the out-of-band deletion, if we want the replay to converge, is a
   **new forward migration** (e.g. a later `1NN_reconcile_seed_clubs.sql` that removes Philosophy
   Club if present and ensures the current prod handles exist) — not editing the historical file.
   That is a separate, optional cleanup and is **not** part of this reconciliation.

If you would rather keep a neutralized placeholder, say so and it will be swapped back — but the
recommendation is authentic + (optionally, later) a forward reconcile-seed migration.
