# C4 backend notes

## Files

- `supabase/migrations/125_admin_interest_tx.sql` registers the seven exact audit actions from DESIGN §4 and adds six `RETURNS jsonb` transactional Admin RPCs:
  - `admin_tx_interest_create`
  - `admin_tx_interest_rename`
  - `admin_tx_interest_set_active`
  - `admin_tx_assign_club_interest`
  - `admin_tx_remove_club_interest`
  - `admin_tx_set_club_interest_tier`
- Every mutation calls the existing `private.admin_tx_fail` or `private.admin_tx_ok` helper, uses `SECURITY DEFINER SET search_path TO ''`, and is executable only by `service_role`.
- Interest assignments write both `interest_id` and the legacy `interest` label column. Deactivation/reactivation never deletes catalog rows and preserves `archived_at` semantics.

## Deviations or deliberate choices

- No existing audit CHECK constraint, helper, table, policy, or RPC was redefined.
- Create derives lower-kebab slugs by converting `&` to `and`, collapsing non-alphanumeric runs to one hyphen, and trimming hyphens. Explicit slugs use the existing migration-056 validation vocabulary with the new `invalid_slug` status.
- Club assignment uses `ON CONFLICT DO NOTHING` after the explicit duplicate check so a concurrent duplicate returns the durable `already_assigned` result instead of aborting on the unique constraint.
- The requested action names and existing audit target types are used verbatim, including camel-case `club.interestAssign`, `club.interestRetier`, and `club.interestRemove`.

## Claude must check

- Apply on the local clone and verify all seven catalog rows satisfy the existing CHECK constraints and the final sanity block reports `125 ok`.
- Exercise every success and failure status, including label/slug collisions, inactive/reactivation label collisions, missing clubs/interests, invalid tiers, duplicate assignments, missing assignments, no-op operations, and missing reasons for sensitive actions.
- Confirm `admin_tx_ok` audit rows and canonical mutations commit atomically, while `admin_tx_fail` rows commit without a canonical mutation.
- Verify before/after JSON fields, target IDs/types, metadata keys, and the frozen service-role-only grants.
- Confirm `interest.rename` updates `updated_at`, deactivation sets `archived_at`, reactivation clears it, and no function can hard-delete an interest.
- Confirm the client roles have no EXECUTE privilege and that `target_type` remains unchanged.
- No PostgreSQL server, Docker, network, or staging validation was available in this sandbox.

## Round 2 review fix

- Renamed the `admin_tx_interest_create` local label variable to `v_label` so it cannot collide with `public.interests.label` in PL/pgSQL queries. The other five functions were scanned for exact local-variable/table-column collisions; none required renaming.
