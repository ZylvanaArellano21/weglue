# Migration-ledger reconciliation (versions 115 / 116 / 120)

**Branch:** `chore/migration-ledger-reconcile`
**Status:** prepared — NOT merged, NOT applied. No `supabase db push`. No production ledger write.
**Blocks:** production application of migrations 122–126 (PR #103) until this lands on `main`.

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

Principle: **do not rewrite, rename, delete, or replace historical migrations; do not delete any production ledger row.** Make the repo an honest record of what production ran, and make `db push` safe.

| Version | Change on this branch | Effect on production |
|---|---|---|
| **115** | Header note added to `115_disable_rotate_chat_invitation.sql` explaining the shadow. **No SQL change.** The Math Society seed SQL is preserved in §4 below for the record — it is **not** re-added as a migration file because version 115's number is taken and renaming the historical file is off-limits. | None. Prod's `rotate_chat_invitation` stays as-is (harmless dead code — the client feature was removed in PR #94, nothing calls it). Re-applying the no-op is a **separate deferred decision**, deliberately not bundled here. |
| **116** | `116_seed_music_club.sql` restored from `c9d5f38a`, byte-identical **except** the "already exists" guard is changed from `RAISE EXCEPTION` → `RAISE NOTICE … RETURN` (idempotent skip). Plus `supabase/scripts/reconcile_ledger_116.sql` for the manual-apply path. | When 122–126 are applied at rollout Step 2: `db push` sees version 116 missing from the remote ledger, runs `116_seed_music_club.sql` (a clean no-op — Music Club exists), and **records the ledger row automatically**. Gap closed, no duplicate club, no history rewrite. |
| **120** | The untracked `120_seed_philosophy_club.sql` is committed, **neutralized to a no-op** (`RAISE NOTICE` only), with the original production SQL preserved verbatim in a comment block. Header explains the Philosophy → The Academy succession. | None. Version 120 is already in the prod ledger, so `db push` skips the file on production. The no-op body only matters for fresh/local rebuilds, where it must **not** recreate the deleted Philosophy Club. |

### Interaction with PR #103 (migrations 122–126)
- PR #103 touches only `122`–`126` + `test_122_126_interest_matching.sql` + `harness_manifest.py`. **Zero overlap** with any file on this branch.
- After this branch merges to `main`, the repo has files for 115, 116, 117, 118, 119, 120, 121; production has ledger rows for 115, 117, 118, 119, 120, 121. `db push` then computes "to apply" = **{116, 122, 123, 124, 125, 126}** and runs them in version order — 116 first (no-op + ledger row), then 122–126.
- **This branch must merge to `main` before PR #103.**

---

## 3. Rollout position

1. **This branch** → PR → review → merge to `main`. *(no production action)*
2. Revalidate migrations 122–126 (PR #103) against the reconciled state + the actual 13 production club handles (incl. `TheAcademy`, not `PhilosophyClub`).
3. **Separate founder authorization** → apply 116 + 122–126 to production:
   - preferred: `supabase db push --linked` (handles the 116 ledger row automatically);
   - fallback (Management-API apply): run `supabase/scripts/reconcile_ledger_116.sql` once first, then apply 122→126 in order and insert their ledger rows.
4. Verify production backend.
5. Merge PR #103 → Vercel Production deploy.
6. Verify web + Admin Dashboard + matching.
7. Mobile release — separate, later authorization.

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
