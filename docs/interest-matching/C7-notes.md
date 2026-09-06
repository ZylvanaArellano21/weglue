# C7 regression harness notes

## Files

- `supabase/scripts/test_122_126_interest_matching.sql` is an `ON_ERROR_STOP`
  psql harness. It exercises catalog/RLS/write-path behavior from 122, all 41
  123 seed triples, weighted scoring and batch top-up behavior from 124,
  transactional admin success/failure auditing from 125, and the phone-only
  discovery RPCs and grants from 126.
- `supabase/scripts/harness_manifest.py` registers the harness as a
  `stack17` disposable-local-stack test with `criterion="raise"`. The
  manifest note requires a full local migration reset followed by 122-126;
  it does not add a plain-Postgres fixture chain because the contract depends
  on `auth.users`, account restrictions, launch-campus configuration, and the
  production-shaped twelve-club data.

The SQL creates only synthetic `c7_*` users, a counter/helper pair, and
disposable test mutations. It uses `request.jwt.claims` while switching to
`anon`/`authenticated`; it never uses a production connection or credential.

## Deviations / deliberate harness choices

- The harness is run after 126, so it cannot itself obtain a pre-126 function
  snapshot. It verifies that the frozen discovery functions still use
  `club_categories` rather than `club_interests`. If Claude captures the exact
  pre-126 definitions into `public.c7_frozen_discovery_defs` before applying
  126 (`name text`, `definition text`), the harness additionally performs the
  requested byte-for-byte `pg_get_functiondef` comparison. This is the only
  intentional fallback; the migration itself remains untouched.
- The harness uses a full local Supabase stack entry (`stack17`) because the
  current manifest runner's disposable `pg15` builder only supports the
  minimal fixture chains. The runner must therefore be pointed at an owned,
  throwaway local stack, never `--linked` or Production.
- No migration or application file is changed by the harness. The persistent
  `c7_t_counter` and helper functions are test instrumentation and belong only
  in the disposable database.

## Claude should double-check

- Run after a fresh full-chain reset plus migrations 122-126 with the exact
  twelve handles from C1 and the local demo JWT path. Confirm the auth signup
  trigger accepts the five synthetic `auth.users` rows and that the local
  launch university is configured.
- Before applying 126, optionally capture the four frozen objects (the
  `club_categories` table and the three frozen discovery function definitions)
  for the exact comparison branch above.
- Confirm the expected local club population has the C1 member counts; the
  popularity/top-up assertions intentionally derive the expected fallback
  order from the live eligible rows, while the primary personalized assertion
  expects Accounting Club to outrank Economics Club for Finance.
- Verify the final psql exit status is zero and the final
  `migrations 122-126 interest-matching harness: ... assertions PASSED` notice
  appears. Any failed assertion raises and must produce a nonzero exit.

## Dollar-quoted placeholder fix

- Replaced the non-interpolated `:C7_OTHER` in the `c7_t_denied` SQL string at
  line 965 with its literal UUID.
- Replaced the non-interpolated `:C7_RESTRICTED` in the wrapper denial SQL
  string at line 984 with its literal UUID.
- Replaced the non-interpolated `:C7_RESTRICTED` in the inner denial SQL string
  at line 988 with its literal UUID.

A complete scan found no remaining `:C7_*` placeholders inside any `$$...$$`
region; remaining placeholders are bare top-level psql substitutions.
