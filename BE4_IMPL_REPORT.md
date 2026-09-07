# BE-4 implementation report

> **Renumbered 2026-09-06:** the migration and harness shipped here as `125` were
> renumbered to **`131`** after the interest-matching family (migrations 122-127)
> merged to `main`/production. The files are now `131_public_club_twin.sql` and
> `test_131_public_club_twin.sql`. The number is the only change — every "125"
> below refers to the same reviewed-and-accepted content.

## Progress

Contract and source audit read in full. Schema, neighboring migrations, and harness/manifest conventions inspected. No concrete blocker found. Migration 125 and the rollback harness are written; static checks pass. Disposable execution is pending because Docker is inaccessible in this Codex sandbox.

## Implemented signatures

1. `public.get_public_club_profile(uuid) RETURNS jsonb`
2. `public.get_public_club_upcoming_events(uuid, text, integer) RETURNS jsonb`
3. `public.get_public_club_past_events(uuid, text, integer) RETURNS jsonb`
4. `public.get_public_club_media(uuid, text, integer) RETURNS jsonb`
5. `public.get_public_club_posts(uuid, text, integer) RETURNS jsonb`

All five are `LANGUAGE plpgsql`, `STABLE`, `SECURITY DEFINER`, and `SET search_path = ''`. Each has the exact `REVOKE ALL ... FROM PUBLIC, anon, authenticated` followed by the exact `GRANT EXECUTE ... TO anon, authenticated`.

Migration 125 also executes `REVOKE SELECT ON public.clubs FROM anon;` plus a fail-closed `REVOKE ALL` across the remaining public-twin base tables, and creates no policy or base-table grant.

## Cursor implementation

Returned cursors are UTF-8 JSON encoded with PostgreSQL `encode(..., 'base64')`, then converted to base64url by replacing `+` with `-`, `/` with `_`, and removing trailing `=`. Decoding reverses the substitutions, restores padding from length modulo four, decodes UTF-8, and casts to JSONB. The implementation requires the exact collection-specific key set, validates collection marker, date/time or RFC3339 timestamp shape and casts, and validates UUID shape/cast. Any malformed, wrong-collection, or cross-event-feed cursor raises `invalid_cursor` with SQLSTATE `22023`.

Every paginated query uses row-value keysets and reads at most `effective_limit + 1`; `next_cursor` is built from the last returned row only when the extra probe exists. Limits use `LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)`.

## Filter predicates

- Club: `FROM public.clubs AS c WHERE c.id = p_club_id AND c.is_active IS TRUE`.
- Events: explicit `public.events AS e JOIN public.clubs AS c ON c.id = e.club_id`, then `e.club_id = p_club_id`, `c.id = p_club_id`, `c.is_active IS TRUE`, `e.visibility = 'everyone'`, and `public.content_is_student_visible('event', e.id)`, with `e.event_end_at > now()` for upcoming and `e.event_end_at <= now()` for past.
- Media: explicit `public.club_photos AS cp JOIN public.clubs AS c ... LEFT JOIN public.posts AS p ...`, then `cp.club_id = p_club_id`, active club, `cp.is_visible IS TRUE`, and `(cp.source = 'officer_upload' OR (cp.source = 'tagged_post' AND p.id IS NOT NULL AND public.content_is_student_visible('post', p.id)))`.
- Posts: explicit `public.posts AS p JOIN public.clubs AS c ...`, then `p.club_id = p_club_id`, `p.club_id IS NOT NULL`, `p.author_kind = 'club'`, active club, and `public.content_is_student_visible('post', p.id)`.

No private viewer-visibility function is called. No supporting indexes were added because this environment could not provide an EXPLAIN-backed need, and the existing identity/order indexes cover the contract’s access paths.

## Diff summary

- `supabase/migrations/125_public_club_twin.sql`: 944 lines, new.
- `supabase/scripts/test_125_public_club_twin.sql`: 553 lines, new rollback harness.
- `supabase/scripts/harness_manifest.py`: +6 lines, registers the harness on `stack17_clone`.
- `supabase/scripts/check_migration_order.py`: unchanged; it does not enumerate an expected-files list.
- `BE4_IMPL_REPORT.md`: this report.

## Verification

Static verification completed:

- `git diff --check` passed.
- `python3 -m py_compile supabase/scripts/harness_manifest.py supabase/scripts/check_migration_order.py` passed.
- Migration scan found exactly five new public-club function definitions, five revokes, five grants, and no `SELECT *`, `%ROWTYPE`, `OFFSET`, private event-access call, policy, or base-table grant.

Harness command intended by the manifest runner:

`python3 supabase/scripts/run_harnesses_manifest.py --pg pg15 --only test_125_public_club_twin.sql --logdir /private/tmp/be4-harness-log`

Could not run; Claude must run it. Docker access failed in this sandbox with `permission denied while trying to connect to the Docker API at unix:///Users/zylvanaarellanocampos/.colima/default/docker.sock`. Therefore there is no real pass/fail harness output to paste yet.

Captured runner output:

```text
→ test_125_public_club_twin.sql                        env=stack17_clone
[setup] disposable stack fingerprint tables/fns/policies = permission denied while trying to connect to the docker API at unix:///Users/zylvanaarellanocampos/.colima/default/docker.sock rc=1
[infra] disposable stack unreachable — retrying
```

The runner made the same failed Docker check on all three infrastructure attempts before the sandbox command window ended; no harness SQL was executed.

Admin Dashboard Impact: VERIFIED - NO UPDATE REQUIRED

## Deviations and open verification

No deviation from `BE4_CONTRACT.md` was identified. The only unverifiable item is disposable PostgreSQL execution; Claude must run the registered `stack17_clone` harness after the clone source contains migration 125. No unrelated bugs were changed.

---

## Claude review + fixes (2026-09-06)

Reviewed migration 125 line-by-line against BE4_CONTRACT.md and the live schema,
then ran the harness for real (manual `pg_dump | psql` clone of the local
migrated stack + `run_harnesses_manifest.py --pg pg17 --only
test_125_public_club_twin.sql`).

### Schema verification (all correct as written)
`event_activities.activity`, `event_interests.interest`,
`post_images.storage_path/position/width/height`, `club_officers.display_order`,
`club_goals.goal_text/display_order`, `club_photos.url/source/caption/created_at/
is_visible`, `events.emoji/cover_image_url/event_end_at(NOT NULL)/visibility`,
`posts.author_kind/image_url/caption`,
`content_is_student_visible(text,uuid) -> boolean STABLE SECURITY DEFINER` — all
match the migration's references.

### Founder verification items — PASS
- **Public storage loads anonymously:** buckets `club-avatars`, `club-covers`,
  `club-photos`, `posts` are all `public = true`. Anonymous `GET
  /storage/v1/object/public/club-avatars/...` returns HTTP 200 with no auth
  header; a private bucket returns 400.
- **Revoking the legacy anon `clubs` SELECT does not break signup/pre-auth/
  onboarding:** no anonymous flow does a direct `SELECT FROM public.clubs`. The
  pre-signup club-match survey (`onboarding/activities`) calls the
  `SECURITY DEFINER` RPC `preview_club_match_count` (which has no `anon` EXECUTE
  grant and already degrades to `matchCount: 0` via try/catch). The post-signup
  `onboarding/explore-clubs` page guards on an authenticated user and reads
  `clubs` as `authenticated`. `universities` / `app_config` (the actual live
  pre-auth reads) are untouched.
- **Anon can call the RPCs over PostgREST:** `POST /rest/v1/rpc/
  get_public_club_profile` with only the anon apikey returns the exact 20-key
  envelope.

### Bugs found and fixed

Migration `125_public_club_twin.sql`:
1. **Cursor base64 newline (functional bug).** Postgres `encode(bytea,'base64')`
   wraps output at 76 chars with `\n`. The generated cursor therefore contained
   a literal newline and was rejected by the decoder's `^[A-Za-z0-9_-]+$`
   guard — every "next page" call raised `invalid_cursor`. Fixed all 8 cursor
   encoders to `replace(..., E'\n', '')` before the base64url substitutions.
2. **Anon RLS policy not dropped.** Migration 003's `clubs: anon can read`
   `TO anon` policy survived (only the grant was revoked). Added
   `DROP POLICY IF EXISTS "clubs: anon can read" ON public.clubs;` and extended
   the self-check DO block to assert no `TO anon` policy remains on any of the
   15 public-twin base tables. `club_interests` / `universities` / `app_config`
   deliberately keep their anon policies (live pre-auth surface, outside BE-4).

Harness `test_125_public_club_twin.sql`:
3. `t125_safe_json` recursive CTE had two recursive terms (Postgres allows one) —
   merged into a single lateral `jsonb_each UNION ALL jsonb_array_elements`.
4. `t125_ok('authenticated receives same anon-safe RPC subset', ...)` referenced
   `a`/`b` with no FROM clause — added the `t125_calls a JOIN t125_calls b`.
5. `'specific'` event fixture violated `validate_event_specific_audience` —
   added `specific_user_ids => ARRAY[:MEMBER]`.
6. anon/authenticated lacked `SELECT` on the `t125_*` scratch tables (only
   `INSERT`) — the second-page cursor read-back failed. Added `SELECT`.
7. `:CLUB` psql var used inside a `DO $$ ... $$` body (not substituted) — derive
   the club id from `t125_calls.core->>'id'` instead.
8. "no anon policy" assertion was schema-wide (would fail on the legitimate
   `universities`/`app_config`/`deletion_requests` anon policies) — scoped to
   the 15 contract tables.
9. `SET search_path = ''` source-substring check never matched
   (`pg_get_functiondef` renders `SET search_path TO ''`) — assert on
   `'search_path=""' = ANY(p.proconfig)` instead.
10. Unbalanced paren on the "five RPCs execute-able only through explicit client
    grants" assertion (`);` should have been `));`).
11. `harness_manifest.py`: registered `test_125_public_club_twin.sql` in
    `PG17_COMPAT` so `--pg pg17` selects it.

### Harness result (real run)
`run_harnesses_manifest.py --pg pg17 --only test_125_public_club_twin.sql`
→ `1 PASS / 0 not-pass`. All **20** in-harness assertions PASS; the trailing
failure-check `RAISE` did not fire. Local stack was reverted to its pre-125
state afterward (grant restored, policy restored, functions dropped, clone DB
dropped).

**BE-4 accepted at the implementation + harness level.** Not applied to any
remote. `packages/database/src/types.ts` regen is deferred to the Change 6
frontend integration.
