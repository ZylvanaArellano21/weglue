-- =============================================================================
-- READ-ONLY PRODUCTION PREFLIGHT for migration 073
--
-- Run this BEFORE 073 is ever applied remotely. It answers one question only:
-- would 073's university-scoped uniqueness and backend handle derivation reject
-- any club row that exists in production today?
--
-- IT MUTATES NOTHING. There is no INSERT, UPDATE, DELETE, ALTER, CREATE or
-- DROP anywhere below, no rename, and no numeric suffix is ever invented. If a
-- conflict is found, the correct response is a founder product decision about
-- which club keeps the name — not an automatic repair.
--
-- HOW TO RUN
--   Supabase Management API:
--     POST /v1/projects/{ref}/database/query   with  {"read_only": true, ...}
--     (that endpoint executes as `supabase_read_only_user` inside a read-only
--      transaction; verify with the identity probe in section 0)
--   or psql:
--     BEGIN TRANSACTION READ ONLY;  \i this_file  ROLLBACK;
--
-- 073 IS NOT ASSUMED TO EXIST. `normalized_club_name()` and
-- `club_handle_from_name()` are not installed in production yet, so every
-- expression below is inlined verbatim from the bodies in
-- supabase/migrations/073_blocking_override_and_club_identity.sql:
--
--   normalized_club_name(n) = lower(regexp_replace(btrim(coalesce(n,'')), '\s+', ' ', 'g'))
--   club_handle_from_name(n) = regexp_replace(btrim(coalesce(n,'')), '[^a-zA-Z0-9]', '', 'g')
--
-- Uniqueness that 073 creates:
--   UNIQUE (university_id, normalized_club_name(name))
--   UNIQUE (university_id, lower(handle))
-- plus a BEFORE trigger whose explicit collision check compares university with
-- IS NOT DISTINCT FROM, so two clubs with a NULL university_id also collide
-- there even though the unique INDEX would treat their NULLs as distinct.
-- Section 6 reports that case separately because the two disagree.
-- =============================================================================

-- ── 0. Environment identity. Confirm this is the intended production DB and
--       that the session really is read-only BEFORE trusting anything below.
SELECT
  current_database()                                             AS database,
  current_user                                                   AS effective_role,
  current_setting('transaction_read_only')                       AS transaction_read_only,
  pg_is_in_recovery()                                            AS is_replica,
  (SELECT count(*)   FROM supabase_migrations.schema_migrations) AS migrations_applied,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest_migration,
  (SELECT count(*)   FROM public.clubs)                          AS clubs_total,
  (SELECT count(*)   FROM public.universities)                   AS universities_total,
  to_regprocedure('public.normalized_club_name(text)') IS NOT NULL AS migration_073_already_applied;

-- ── 1. Duplicate NORMALIZED NAMES inside the same university.
--       These are the rows 073's clubs_university_normalized_name_key would
--       refuse. Each conflict group must be resolved by a human decision.
WITH c AS (
  SELECT
    id, university_id, name, handle,
    lower(regexp_replace(btrim(coalesce(name, '')),   '\s+', ' ', 'g'))       AS normalized_name,
    regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g')        AS derived_handle
  FROM public.clubs
)
SELECT
  'duplicate_normalized_name'                                   AS conflict_type,
  dense_rank() OVER (ORDER BY c.university_id, c.normalized_name) AS conflict_group,
  c.id                                                          AS club_id,
  c.university_id,
  c.name                                                        AS current_name,
  c.handle                                                      AS current_handle,
  c.normalized_name,
  c.derived_handle
FROM c
JOIN (
  SELECT university_id, normalized_name
    FROM c
   GROUP BY university_id, normalized_name
  HAVING count(*) > 1
) dup
  ON dup.university_id IS NOT DISTINCT FROM c.university_id
 AND dup.normalized_name = c.normalized_name
ORDER BY conflict_group, c.name, c.id;

-- ── 2. Duplicate DERIVED HANDLES inside the same university.
--       Derived, not current: 073 re-derives every handle from the name, so two
--       clubs whose CURRENT handles differ can still collide afterwards
--       (for example "Forest Club" and "Forest-Club" both derive ForestClub).
WITH c AS (
  SELECT
    id, university_id, name, handle,
    lower(regexp_replace(btrim(coalesce(name, '')),   '\s+', ' ', 'g'))       AS normalized_name,
    regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g')        AS derived_handle
  FROM public.clubs
)
SELECT
  'duplicate_derived_handle'                                          AS conflict_type,
  dense_rank() OVER (ORDER BY c.university_id, lower(c.derived_handle)) AS conflict_group,
  c.id                                                                AS club_id,
  c.university_id,
  c.name                                                              AS current_name,
  c.handle                                                            AS current_handle,
  c.normalized_name,
  c.derived_handle
FROM c
JOIN (
  SELECT university_id, lower(derived_handle) AS lower_handle
    FROM c
   GROUP BY university_id, lower(derived_handle)
  HAVING count(*) > 1
) dup
  ON dup.university_id IS NOT DISTINCT FROM c.university_id
 AND dup.lower_handle = lower(c.derived_handle)
ORDER BY conflict_group, c.name, c.id;

-- ── 3. Empty or NULL club names, and 4. empty derived handles.
--       073's trigger raises club_name_must_contain_letters_or_numbers (23514)
--       for either, so these block the migration even without a duplicate.
SELECT
  CASE
    WHEN name IS NULL OR btrim(name) = '' THEN 'empty_or_null_name'
    ELSE 'empty_derived_handle'
  END                                                                    AS conflict_type,
  id                                                                     AS club_id,
  university_id,
  name                                                                   AS current_name,
  handle                                                                 AS current_handle,
  lower(regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g'))      AS normalized_name,
  regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g')     AS derived_handle
FROM public.clubs
WHERE name IS NULL
   OR btrim(name) = ''
   OR regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g') = ''
ORDER BY id;

-- ── 5. Every club whose CURRENT handle differs from the handle 073 would
--       derive. These are NOT conflicts: 073 rewrites them on the spot, by
--       design ("a client-supplied handle is overwritten, never trusted").
--       Listed so the change to a public slug is a reviewed fact, not a
--       surprise. Section 7 confirms no route depends on the handle.
SELECT
  'handle_will_be_rewritten'                                         AS change_type,
  id                                                                 AS club_id,
  university_id,
  name                                                               AS current_name,
  handle                                                             AS current_handle,
  regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g') AS derived_handle
FROM public.clubs
WHERE handle IS DISTINCT FROM regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g')
ORDER BY name, id;

-- ── 6. Clubs with a NULL university_id.
--       The unique INDEX treats NULLs as distinct, but the trigger's collision
--       check uses IS NOT DISTINCT FROM and therefore treats them as equal.
--       Any duplicate normalized name among these rows would pass the index and
--       still be rejected by the trigger, so they are reported separately.
SELECT
  'null_university_scope'                                            AS conflict_type,
  id                                                                 AS club_id,
  university_id,
  name                                                               AS current_name,
  handle                                                             AS current_handle,
  lower(regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g'))  AS normalized_name,
  regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g') AS derived_handle
FROM public.clubs
WHERE university_id IS NULL
ORDER BY name, id;

-- ── 7. VALID cross-university duplicates. INFORMATIONAL ONLY.
--       073 exists partly to ALLOW these: two universities may each have a
--       "Forest Club". They must never be reported as conflicts or renamed.
WITH c AS (
  SELECT id, university_id, name,
         lower(regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g')) AS normalized_name
  FROM public.clubs
)
SELECT
  'valid_cross_university_duplicate'   AS note,
  c.normalized_name,
  count(*)                             AS clubs_sharing_the_name,
  count(DISTINCT c.university_id)      AS distinct_universities,
  array_agg(c.id ORDER BY c.id)        AS club_ids
FROM c
GROUP BY c.normalized_name
HAVING count(*) > 1
   AND count(DISTINCT c.university_id) = count(*)
ORDER BY c.normalized_name;

-- ── 8. Single-row verdict. Zero on every counter means 073 can be applied
--       without renaming anything and without inventing any number.
WITH c AS (
  SELECT id, university_id, name, handle,
         lower(regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g'))   AS normalized_name,
         regexp_replace(btrim(coalesce(name, '')), '[^a-zA-Z0-9]', '', 'g')  AS derived_handle
  FROM public.clubs
)
SELECT
  (SELECT count(*) FROM (
     SELECT 1 FROM c GROUP BY university_id, normalized_name HAVING count(*) > 1
   ) x)                                                        AS name_conflict_groups,
  (SELECT count(*) FROM (
     SELECT 1 FROM c GROUP BY university_id, lower(derived_handle) HAVING count(*) > 1
   ) x)                                                        AS handle_conflict_groups,
  (SELECT count(*) FROM c WHERE name IS NULL OR btrim(name) = '')  AS empty_names,
  (SELECT count(*) FROM c WHERE derived_handle = '')               AS empty_derived_handles,
  (SELECT count(*) FROM c WHERE university_id IS NULL)             AS null_university_clubs,
  (SELECT count(*) FROM c WHERE handle IS DISTINCT FROM derived_handle) AS handles_to_rewrite,
  (SELECT count(*) FROM c)                                         AS clubs_total;
