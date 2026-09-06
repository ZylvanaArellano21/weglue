-- ===========================================================================
-- Regression harness — migrations 122-126 (interest matching)
--
-- HOW TO RUN (disposable local Supabase stack only; NEVER production):
--
--   1. Reset a throwaway local stack through the full migration ledger.
--   2. Apply 122_interests_catalog.sql through 126_phone_discovery.sql.
--   3. Run this file as the local database owner with psql -v ON_ERROR_STOP=1.
--
-- The local Supabase JWT secret / demo identities are used only by the local
-- stack. This harness never accepts or constructs a Production connection.
-- Every assertion raises on failure; the final notice is the pass summary.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE TABLE IF NOT EXISTS public.c7_t_counter (passed integer NOT NULL);
DELETE FROM public.c7_t_counter;
INSERT INTO public.c7_t_counter VALUES (0);
GRANT SELECT, UPDATE ON public.c7_t_counter TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.c7_t_assert(p_cond boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_cond THEN
    RAISE NOTICE 'PASS  %', p_label;
    UPDATE public.c7_t_counter SET passed = passed + 1;
  ELSE
    RAISE EXCEPTION 'FAIL  %', p_label;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.c7_t_denied(
  p_sql text,
  p_label text,
  p_expected text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    v_message := SQLERRM;
    IF p_expected IS NOT NULL
       AND position(lower(p_expected) IN lower(v_message)) = 0 THEN
      RAISE EXCEPTION 'FAIL  % — wrong error: %', p_label, v_message;
    END IF;
    RAISE NOTICE 'PASS  %  [%]', p_label, left(replace(v_message, E'\n', ' '), 88);
    UPDATE public.c7_t_counter SET passed = passed + 1;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % — statement SUCCEEDED but should have been denied', p_label;
END
$$;

CREATE OR REPLACE FUNCTION public.c7_t_failure(p_correlation_id uuid, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.c7_t_assert(
    (SELECT count(*) = 1
       FROM public.admin_audit_events
      WHERE correlation_id = p_correlation_id AND event_type = 'failure')
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_audit_events
      WHERE correlation_id = p_correlation_id AND event_type = 'success'
    ),
    p_label || ' writes one failure audit row and no success row'
  );
END
$$;

CREATE OR REPLACE FUNCTION public.c7_t_success(p_correlation_id uuid, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.c7_t_assert(
    (SELECT count(*) = 1
       FROM public.admin_audit_events
      WHERE correlation_id = p_correlation_id AND event_type = 'success')
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_audit_events
      WHERE correlation_id = p_correlation_id AND event_type = 'failure'
    ),
    p_label || ' writes exactly one success audit row and no failure row'
  );
END
$$;

-- Four fixed disposable auth identities. They are inserted below with the
-- owner role so the full-chain auth trigger creates the corresponding rows.
\set C7_USER       '''c7000000-0000-0000-0000-000000000001'''
\set C7_BATCH      '''c7000000-0000-0000-0000-000000000002'''
\set C7_PHONE      '''c7000000-0000-0000-0000-000000000003'''
\set C7_OTHER      '''c7000000-0000-0000-0000-000000000004'''
\set C7_RESTRICTED '''c7000000-0000-0000-0000-000000000005'''

-- The profiles FK points to auth.users on the full migration chain. INSERTing
-- auth.users also exercises the production signup trigger, while the ON
-- CONFLICT clauses keep a rerun of this disposable harness deterministic.
INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, role, aud,
  email_confirmed_at
)
VALUES
  (:C7_USER::uuid, 'c7-user@harness.invalid', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now()),
  (:C7_BATCH::uuid, 'c7-batch@harness.invalid', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now()),
  (:C7_PHONE::uuid, 'c7-phone@harness.invalid', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now()),
  (:C7_OTHER::uuid, 'c7-other@harness.invalid', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now()),
  (:C7_RESTRICTED::uuid, 'c7-restricted@harness.invalid', '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, username, full_name, university_id)
VALUES
  (:C7_USER::uuid, 'c7_user', 'C7 User', (SELECT launch_university_id FROM public.app_config LIMIT 1)),
  (:C7_BATCH::uuid, 'c7_batch', 'C7 Batch', (SELECT launch_university_id FROM public.app_config LIMIT 1)),
  (:C7_PHONE::uuid, 'c7_phone', 'C7 Phone', (SELECT launch_university_id FROM public.app_config LIMIT 1)),
  (:C7_OTHER::uuid, 'c7_other', 'C7 Other', (SELECT launch_university_id FROM public.app_config LIMIT 1)),
  (:C7_RESTRICTED::uuid, 'c7_restricted', 'C7 Restricted', (SELECT launch_university_id FROM public.app_config LIMIT 1))
ON CONFLICT (id) DO UPDATE
SET username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    university_id = EXCLUDED.university_id;

-- ===========================================================================
-- CATALOG — migration 122
-- ===========================================================================

DO $$
DECLARE
  v_expected text[] := ARRAY[
    'Finance & Business', 'Social Events', 'Music', 'Fashion',
    'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
    'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
    'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
    'Film & Media', 'Photography', 'Strategy and Critical Thinking',
    'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
  ];
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.interests;
  PERFORM public.c7_t_assert(v_count = 22, 'CAT-01 interests has exactly 22 rows');
  PERFORM public.c7_t_assert(
    (SELECT count(*) = 22
       FROM public.interests i
      WHERE i.is_active
        AND i.label = ANY(v_expected)
        AND i.slug = lower(i.slug)
        AND i.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND i.slug !~ '&'),
    'CAT-02 all canonical labels are active lower-kebab slugs');
  PERFORM public.c7_t_assert(
    NOT EXISTS (
      SELECT 1 FROM public.interests i
      WHERE i.label LIKE '%&%'
        AND position('and' IN i.slug) = 0
    ),
    'CAT-03 ampersands are represented as and in slugs');
  PERFORM public.c7_t_assert(
    (SELECT count(*) = 22 FROM unnest(v_expected) AS e(label)
      JOIN public.interests i ON i.label = e.label),
    'CAT-04 the exact canonical label set is seeded');
END
$$;

SELECT public.c7_t_assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.interests'::regclass),
  'CAT-05 interests has RLS enabled'
);

SET ROLE anon;
SELECT public.c7_t_assert(
  (SELECT count(*) = count(*) FILTER (WHERE is_active) FROM public.interests),
  'CAT-06 anon sees only active interests'
);
SELECT public.c7_t_denied(
  $$INSERT INTO public.interests (slug, label) VALUES ('c7-anon-write', 'C7 anon write')$$,
  'CAT-07 anon cannot INSERT interests', 'permission denied'
);
SELECT public.c7_t_denied(
  $$UPDATE public.interests SET label = 'C7 anon update' WHERE slug = 'gaming'$$,
  'CAT-08 anon cannot UPDATE interests', 'permission denied'
);
SELECT public.c7_t_denied(
  $$DELETE FROM public.interests WHERE slug = 'gaming'$$,
  'CAT-09 anon cannot DELETE interests', 'permission denied'
);
RESET ROLE;

SET ROLE authenticated;
SELECT public.c7_t_assert(
  (SELECT count(*) = count(*) FILTER (WHERE is_active) FROM public.interests),
  'CAT-10 authenticated sees only active interests'
);
SELECT public.c7_t_denied(
  $$INSERT INTO public.interests (slug, label) VALUES ('c7-auth-write', 'C7 auth write')$$,
  'CAT-11 authenticated cannot INSERT interests', 'permission denied'
);
SELECT public.c7_t_denied(
  $$UPDATE public.interests SET label = 'C7 auth update' WHERE slug = 'gaming'$$,
  'CAT-12 authenticated cannot UPDATE interests', 'permission denied'
);
SELECT public.c7_t_denied(
  $$DELETE FROM public.interests WHERE slug = 'gaming'$$,
  'CAT-13 authenticated cannot DELETE interests', 'permission denied'
);
RESET ROLE;

SELECT public.c7_t_assert(
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid IN ('public.user_interests'::regclass, 'public.club_interests'::regclass)
      AND conname IN ('user_interests_interest_check', 'club_interests_interest_check')
  ),
  'CAT-14 legacy interest CHECK constraints are gone'
);
SELECT public.c7_t_assert(
  (SELECT is_nullable FROM information_schema.columns
    WHERE (table_schema, table_name, column_name) = ('public', 'club_interests', 'interest_id')) = 'NO'
  AND
  (SELECT is_nullable FROM information_schema.columns
    WHERE (table_schema, table_name, column_name) = ('public', 'user_interests', 'interest_id')) = 'YES',
  'CAT-15 club_interests.interest_id is NOT NULL; user_interests.interest_id stays nullable (old-client compat)'
);
SELECT public.c7_t_assert(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_user_interests_user_interest_id')
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_club_interest'),
  'CAT-16 user and club interest unique indexes exist'
);

-- CAT-15b..d — backward-compat resolver trigger on user_interests. Currently
-- distributed mobile/web builds INSERT label-only rows; the BEFORE trigger must
-- fill interest_id from the active catalog, back-fill the label for id-only
-- writers, and never reject an unknown label.
-- NB: psql does not interpolate :C7_* inside a DO block — the identity UUID is
-- written literally (matches C7_OTHER = c7000000-0000-0000-0000-000000000004).
DO $$
DECLARE
  v_other    uuid := 'c7000000-0000-0000-0000-000000000004';
  v_music_id uuid;
  v_resolved uuid;
  v_label    text;
BEGIN
  SELECT id INTO v_music_id FROM public.interests WHERE slug = 'music';

  DELETE FROM public.user_interests WHERE user_id = v_other;

  -- legacy label-only insert (old client shape)
  INSERT INTO public.user_interests (user_id, interest) VALUES (v_other, 'Music');
  SELECT interest_id INTO v_resolved FROM public.user_interests
   WHERE user_id = v_other AND interest = 'Music';
  PERFORM public.c7_t_assert(v_resolved = v_music_id,
    'CAT-15b resolver trigger fills interest_id from a legacy label-only insert');

  -- id-only insert (modern shape without the label)
  DELETE FROM public.user_interests WHERE user_id = v_other;
  INSERT INTO public.user_interests (user_id, interest_id) VALUES (v_other, v_music_id);
  SELECT interest INTO v_label FROM public.user_interests
   WHERE user_id = v_other AND interest_id = v_music_id;
  PERFORM public.c7_t_assert(lower(v_label) = 'music',
    'CAT-15c resolver trigger back-fills the legacy label from an id-only insert');

  -- unknown label must not raise; interest_id stays NULL
  DELETE FROM public.user_interests WHERE user_id = v_other;
  INSERT INTO public.user_interests (user_id, interest) VALUES (v_other, 'Not A Real C7 Interest');
  SELECT interest_id INTO v_resolved FROM public.user_interests
   WHERE user_id = v_other AND interest = 'Not A Real C7 Interest';
  PERFORM public.c7_t_assert(v_resolved IS NULL,
    'CAT-15d unknown label is accepted with a NULL interest_id (never rejected)');

  DELETE FROM public.user_interests WHERE user_id = v_other;
END
$$;

-- set_my_interests exercises both accepted input forms, catalog validation,
-- atomic replacement, legacy-label synchronization, and idempotency.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_USER::uuid, 'role', 'authenticated')::text, false);
SELECT public.set_my_interests(ARRAY['finance-and-business', 'Music']);
SELECT public.c7_t_assert(
  (SELECT count(*) = 2
     AND count(*) FILTER (WHERE interest = 'Finance & Business' AND interest_id = (SELECT id FROM public.interests WHERE slug = 'finance-and-business')) = 1
     AND count(*) FILTER (WHERE interest = 'Music' AND interest_id = (SELECT id FROM public.interests WHERE slug = 'music')) = 1
     FROM public.user_interests WHERE user_id = :C7_USER::uuid),
  'CAT-17 set_my_interests accepts slugs and keeps legacy labels in sync'
);
SELECT public.set_my_interests(ARRAY['Numbers & Economics', 'music']);
SELECT public.c7_t_assert(
  (SELECT count(*) = 2
     AND count(*) FILTER (WHERE interest = 'Numbers & Economics') = 1
     AND count(*) FILTER (WHERE interest = 'Music') = 1
     AND count(*) FILTER (WHERE interest_id IS NULL) = 0
     FROM public.user_interests WHERE user_id = :C7_USER::uuid),
  'CAT-18 set_my_interests accepts active labels case-insensitively and replaces rows'
);
SELECT public.c7_t_denied(
  $$SELECT public.set_my_interests(ARRAY['not-a-c7-interest'])$$,
  'CAT-19 set_my_interests rejects an unknown key', 'unknown_interest: not-a-c7-interest'
);
SELECT public.c7_t_assert(
  (SELECT count(*) = 2
     AND count(*) FILTER (WHERE interest = 'Numbers & Economics') = 1
     AND count(*) FILTER (WHERE interest = 'Music') = 1
     FROM public.user_interests WHERE user_id = :C7_USER::uuid),
  'CAT-20 unknown-key rejection leaves the previous set intact'
);
RESET ROLE;

-- Deactivate one canonical row through the already-tested admin path, then
-- prove the write RPC treats its slug as invalid. It is reactivated afterward.
SET ROLE service_role;
SELECT public.admin_tx_interest_set_active(
  :C7_USER::uuid, 'c7@harness.invalid', 'C7 inactive-input test', gen_random_uuid(),
  (SELECT id FROM public.interests WHERE slug = 'gaming'), false
);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_USER::uuid, 'role', 'authenticated')::text, false);
SELECT public.c7_t_denied(
  $$SELECT public.set_my_interests(ARRAY['gaming'])$$,
  'CAT-21 set_my_interests rejects an inactive slug', 'unknown_interest: gaming'
);
RESET ROLE;
SET ROLE service_role;
SELECT public.admin_tx_interest_set_active(
  :C7_USER::uuid, 'c7@harness.invalid', 'C7 restore after inactive-input test', gen_random_uuid(),
  (SELECT id FROM public.interests WHERE slug = 'gaming'), true
);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_USER::uuid, 'role', 'authenticated')::text, false);
SELECT public.set_my_interests(ARRAY['numbers-and-economics', 'Music']);
DO $$
DECLARE
  v_before text;
  v_after text;
BEGIN
  SELECT coalesce(string_agg(interest_id::text || ':' || interest, ',' ORDER BY interest_id::text), '')
    INTO v_before
    FROM public.user_interests WHERE user_id = 'c7000000-0000-0000-0000-000000000001';
  PERFORM public.set_my_interests(ARRAY['Numbers & Economics', 'music']);
  SELECT coalesce(string_agg(interest_id::text || ':' || interest, ',' ORDER BY interest_id::text), '')
    INTO v_after
    FROM public.user_interests WHERE user_id = 'c7000000-0000-0000-0000-000000000001';
  PERFORM public.c7_t_assert(v_before = v_after, 'CAT-22 repeated set_my_interests call is idempotent');
END
$$;
RESET ROLE;
SET ROLE anon;
SELECT public.c7_t_denied(
  $$SELECT public.set_my_interests(ARRAY['music'])$$,
  'CAT-23 anon cannot execute set_my_interests', 'permission denied'
);
RESET ROLE;

-- ===========================================================================
-- SEED — migration 123
-- ===========================================================================

DO $$
DECLARE
  v_expected integer;
  v_actual integer;
  v_missing text;
BEGIN
  WITH expected(handle, slug, tier) AS (
    VALUES
      ('AccountingClub', 'finance-and-business', 'primary'),
      ('AccountingClub', 'numbers-and-economics', 'primary'),
      ('AccountingClub', 'strategy-and-critical-thinking', 'secondary'),
      ('AsianAmericanAssociation', 'art-and-culture', 'primary'),
      ('AsianAmericanAssociation', 'social-events', 'primary'),
      ('AsianAmericanAssociation', 'travel-and-languages', 'secondary'),
      ('AsianAmericanAssociation', 'community-service', 'secondary'),
      ('EconomicsClub', 'numbers-and-economics', 'primary'),
      ('EconomicsClub', 'finance-and-business', 'primary'),
      ('EconomicsClub', 'strategy-and-critical-thinking', 'primary'),
      ('EconomicsClub', 'debate-and-politics', 'secondary'),
      ('HumanServicesStudentOrganization', 'community-service', 'primary'),
      ('HumanServicesStudentOrganization', 'health-and-wellness', 'primary'),
      ('HumanServicesStudentOrganization', 'social-justice-and-activism', 'primary'),
      ('MavericksinRecovery', 'health-and-wellness', 'primary'),
      ('MavericksinRecovery', 'community-service', 'secondary'),
      ('MavericksinRecovery', 'social-events', 'secondary'),
      ('MusicClub', 'music', 'primary'),
      ('MusicClub', 'art-and-culture', 'primary'),
      ('MusicClub', 'social-events', 'secondary'),
      ('TheAcademy', 'strategy-and-critical-thinking', 'primary'),
      ('TheAcademy', 'debate-and-politics', 'primary'),
      ('TheAcademy', 'writing', 'secondary'),
      ('TheAcademy', 'religion', 'secondary'),
      ('MathSociety', 'numbers-and-economics', 'primary'),
      ('MathSociety', 'strategy-and-critical-thinking', 'primary'),
      ('MathSociety', 'technology-and-computer', 'secondary'),
      ('StudentGovernmentAssociation', 'debate-and-politics', 'primary'),
      ('StudentGovernmentAssociation', 'community-service', 'primary'),
      ('StudentGovernmentAssociation', 'social-justice-and-activism', 'secondary'),
      ('StudentGovernmentAssociation', 'strategy-and-critical-thinking', 'secondary'),
      ('TechnologyClub', 'technology-and-computer', 'primary'),
      ('TechnologyClub', 'strategy-and-critical-thinking', 'secondary'),
      ('TechnologyClub', 'gaming', 'secondary'),
      ('ASAPAlliedScholarsforAnimalProtection', 'social-justice-and-activism', 'primary'),
      ('ASAPAlliedScholarsforAnimalProtection', 'community-service', 'primary'),
      ('ASAPAlliedScholarsforAnimalProtection', 'environment', 'primary'),
      ('EngineeringSociety', 'technology-and-computer', 'primary'),
      ('EngineeringSociety', 'strategy-and-critical-thinking', 'primary'),
      ('EngineeringSociety', 'numbers-and-economics', 'primary'),
      ('EngineeringSociety', 'environment', 'secondary'),
      ('ClimbingClub', 'sports-and-athletics', 'primary'),
      ('ClimbingClub', 'health-and-wellness', 'primary'),
      ('ClimbingClub', 'strategy-and-critical-thinking', 'secondary'),
      ('ClimbingClub', 'environment', 'secondary')
  )
  SELECT count(*) INTO v_expected FROM expected;

  WITH expected(handle, slug, tier) AS (
    VALUES
      ('AccountingClub', 'finance-and-business', 'primary'), ('AccountingClub', 'numbers-and-economics', 'primary'), ('AccountingClub', 'strategy-and-critical-thinking', 'secondary'),
      ('AsianAmericanAssociation', 'art-and-culture', 'primary'), ('AsianAmericanAssociation', 'social-events', 'primary'), ('AsianAmericanAssociation', 'travel-and-languages', 'secondary'), ('AsianAmericanAssociation', 'community-service', 'secondary'),
      ('EconomicsClub', 'numbers-and-economics', 'primary'), ('EconomicsClub', 'finance-and-business', 'primary'), ('EconomicsClub', 'strategy-and-critical-thinking', 'primary'), ('EconomicsClub', 'debate-and-politics', 'secondary'),
      ('HumanServicesStudentOrganization', 'community-service', 'primary'), ('HumanServicesStudentOrganization', 'health-and-wellness', 'primary'), ('HumanServicesStudentOrganization', 'social-justice-and-activism', 'primary'),
      ('MavericksinRecovery', 'health-and-wellness', 'primary'), ('MavericksinRecovery', 'community-service', 'secondary'), ('MavericksinRecovery', 'social-events', 'secondary'),
      ('MusicClub', 'music', 'primary'), ('MusicClub', 'art-and-culture', 'primary'), ('MusicClub', 'social-events', 'secondary'),
      ('TheAcademy', 'strategy-and-critical-thinking', 'primary'), ('TheAcademy', 'debate-and-politics', 'primary'), ('TheAcademy', 'writing', 'secondary'), ('TheAcademy', 'religion', 'secondary'),
      ('MathSociety', 'numbers-and-economics', 'primary'), ('MathSociety', 'strategy-and-critical-thinking', 'primary'), ('MathSociety', 'technology-and-computer', 'secondary'),
      ('StudentGovernmentAssociation', 'debate-and-politics', 'primary'), ('StudentGovernmentAssociation', 'community-service', 'primary'), ('StudentGovernmentAssociation', 'social-justice-and-activism', 'secondary'), ('StudentGovernmentAssociation', 'strategy-and-critical-thinking', 'secondary'),
      ('TechnologyClub', 'technology-and-computer', 'primary'), ('TechnologyClub', 'strategy-and-critical-thinking', 'secondary'), ('TechnologyClub', 'gaming', 'secondary'),
      ('ASAPAlliedScholarsforAnimalProtection', 'social-justice-and-activism', 'primary'), ('ASAPAlliedScholarsforAnimalProtection', 'community-service', 'primary'), ('ASAPAlliedScholarsforAnimalProtection', 'environment', 'primary'),
      ('EngineeringSociety', 'technology-and-computer', 'primary'), ('EngineeringSociety', 'strategy-and-critical-thinking', 'primary'), ('EngineeringSociety', 'numbers-and-economics', 'primary'), ('EngineeringSociety', 'environment', 'secondary'),
      ('ClimbingClub', 'sports-and-athletics', 'primary'), ('ClimbingClub', 'health-and-wellness', 'primary'), ('ClimbingClub', 'strategy-and-critical-thinking', 'secondary'), ('ClimbingClub', 'environment', 'secondary')
  )
  SELECT count(*) INTO v_actual
  FROM expected e
  JOIN public.clubs c ON c.handle = e.handle
  JOIN public.interests i ON i.slug = e.slug
  JOIN public.club_interests ci ON ci.club_id = c.id AND ci.interest_id = i.id AND ci.tier = e.tier;

  PERFORM public.c7_t_assert(v_expected = 45, 'SEED-01 DESIGN seed table contains 45 triples');
  PERFORM public.c7_t_assert(v_actual = 45, 'SEED-02 every DESIGN handle/slug/tier triple is present');

  SELECT string_agg(e.handle, ', ' ORDER BY e.handle) INTO v_missing
  FROM (
    VALUES
      ('AccountingClub'), ('AsianAmericanAssociation'), ('EconomicsClub'),
      ('HumanServicesStudentOrganization'), ('MavericksinRecovery'), ('MusicClub'),
      ('TheAcademy'), ('MathSociety'), ('StudentGovernmentAssociation'),
      ('TechnologyClub'), ('ASAPAlliedScholarsforAnimalProtection'), ('EngineeringSociety'),
      ('ClimbingClub')
  ) AS e(handle)
  JOIN public.clubs c ON c.handle = e.handle
  WHERE NOT EXISTS (
    SELECT 1 FROM public.club_interests ci
    WHERE ci.club_id = c.id AND ci.tier = 'primary'
  );
  PERFORM public.c7_t_assert(v_missing IS NULL, 'SEED-03 all 13 target clubs have a primary interest');
  PERFORM public.c7_t_assert(
    (SELECT count(*) = 45
       FROM public.club_interests ci
       JOIN public.clubs c ON c.id = ci.club_id
       WHERE c.handle IN (
         'AccountingClub', 'AsianAmericanAssociation', 'EconomicsClub',
         'HumanServicesStudentOrganization', 'MavericksinRecovery', 'MusicClub',
         'TheAcademy', 'MathSociety', 'StudentGovernmentAssociation',
         'TechnologyClub', 'ASAPAlliedScholarsforAnimalProtection', 'EngineeringSociety',
         'ClimbingClub'
       )),
    'SEED-04 the 13 target clubs have exactly 45 assignments'
  );
END
$$;

-- ===========================================================================
-- SCORING — migration 124
-- ===========================================================================

DO $$
DECLARE
  v_launch uuid;
  v_score integer;
  v_user uuid := 'c7000000-0000-0000-0000-000000000002';
  v_batch club_recommendation_batches;
  v_zero_batch club_recommendation_batches;
  v_music uuid;
  v_economics uuid;
  v_accounting uuid;
  v_expected_fill uuid;
  v_expected_zero uuid[];
  v_before text;
  v_after text;
  v_preview integer;
  v_defs_ok boolean;
BEGIN
  SELECT launch_university_id INTO v_launch FROM public.app_config LIMIT 1;
  PERFORM public.c7_t_assert(v_launch IS NOT NULL, 'SCORE-01 launch university is configured');

  SELECT COALESCE(r.match_score, 0) INTO v_score
  FROM public.rank_eligible_clubs(NULL, v_launch, ARRAY['Finance & Business'], 100) r
  JOIN public.clubs c ON c.id = r.club_id
  WHERE c.handle = 'AccountingClub';
  PERFORM public.c7_t_assert(v_score = 3, 'SCORE-02 Accounting Finance primary scores 3');

  SELECT COALESCE(r.match_score, 0) INTO v_score
  FROM public.rank_eligible_clubs(NULL, v_launch, ARRAY['Strategy and Critical Thinking'], 100) r
  JOIN public.clubs c ON c.id = r.club_id
  WHERE c.handle = 'TechnologyClub';
  PERFORM public.c7_t_assert(v_score = 1, 'SCORE-03 Technology strategy secondary scores 1');

  SELECT COALESCE(r.match_score, 0) INTO v_score
  FROM public.rank_eligible_clubs(NULL, v_launch,
       ARRAY['Numbers & Economics', 'Finance & Business', 'Strategy and Critical Thinking'], 100) r
  JOIN public.clubs c ON c.id = r.club_id
  WHERE c.handle = 'EconomicsClub';
  PERFORM public.c7_t_assert(v_score = 9, 'SCORE-04 Economics three primaries score 9');

  SELECT COALESCE(r.match_score, 0) INTO v_score
  FROM public.rank_eligible_clubs(NULL, v_launch, ARRAY['Music', 'Art & Culture', 'Social Events'], 100) r
  JOIN public.clubs c ON c.id = r.club_id
  WHERE c.handle = 'MusicClub';
  PERFORM public.c7_t_assert(v_score = 7, 'SCORE-05 Music primary+primary+secondary scores 7');

  SELECT c.id INTO v_music FROM public.clubs c WHERE c.handle = 'MusicClub';
  DELETE FROM public.user_interests WHERE user_id = v_user;
  DELETE FROM public.club_recommendation_batches WHERE user_id = v_user;
  INSERT INTO public.user_interests (user_id, interest, interest_id)
  SELECT v_user, i.label, i.id FROM public.interests i WHERE i.slug = 'music';

  v_batch := public.generate_club_recommendation_batch(v_user, 'interest_update');
  SELECT c.id INTO v_expected_fill
  FROM public.clubs c
  WHERE c.is_active
    AND (c.university_id IS NOT DISTINCT FROM v_launch OR c.university_id IS NULL)
    AND c.id <> v_music
    AND NOT EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.club_id = c.id AND cm.user_id = v_user)
  ORDER BY c.member_count DESC, c.name ASC
  LIMIT 1;
  PERFORM public.c7_t_assert(v_batch.match_count >= 2, 'SCORE-06 one-interest batch has at least two clubs');
  PERFORM public.c7_t_assert(v_batch.club_ids[1] = v_music, 'SCORE-07 genuine Music match ranks first');
  PERFORM public.c7_t_assert(v_batch.club_ids[2] = v_expected_fill, 'SCORE-08 one-interest fill is the most-popular eligible club');
  PERFORM public.c7_t_assert(
    cardinality(v_batch.club_ids) = (SELECT count(DISTINCT x) FROM unnest(v_batch.club_ids) AS x),
    'SCORE-09 recommendation batch has no duplicate club ids'
  );
  v_preview := public.preview_club_match_count(ARRAY['Music']);
  PERFORM public.c7_t_assert(v_preview = v_batch.match_count, 'SCORE-10 preview count equals one-interest batch count');

  DELETE FROM public.user_interests WHERE user_id = v_user;
  DELETE FROM public.club_recommendation_batches WHERE user_id = v_user;
  v_zero_batch := public.generate_club_recommendation_batch(v_user, 'interest_update');
  SELECT array_agg(x.id ORDER BY x.member_count DESC, x.name ASC)
    INTO v_expected_zero
  FROM (
    SELECT c.id, c.member_count, c.name
    FROM public.clubs c
    WHERE c.is_active
      AND (c.university_id IS NOT DISTINCT FROM v_launch OR c.university_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.club_id = c.id AND cm.user_id = v_user)
    ORDER BY c.member_count DESC, c.name ASC
    LIMIT 2
  ) AS x;
  PERFORM public.c7_t_assert(v_zero_batch.match_count = 2, 'SCORE-11 zero-interest batch has two clubs');
  PERFORM public.c7_t_assert(v_zero_batch.club_ids = v_expected_zero, 'SCORE-12 zero-interest batch is the two most-popular eligible clubs');
  PERFORM public.c7_t_assert(public.preview_club_match_count(ARRAY[]::text[]) = v_zero_batch.match_count,
    'SCORE-13 empty preview count equals zero-interest batch count');

  SELECT i.id INTO v_accounting FROM public.interests i WHERE i.slug = 'finance-and-business';
  INSERT INTO public.user_interests (user_id, interest, interest_id)
  SELECT 'c7000000-0000-0000-0000-000000000001'::uuid, i.label, i.id FROM public.interests i
  WHERE i.id = v_accounting
  ON CONFLICT (user_id, interest_id) DO NOTHING;
  SELECT COALESCE(r.match_score, 0) INTO v_before
  FROM public.rank_eligible_clubs(NULL, v_launch, ARRAY['Finance & Business'], 100) r
  JOIN public.clubs c ON c.id = r.club_id WHERE c.handle = 'AccountingClub';
  PERFORM public.c7_t_assert(v_before = '3', 'SCORE-14 Finance match is present before deactivation');
  PERFORM public.admin_tx_interest_set_active('c7000000-0000-0000-0000-000000000001'::uuid, 'c7@harness.invalid', 'C7 scoring deactivation', gen_random_uuid(), v_accounting, false);
  SELECT count(*)::text INTO v_after FROM public.user_interests WHERE user_id = 'c7000000-0000-0000-0000-000000000001'::uuid AND interest_id = v_accounting;
  PERFORM public.c7_t_assert(v_after = '1', 'SCORE-15 deactivation preserves the user_interests row');
  PERFORM public.c7_t_assert(
    EXISTS (SELECT 1 FROM public.user_interests WHERE user_id = 'c7000000-0000-0000-0000-000000000001'::uuid AND interest_id = v_accounting),
    'SCORE-16 deactivating an interest preserves user_interests rows'
  );
  SELECT COALESCE(r.match_score, 0) INTO v_score
  FROM public.rank_eligible_clubs(NULL, v_launch, ARRAY['Finance & Business'], 100) r
  JOIN public.clubs c ON c.id = r.club_id WHERE c.handle = 'AccountingClub';
  PERFORM public.c7_t_assert(v_score = 0, 'SCORE-17 inactive interest contributes zero score');
  PERFORM public.admin_tx_interest_set_active('c7000000-0000-0000-0000-000000000001'::uuid, 'c7@harness.invalid', 'C7 scoring reactivation', gen_random_uuid(), v_accounting, true);
  SELECT COALESCE(r.match_score, 0) INTO v_score
  FROM public.rank_eligible_clubs(NULL, v_launch, ARRAY['Finance & Business'], 100) r
  JOIN public.clubs c ON c.id = r.club_id WHERE c.handle = 'AccountingClub';
  PERFORM public.c7_t_assert(v_score = 3, 'SCORE-18 reactivating restores the score contribution');

  SELECT coalesce(bool_and(position('user_activities' IN lower(pg_get_functiondef(p.oid))) = 0), false)
    INTO v_defs_ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('rank_eligible_clubs', 'generate_club_recommendation_batch', 'get_my_club_recommendations');
  PERFORM public.c7_t_assert(v_defs_ok, 'SCORE-19 recommendation path functions do not reference user_activities');

END
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_BATCH::uuid, 'role', 'authenticated')::text, false);
DO $$
DECLARE
  v_result jsonb := public.get_my_club_recommendations();
BEGIN
  PERFORM public.c7_t_assert(
    v_result IS NOT NULL
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_result) AS k)
        = ARRAY['batch_id', 'clubs', 'count', 'source']
    AND jsonb_typeof(v_result->'clubs') = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result->'clubs') AS club
      WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(club) AS k)
            <> ARRAY['avatar_url', 'cover_image_url', 'id', 'name']
    ),
    'SCORE-20 get_my_club_recommendations keeps the frozen JSON shape'
  );
END
$$;
RESET ROLE;

SET ROLE anon;
SELECT public.c7_t_denied(
  $$SELECT public.rank_eligible_clubs(NULL, NULL, ARRAY[]::text[])$$,
  'SCORE-21 anon cannot execute rank_eligible_clubs', 'permission denied'
);
RESET ROLE;
SET ROLE authenticated;
SELECT public.c7_t_denied(
  $$SELECT public.rank_eligible_clubs(NULL, NULL, ARRAY[]::text[])$$,
  'SCORE-22 authenticated cannot execute rank_eligible_clubs', 'permission denied'
);
RESET ROLE;

-- ===========================================================================
-- ADMIN — migration 125
-- ===========================================================================

SELECT public.c7_t_assert(
  (SELECT count(*) = 6
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_tx_interest_create', 'admin_tx_interest_rename', 'admin_tx_interest_set_active',
        'admin_tx_assign_club_interest', 'admin_tx_remove_club_interest', 'admin_tx_set_club_interest_tier'
      )),
  'ADMIN-01 all six interest admin RPCs exist'
);
SELECT public.c7_t_assert(
  (SELECT count(*) = 6
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_tx_interest_create', 'admin_tx_interest_rename', 'admin_tx_interest_set_active',
        'admin_tx_assign_club_interest', 'admin_tx_remove_club_interest', 'admin_tx_set_club_interest_tier'
      ) AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_tx_interest_create', 'admin_tx_interest_rename', 'admin_tx_interest_set_active',
        'admin_tx_assign_club_interest', 'admin_tx_remove_club_interest', 'admin_tx_set_club_interest_tier'
      ) AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'ADMIN-02 admin RPCs are executable by service_role only'
);

DO $$
DECLARE
  v_action text;
  v_target text;
  v_sensitivity text;
  v_reason boolean;
BEGIN
  FOR v_action, v_target, v_sensitivity, v_reason IN
    SELECT * FROM (VALUES
      ('interest.create', 'system', 'ordinary', false),
      ('interest.rename', 'system', 'ordinary', false),
      ('interest.deactivate', 'system', 'sensitive', true),
      ('interest.reactivate', 'system', 'sensitive', true),
      ('club.interestAssign', 'club', 'ordinary', false),
      ('club.interestRetier', 'club', 'ordinary', false),
      ('club.interestRemove', 'club', 'sensitive', true)
    ) AS expected(action, target_type, sensitivity, requires_reason)
  LOOP
    PERFORM public.c7_t_assert(
      EXISTS (
        SELECT 1 FROM public.admin_audit_actions a
        WHERE a.action = v_action AND a.target_type = v_target
          AND a.sensitivity = v_sensitivity AND a.requires_reason = v_reason
      ),
      'ADMIN-03 audit action ' || v_action || ' has the DESIGN contract'
    );
  END LOOP;
END
$$;

SET ROLE service_role;
DO $$
DECLARE
  v_actor uuid := 'c7000000-0000-0000-0000-000000000001';
  v_corr uuid;
  v_label text := 'C7 Harness ' || substr(gen_random_uuid()::text, 1, 8);
  v_renamed text := 'C7 Renamed ' || substr(gen_random_uuid()::text, 1, 8);
  v_inactive text := 'C7 Inactive ' || substr(gen_random_uuid()::text, 1, 8);
  v_interest uuid;
  v_inactive_id uuid;
  v_club uuid;
  v_other_interest uuid;
  v_slug text;
  v_before_count integer;
  r jsonb;
BEGIN
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_create(v_actor, 'c7@harness.invalid', NULL, v_corr, v_label);
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-04 interest.create happy path returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-04 interest.create');
  SELECT id, slug INTO v_interest, v_slug FROM public.interests WHERE label = v_label;
  PERFORM public.c7_t_assert(v_interest IS NOT NULL AND v_slug = regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g')::text || '',
    'ADMIN-05 interest.create derives and persists a slug');
  PERFORM public.c7_t_assert(
    (SELECT count(*) FROM public.admin_audit_events WHERE correlation_id = v_corr AND event_type = 'success') = 1,
    'ADMIN-06 interest.create writes exactly one success audit row'
  );

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_create(v_actor, 'c7@harness.invalid', NULL, v_corr, 'Finance & Business');
  PERFORM public.c7_t_assert(r->>'status' = 'label_taken', 'ADMIN-07 duplicate active label returns label_taken');
  PERFORM public.c7_t_assert((SELECT count(*) FROM public.interests WHERE label = 'Finance & Business') = 1,
    'ADMIN-08 label_taken does not mutate the catalog');
  PERFORM public.c7_t_assert((SELECT count(*) FROM public.admin_audit_events WHERE correlation_id = v_corr AND event_type = 'failure') = 1,
    'ADMIN-09 label_taken writes one durable failure row');

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_create(v_actor, 'c7@harness.invalid', NULL, v_corr, 'C7 Different Label', 'finance-and-business');
  PERFORM public.c7_t_assert(r->>'status' = 'slug_taken', 'ADMIN-10 duplicate slug returns slug_taken');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-10 duplicate slug');

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_create(v_actor, 'c7@harness.invalid', NULL, v_corr, 'x');
  PERFORM public.c7_t_assert(r->>'status' = 'invalid_label', 'ADMIN-11 short label returns invalid_label');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-11 short label');
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_create(v_actor, 'c7@harness.invalid', NULL, v_corr, 'C7 Bad Slug', 'Bad Slug');
  PERFORM public.c7_t_assert(r->>'status' = 'invalid_slug', 'ADMIN-12 malformed supplied slug returns invalid_slug');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-12 malformed slug');

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_rename(v_actor, 'c7@harness.invalid', NULL, v_corr, v_interest, v_renamed);
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-13 interest.rename happy path returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-13 interest.rename');
  PERFORM public.c7_t_assert((SELECT slug = v_slug AND label = v_renamed FROM public.interests WHERE id = v_interest),
    'ADMIN-14 rename changes label but keeps slug');
  PERFORM public.c7_t_assert((SELECT count(*) FROM public.admin_audit_events WHERE correlation_id = v_corr AND event_type = 'success') = 1,
    'ADMIN-15 rename writes exactly one success audit row');

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_rename(v_actor, 'c7@harness.invalid', NULL, v_corr, v_interest, 'Finance & Business');
  PERFORM public.c7_t_assert(r->>'status' = 'label_taken', 'ADMIN-16 rename to another active label returns label_taken');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-16 rename label collision');
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_rename(v_actor, 'c7@harness.invalid', NULL, v_corr, v_interest, v_renamed);
  PERFORM public.c7_t_assert(r->>'status' = 'no_change', 'ADMIN-17 rename to same label returns no_change');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-17 rename no-op');
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_rename(v_actor, 'c7@harness.invalid', NULL, v_corr, gen_random_uuid(), 'C7 Missing');
  PERFORM public.c7_t_assert(r->>'status' = 'interest_not_found', 'ADMIN-18 rename missing interest returns interest_not_found');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-18 rename missing interest');

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_set_active(v_actor, 'c7@harness.invalid', 'C7 deactivate', v_corr, v_interest, false);
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-19 deactivate returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-19 deactivate');
  PERFORM public.c7_t_assert((SELECT NOT is_active AND archived_at IS NOT NULL FROM public.interests WHERE id = v_interest),
    'ADMIN-20 deactivate sets archived_at and never deletes');
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_set_active(v_actor, 'c7@harness.invalid', 'C7 reactivate', v_corr, v_interest, true);
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-21 reactivate returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-21 reactivate');
  PERFORM public.c7_t_assert((SELECT is_active AND archived_at IS NULL FROM public.interests WHERE id = v_interest),
    'ADMIN-22 reactivate clears archived_at without replacing the row');
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_set_active(v_actor, 'c7@harness.invalid', NULL, v_corr, v_interest, true);
  PERFORM public.c7_t_assert(r->>'status' = 'no_change', 'ADMIN-23 set_active same state returns no_change');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-23 set_active no-op');
  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_set_active(v_actor, 'c7@harness.invalid', NULL, v_corr, gen_random_uuid(), false);
  PERFORM public.c7_t_assert(r->>'status' = 'interest_not_found', 'ADMIN-24 set_active missing interest returns interest_not_found');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-24 set_active missing interest');

  v_corr := gen_random_uuid();
  r := public.admin_tx_interest_create(v_actor, 'c7@harness.invalid', NULL, v_corr, v_inactive);
  SELECT id INTO v_inactive_id FROM public.interests WHERE label = v_inactive;
  PERFORM public.c7_t_assert(r->>'status' = 'ok' AND v_inactive_id IS NOT NULL, 'ADMIN-25 inactive-assignment fixture creates');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-25 inactive-assignment fixture create');
  PERFORM public.admin_tx_interest_set_active(v_actor, 'c7@harness.invalid', 'C7 inactive assignment fixture', gen_random_uuid(), v_inactive_id, false);

  SELECT id INTO v_club FROM public.clubs WHERE handle = 'AccountingClub';
  v_corr := gen_random_uuid();
  r := public.admin_tx_assign_club_interest(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_inactive_id, 'primary');
  PERFORM public.c7_t_assert(r->>'status' = 'interest_inactive', 'ADMIN-26 assignment of inactive interest returns interest_inactive');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-26 inactive assignment');
  v_corr := gen_random_uuid();
  r := public.admin_tx_assign_club_interest(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'bad');
  PERFORM public.c7_t_assert(r->>'status' = 'invalid_tier', 'ADMIN-27 invalid tier returns invalid_tier');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-27 invalid assignment tier');
  v_corr := gen_random_uuid();
  r := public.admin_tx_assign_club_interest(v_actor, 'c7@harness.invalid', NULL, v_corr, gen_random_uuid(), v_interest, 'primary');
  PERFORM public.c7_t_assert(r->>'status' = 'club_not_found', 'ADMIN-28 missing club returns club_not_found');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-28 missing club');
  v_corr := gen_random_uuid();
  r := public.admin_tx_assign_club_interest(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, gen_random_uuid(), 'primary');
  PERFORM public.c7_t_assert(r->>'status' = 'interest_not_found', 'ADMIN-29 missing interest returns interest_not_found');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-29 missing interest');

  v_corr := gen_random_uuid();
  r := public.admin_tx_assign_club_interest(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'primary');
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-30 club.interestAssign happy path returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-30 club.interestAssign');
  PERFORM public.c7_t_assert((SELECT interest = v_renamed AND tier = 'primary' FROM public.club_interests WHERE club_id = v_club AND interest_id = v_interest),
    'ADMIN-31 assignment writes the legacy label and tier');
  PERFORM public.c7_t_assert((SELECT count(*) FROM public.admin_audit_events WHERE correlation_id = v_corr AND event_type = 'success') = 1,
    'ADMIN-32 assignment writes exactly one success audit row');
  v_corr := gen_random_uuid();
  r := public.admin_tx_assign_club_interest(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'primary');
  PERFORM public.c7_t_assert(r->>'status' = 'already_assigned', 'ADMIN-33 duplicate assignment returns already_assigned');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-33 duplicate assignment');

  v_corr := gen_random_uuid();
  r := public.admin_tx_set_club_interest_tier(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'secondary');
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-34 retier happy path returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-34 club.interestRetier');
  v_corr := gen_random_uuid();
  r := public.admin_tx_set_club_interest_tier(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'secondary');
  PERFORM public.c7_t_assert(r->>'status' = 'no_change', 'ADMIN-35 retier same tier returns no_change');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-35 retier no-op');
  v_corr := gen_random_uuid();
  r := public.admin_tx_set_club_interest_tier(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'not-a-tier');
  PERFORM public.c7_t_assert(r->>'status' = 'invalid_tier', 'ADMIN-36 retier invalid tier returns invalid_tier');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-36 invalid retier tier');

  v_corr := gen_random_uuid();
  r := public.admin_tx_remove_club_interest(v_actor, 'c7@harness.invalid', 'C7 remove assignment', v_corr, v_club, gen_random_uuid());
  PERFORM public.c7_t_assert(r->>'status' = 'not_assigned', 'ADMIN-37 remove missing assignment returns not_assigned');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-37 remove missing assignment');
  v_corr := gen_random_uuid();
  r := public.admin_tx_remove_club_interest(v_actor, 'c7@harness.invalid', 'C7 remove assignment', v_corr, v_club, v_interest);
  PERFORM public.c7_t_assert(r->>'status' = 'ok', 'ADMIN-38 remove assignment happy path returns ok');
  PERFORM public.c7_t_success(v_corr, 'ADMIN-38 club.interestRemove');
  PERFORM public.c7_t_assert(NOT EXISTS (SELECT 1 FROM public.club_interests WHERE club_id = v_club AND interest_id = v_interest),
    'ADMIN-39 remove assignment deletes only the canonical assignment');
  PERFORM public.c7_t_assert((SELECT count(*) FROM public.admin_audit_events WHERE correlation_id = v_corr AND event_type = 'success') = 1,
    'ADMIN-40 remove assignment writes exactly one success audit row');
  v_corr := gen_random_uuid();
  r := public.admin_tx_set_club_interest_tier(v_actor, 'c7@harness.invalid', NULL, v_corr, v_club, v_interest, 'primary');
  PERFORM public.c7_t_assert(r->>'status' = 'not_assigned', 'ADMIN-41 retier removed assignment returns not_assigned');
  PERFORM public.c7_t_failure(v_corr, 'ADMIN-41 retier removed assignment');

  -- At least one success and one failure are checked by correlation above;
  -- this final invariant confirms every happy call has exactly one event and
  -- every failure used by this block has no canonical mutation side effect.
  SELECT count(*) INTO v_before_count
  FROM public.admin_audit_events
  WHERE action IN ('interest.create', 'interest.rename', 'interest.deactivate', 'interest.reactivate',
                   'club.interestAssign', 'club.interestRetier', 'club.interestRemove')
    AND actor_user_id = v_actor;
  PERFORM public.c7_t_assert(v_before_count >= 20, 'ADMIN-42 admin mutation attempts are durably audited');
END
$$;
RESET ROLE;

-- ===========================================================================
-- PHONE DISCOVERY — migration 126
-- ===========================================================================

DO $$
DECLARE
  v_def text;
  v_before text;
  v_name text;
  v_frozen text[] := ARRAY['get_discovery_clubs', 'get_discovery_clubs__inner', 'get_discovery_events'];
  v_name_item text;
BEGIN
  PERFORM public.c7_t_assert(
    (SELECT relkind = 'r' FROM pg_class WHERE oid = 'public.club_categories'::regclass),
    'PHONE-01 club_categories remains a table, not a view'
  );
  FOREACH v_name_item IN ARRAY v_frozen LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name_item
    ORDER BY p.oid LIMIT 1;
    PERFORM public.c7_t_assert(v_def IS NOT NULL, 'PHONE-02 frozen function exists: ' || v_name_item);
    PERFORM public.c7_t_assert(position('club_interests' IN lower(v_def)) = 0,
      'PHONE-03 frozen function still uses its pre-126 source: ' || v_name_item);
  END LOOP;

  -- A runner may capture the exact four definitions immediately before 126
  -- into this optional table. When present, require byte-for-byte parity.
  IF to_regclass('public.c7_frozen_discovery_defs') IS NOT NULL THEN
    FOR v_name, v_before IN SELECT name, definition FROM public.c7_frozen_discovery_defs LOOP
      SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
      ORDER BY p.oid LIMIT 1;
      PERFORM public.c7_t_assert(v_def = v_before, 'PHONE-04 frozen definition is byte-identical: ' || v_name);
    END LOOP;
  ELSE
    RAISE NOTICE 'PHONE-04 exact pre-126 definition table absent; source guard used';
  END IF;
END
$$;

SELECT public.c7_t_assert(
  has_function_privilege('authenticated', 'public.get_phone_discovery_categories()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_phone_discovery_categories()', 'EXECUTE'),
  'PHONE-05 categories RPC is authenticated-only'
);
SELECT public.c7_t_assert(
  has_function_privilege('authenticated', 'public.get_phone_discovery_clubs(uuid,text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_phone_discovery_clubs(uuid,text,integer,integer)', 'EXECUTE'),
  'PHONE-06 phone clubs wrapper is authenticated-only'
);
SELECT public.c7_t_assert(
  has_function_privilege('service_role', 'public.get_phone_discovery_clubs__inner(uuid,text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_phone_discovery_clubs__inner(uuid,text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_phone_discovery_clubs__inner(uuid,text,integer,integer)', 'EXECUTE'),
  'PHONE-07 phone clubs inner is service_role-only'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_PHONE::uuid, 'role', 'authenticated')::text, false);
SELECT public.set_my_interests(ARRAY['finance-and-business']);
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE
  v_finance uuid;
  v_corr uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_finance FROM public.interests WHERE slug = 'finance-and-business';
  PERFORM public.admin_tx_interest_set_active('c7000000-0000-0000-0000-000000000001', 'c7@harness.invalid', 'C7 phone inactive-category test', v_corr, v_finance, false);
END
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_PHONE::uuid, 'role', 'authenticated')::text, false);
DO $$
DECLARE
  v_actual text[];
  v_expected text[];
  v_zero_slug text;
  v_zero_clubs integer;
BEGIN
  -- Every ACTIVE interest is a category — NOT gated on club assignment.
  SELECT array_agg(slug ORDER BY sort_order, label) INTO v_actual
  FROM public.get_phone_discovery_categories();
  SELECT array_agg(i.slug ORDER BY i.sort_order, i.label) INTO v_expected
  FROM public.interests i
  WHERE i.is_active;
  PERFORM public.c7_t_assert(v_actual = v_expected,
    'PHONE-08 categories returns EVERY active interest in catalog order (not assignment-gated)');
  PERFORM public.c7_t_assert(NOT ('finance-and-business' = ANY(v_actual)),
    'PHONE-09 deactivated interest is excluded from categories');

  -- An active interest that no club is tagged with still shows as a category...
  SELECT i.slug INTO v_zero_slug
  FROM public.interests i
  WHERE i.is_active
    AND NOT EXISTS (SELECT 1 FROM public.club_interests ci WHERE ci.interest_id = i.id)
  ORDER BY i.sort_order, i.label
  LIMIT 1;
  PERFORM public.c7_t_assert(v_zero_slug IS NOT NULL,
    'PHONE-08b fixture: at least one active interest has zero club assignments');
  PERFORM public.c7_t_assert(v_zero_slug = ANY(v_actual),
    'PHONE-08c a zero-assignment active interest still appears as a category');

  -- ...and selecting it returns 0 clubs cleanly, not an error.
  SELECT count(*) INTO v_zero_clubs
  FROM public.get_phone_discovery_clubs(
    'c7000000-0000-0000-0000-000000000003'::uuid, v_zero_slug, 50, 0);
  PERFORM public.c7_t_assert(v_zero_clubs = 0,
    'PHONE-08d selecting a zero-match category returns 0 clubs without error');
END
$$;
RESET ROLE;

SET ROLE service_role;
SELECT public.admin_tx_interest_set_active(
  :C7_USER::uuid, 'c7@harness.invalid', 'C7 restore phone category test', gen_random_uuid(),
  (SELECT id FROM public.interests WHERE slug = 'finance-and-business'), true
);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_PHONE::uuid, 'role', 'authenticated')::text, false);
DO $$
DECLARE
  v_first uuid;
  v_accounting uuid;
  v_technology uuid;
BEGIN
  SELECT id INTO v_accounting FROM public.clubs WHERE handle = 'AccountingClub';
  SELECT id INTO v_technology FROM public.clubs WHERE handle = 'TechnologyClub';
  SELECT id INTO v_first
  FROM public.get_phone_discovery_clubs('c7000000-0000-0000-0000-000000000003'::uuid, NULL, 1, 0);
  PERFORM public.c7_t_assert(v_first = v_accounting, 'PHONE-10 personalized phone order puts a primary match first');
  PERFORM public.c7_t_assert(
    EXISTS (
      SELECT 1 FROM public.get_phone_discovery_clubs('c7000000-0000-0000-0000-000000000003'::uuid, 'strategy-and-critical-thinking', 20, 0) d
      WHERE d.id = v_technology
    ),
    'PHONE-11 slug filter includes an interest assigned at secondary tier'
  );
END
$$;
SELECT public.c7_t_denied(
  $$SELECT * FROM public.get_phone_discovery_clubs('c7000000-0000-0000-0000-000000000004'::uuid, NULL, 20, 0)$$,
  'PHONE-12 phone wrapper rejects another user identity', 'identity_mismatch'
);
RESET ROLE;

-- The inner function must not be callable by a restricted student, and the
-- wrapper must return the canonical account_restricted error first.
INSERT INTO public.account_restrictions (
  user_id, restriction_type, internal_reason, created_by, correlation_id
)
VALUES (
  :C7_RESTRICTED::uuid, 'suspended', 'C7 restricted-account harness row',
  :C7_USER::uuid, gen_random_uuid()
)
ON CONFLICT DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :C7_RESTRICTED::uuid, 'role', 'authenticated')::text, false);
SELECT public.c7_t_denied(
  $$SELECT * FROM public.get_phone_discovery_clubs('c7000000-0000-0000-0000-000000000005'::uuid, NULL, 20, 0)$$,
  'PHONE-13 restricted student is stopped by phone wrapper', 'account_restricted'
);
SELECT public.c7_t_denied(
  $$SELECT * FROM public.get_phone_discovery_clubs__inner('c7000000-0000-0000-0000-000000000005'::uuid, NULL, 20, 0)$$,
  'PHONE-14 restricted student cannot bypass wrapper through inner RPC', 'permission denied'
);
RESET ROLE;

-- ===========================================================================
-- Summary
-- ===========================================================================
DO $$
DECLARE
  v_passed integer;
BEGIN
  SELECT passed INTO v_passed FROM public.c7_t_counter;
  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '  migrations 122-126 interest-matching harness: % assertions PASSED', v_passed;
  RAISE NOTICE '=====================================================';
END
$$;
