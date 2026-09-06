# C5 backend notes

## File

- `supabase/migrations/126_phone_discovery.sql` adds:
  - `public.get_phone_discovery_categories()` returning active catalog interests assigned to active clubs, ordered by `sort_order, label`.
  - `public.get_phone_discovery_clubs__inner(...)` with the frozen discovery row shape, `assert_self_or_null`, active-interest labels in `categories[]`, primary/secondary slug filtering, and weighted +3/+1 personalized ordering.
  - `public.get_phone_discovery_clubs(...)` with the existing `account_restricted` wrapper guard.
- The migration does not reference or modify `club_categories`, `get_discovery_clubs`, `get_discovery_clubs__inner`, or `get_discovery_events`.

## Deviations or deliberate choices

- The categories RPC exposes `sort_order` as a third return column so clients can preserve the catalog ordering. Because PostgreSQL cannot change a table-returning function's OUT-column list with `CREATE OR REPLACE`, the migration drops and recreates this new RPC definition safely on rerun.
- The phone RPCs use `SET search_path TO ''` and fully qualified application objects, matching the hardened 057 discovery definitions.
- `get_phone_discovery_categories` is authenticated-only because the committed legacy `club_categories` path has no anon table grant. The phone outer wrapper is authenticated-only, matching production `get_discovery_clubs`; the inner phone RPC is client-inaccessible so restricted students cannot bypass the wrapper guard.
- The wrapper and inner function both expose the same row shape and parameters; the wrapper alone performs the account-restriction check, while the inner function owns the self-or-null guard as in the existing discovery implementation.

## Claude must check

- Apply on the local clone and verify the exact return columns/types and all three signatures/defaults.
- Verify categories include only active interests assigned to active clubs, with either tier qualifying and deterministic `sort_order, label` ordering.
- Verify unfiltered phone discovery scores user active `interest_id` rows at primary 3 / secondary 1, then member count/name; filtered discovery uses active slug membership and name ordering only.
- Verify NULL `p_user_id` falls back to popularity/name, non-self IDs are rejected by `assert_self_or_null`, and restricted authenticated users receive `account_restricted` with SQLSTATE `42501`.
- Verify anon/authenticated/service-role function privileges against the intended legacy discovery reachability and confirm the frozen legacy objects are byte-identical.
- No PostgreSQL server, Docker, network, or staging validation was available in this sandbox.

## Grant review fix

- Corrected phone discovery privileges to match production: categories and the outer wrapper are authenticated-only, while `get_phone_discovery_clubs__inner` is revoked from all client roles and granted only to `service_role` (the SECURITY DEFINER wrapper owner can also call it).
