# C2/C3 backend notes

## `122_interests_catalog.sql`

- Creates the 22-row `public.interests` catalog in the C1 canonical order, with stable lower-kebab slugs, active-label uniqueness, the `updated_at` trigger, active-only anon/authenticated reads, and no client write policy.
- Adds `interest_id` and `tier` to `club_interests`, removes the legacy interest check, makes the ID required, adds the unique `(club_id, interest_id)` constraint and index, and removes officer writes while retaining anon/authenticated reads.
- Adds `user_interests.interest_id`, backfills all legacy labels case-insensitively, aborts with offending user/label values if any row remains unresolved, adds the ID uniqueness index, and leaves the legacy text column nullable for compatibility.
- Adds `set_my_interests(text[])`: authenticated-only, active-slug-or-label validation, per-user advisory transaction lock, replacement semantics, and legacy-label writes.

## `123_club_interest_seed.sql`

- Seeds 41 primary/secondary assignments for all 12 existing production clubs by exact `clubs.handle`, including `ASAPAlliedScholarsforAnimalProtection`.
- Uses the requested `(club_id, interest_id)` upsert, also refreshes the legacy `interest` label column, and fails if the insert affects anything other than 41 mapping pairs or if any target club has no primary interest.
- Does not create or modify any `clubs` rows.

## `124_scoring_and_surveys.sql`

- Replaces `rank_eligible_clubs` with label-to-active-catalog resolution, distinct overlap, weighted `match_score` (+3 primary/+1 secondary), the existing eligibility rules, and the requested ordering. `user_activities` is not used by scoring.
- Updates only the natural-match predicate in `generate_club_recommendation_batch` and `preview_club_match_count` from `interest_overlap > 0` to `match_score > 0`; both recommendation lookups now resolve active labels through `user_interests.interest_id`.
- Redeclares `get_my_club_recommendations` from migration 087 with only its top-up lookup changed to resolve active catalog labels through `interest_id`; its JSON shape, signature, and authenticated grant remain unchanged.
- Recreates the current avatar/oauth/terms-aware `handle_new_user` body with only the interest insert changed to join active catalog labels; the 10-value activities whitelist and batch/error guards are unchanged.
- Recreates only `reconcile_signup_survey` with the same catalog-driven interest insert. The activities insert, recent-sweep function, self wrapper, and permissions are preserved.

## Deviations or deliberate choices

1. `rank_eligible_clubs` is dropped and recreated rather than only `CREATE OR REPLACE`d. PostgreSQL rejects changing a function's `RETURNS TABLE` OUT-column list from two columns to three with `CREATE OR REPLACE`; the argument signature is unchanged, and the 045 client EXECUTE revokes are reapplied.
2. `club_interests` has no ID backfill because C1 confirmed it is empty in production. Migration 123 therefore seeds the clean ID-backed table directly.
3. No club rows are seeded because C1 confirmed all 12 target clubs already exist; this also follows the task's explicit prohibition on creating club rows.
4. `club_categories` is untouched. The current design revision selects strict Option B, and the table/discovery compatibility path is outside C2/C3.
5. The catalog seed uses `ON CONFLICT (slug) DO NOTHING` so a safe rerun does not overwrite a later admin label rename. The first application still inserts the exact canonical labels and order.
6. Migrations 125/126, admin transaction RPCs, discovery RPCs, and generated client types are not included because they are outside this requested C2+C3 file scope.

## Round 2 edits

- `set_my_interests` now accepts either active catalog slugs or active labels, case-insensitively, while rejecting NULL/unknown/inactive elements with the same `unknown_interest` error.
- Club seeding now maintains both `club_interests.interest_id` and the legacy `club_interests.interest` text.
- Batch generation and recommendation top-up resolve saved interests by active catalog IDs, so admin label renames do not break matching.
- Added the requested staging check comment for the `rank_eligible_clubs` drop/recreate.

## Round 3 edits

- Migration 122 now backfills existing `club_interests.interest_id` values from legacy labels and aborts with unresolved labels before enforcing `NOT NULL`.
- Migration 122 now removes duplicate resolved `(club_id, interest_id)` rows before adding the unique constraint, making non-production seeded environments safe to migrate.

## Defensive grant follow-up

- Migration 122 explicitly grants `service_role` `SELECT` on both `public.interests` and `public.club_interests`, so the admin catalog/read paths do not depend on Supabase default privileges.

## Backward-compat revision (Phase 10 — old-client safety)

- `user_interests.interest_id` is **kept nullable**. Currently distributed iOS/Android builds INSERT
  label-only `user_interests` rows; a `SET NOT NULL` would break "Edit interests" for every installed
  build until an app-store update.
- Added `public.user_interests_resolve_interest_id()` — a `BEFORE INSERT OR UPDATE` trigger on
  `user_interests` that resolves `interest_id` from the legacy `interest` label against the **active**
  catalog when a caller supplies a label but no id, and back-fills the label when a caller supplies
  only an id. An unknown label is left with `interest_id = NULL` (never rejected).
- The one-time backfill assertion (`RAISE EXCEPTION` if any existing row is unresolved after the
  `UPDATE`) is unchanged — migration-time state is still verified.
- `club_interests.interest_id` **stays NOT NULL** (not client-writable; seeds and admin RPCs always
  supply it).
- Enforcing NOT NULL on `user_interests.interest_id` is deferred to a later, separately-approved
  cleanup migration.

## Claude double-checks

- Compare the preserved `handle_new_user` base against production `pg_get_functiondef` on staging; this worktree's latest committed source is migration 098 and matches the C1-described avatar/oauth/terms version, but the migration cannot be applied or introspected here.
- Confirm staging accepts the transactional drop/recreate of `rank_eligible_clubs` and that no dependency requires `CASCADE`.
- Verify the 41-row `ON CONFLICT DO UPDATE` row count, all 12 primary assignments, RLS/grants, and the final function signatures.
- Exercise `set_my_interests` with an inactive slug, unknown slug, empty array, duplicate slug, and concurrent calls; verify legacy labels and IDs remain synchronized.
- Confirm the current frontend maps selected labels to catalog slugs before calling `set_my_interests`.
- No Docker, PostgreSQL client, network, or staging validation was available in this sandbox.
