# BE-4 implementation report

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
