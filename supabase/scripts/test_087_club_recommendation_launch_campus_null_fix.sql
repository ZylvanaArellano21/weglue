-- ===========================================================================
-- Harness for migration 087 (club recommendation pool excluded launch-campus
-- clubs with a NULL university_id — the bug behind "We found 1 club you'll
-- love" despite the campus having 5+ real clubs).
--
-- Run on a disposable postgres:17 container:
--   docker exec -u postgres <container> psql -v ON_ERROR_STOP=1 -U postgres \
--     -f test_087_fixture_schema.sql \
--     -f ../migrations/087_club_recommendation_launch_campus_null_fix.sql \
--     -f test_087_club_recommendation_launch_campus_null_fix.sql
--
-- BEGIN/ROLLBACK ASSERT-based tests (nonzero exit = fail):
--   A — NULL-university-id launch-campus clubs are eligible (the core fix):
--       reproduces the exact production shape (most clubs unbackfilled,
--       zero natural interest overlap) and proves rank_eligible_clubs()
--       now includes them instead of excluding all but the one backfilled
--       club.
--   B — cross-campus guard: a club that belongs to a genuinely different,
--       non-NULL, non-launch university is never eligible, even after the
--       fix. The fix does not cross campus/school eligibility to reach 2.
--   C — already-joined clubs are excluded even when university_id IS NULL —
--       the membership guard still applies to the newly-included rows.
--   D — full end-to-end pass through the real public RPC surface, called as
--       the actual authenticated role via RLS: generate_club_recommendation_
--       batch() + get_my_club_recommendations() return >=2 real clubs with
--       real ids/names, nothing fabricated.
--   E — never pads beyond the real eligible count: with exactly 1 real
--       eligible club campus-wide, match_count stays 1, not fabricated to 2.
--   F — preview_club_match_count() (the onboarding-activities preview) gets
--       the same NULL-university fix as the persisted-batch path.
-- ===========================================================================
\set ON_ERROR_STOP on

-- ============================================================
-- TEST A: NULL-university-id launch-campus clubs are eligible.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('a1000000-0000-4000-8000-00000000000a', 'harness_user_a');
  -- 6 launch-campus clubs never backfilled (university_id NULL), 1 backfilled
  -- — matches the production repro shape exactly.
  INSERT INTO public.clubs (id, name, is_active, member_count, university_id) VALUES
    ('c1000000-0000-4000-8000-000000000001', 'Backfilled Club', true, 5, 'a0870000-0000-4000-8000-000000000087'),
    ('c1000000-0000-4000-8000-000000000002', 'Unbackfilled Club 1', true, 3, NULL),
    ('c1000000-0000-4000-8000-000000000003', 'Unbackfilled Club 2', true, 2, NULL),
    ('c1000000-0000-4000-8000-000000000004', 'Unbackfilled Club 3', true, 1, NULL),
    ('c1000000-0000-4000-8000-000000000005', 'Unbackfilled Club 4', true, 0, NULL),
    ('c1000000-0000-4000-8000-000000000006', 'Unbackfilled Club 5', true, 0, NULL),
    ('c1000000-0000-4000-8000-000000000007', 'Unbackfilled Club 6', true, 0, NULL);
  -- Zero natural interest overlap — the user's only interest matches no club.
  INSERT INTO public.user_interests (user_id, interest) VALUES
    ('a1000000-0000-4000-8000-00000000000a', 'Gaming');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM rank_eligible_clubs(
      'a1000000-0000-4000-8000-00000000000a'::uuid,
      'a0870000-0000-4000-8000-000000000087'::uuid,
      ARRAY['Gaming']
    );
    ASSERT v_count = 7, 'TEST A FAILED: expected all 7 launch-campus clubs eligible (NULL university_id included), got ' || v_count;
    RAISE NOTICE 'TEST A PASSED: % launch-campus clubs eligible including NULL-university ones', v_count;
  END $$;
ROLLBACK;

-- ============================================================
-- TEST B: cross-campus guard — a genuinely different university's club
-- stays excluded even after the NULL-university fix.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('a2000000-0000-4000-8000-00000000000b', 'harness_user_b');
  INSERT INTO public.universities (id, name, slug) VALUES
    ('b0870000-0000-4000-8000-000000000087', 'Other University', 'other-university-087');
  INSERT INTO public.clubs (id, name, is_active, member_count, university_id) VALUES
    ('c2000000-0000-4000-8000-000000000001', 'Launch Club', true, 1, 'a0870000-0000-4000-8000-000000000087'),
    ('c2000000-0000-4000-8000-000000000002', 'Unbackfilled Launch Club', true, 1, NULL),
    ('c2000000-0000-4000-8000-000000000003', 'Other Campus Club', true, 99, 'b0870000-0000-4000-8000-000000000087');
  DO $$
  DECLARE v_leaked BOOLEAN;
  BEGIN
    SELECT bool_or(club_id = 'c2000000-0000-4000-8000-000000000003') INTO v_leaked
    FROM rank_eligible_clubs(
      'a2000000-0000-4000-8000-00000000000b'::uuid,
      'a0870000-0000-4000-8000-000000000087'::uuid,
      ARRAY[]::TEXT[]
    );
    ASSERT v_leaked IS NOT TRUE, 'TEST B FAILED: a genuinely different university''s club leaked into the eligible pool';
    RAISE NOTICE 'TEST B PASSED: other-campus club correctly excluded';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST C: already-joined clubs stay excluded even when university_id IS
-- NULL — the membership guard applies to the newly-included rows too.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('a3000000-0000-4000-8000-00000000000c', 'harness_user_c');
  INSERT INTO public.clubs (id, name, is_active, member_count, university_id) VALUES
    ('c3000000-0000-4000-8000-000000000001', 'Joined Unbackfilled Club', true, 1, NULL),
    ('c3000000-0000-4000-8000-000000000002', 'Unjoined Unbackfilled Club', true, 1, NULL);
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('c3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-00000000000c', 'member');
  DO $$
  DECLARE v_joined_present BOOLEAN;
  BEGIN
    SELECT bool_or(club_id = 'c3000000-0000-4000-8000-000000000001') INTO v_joined_present
    FROM rank_eligible_clubs(
      'a3000000-0000-4000-8000-00000000000c'::uuid,
      'a0870000-0000-4000-8000-000000000087'::uuid,
      ARRAY[]::TEXT[]
    );
    ASSERT v_joined_present IS NOT TRUE, 'TEST C FAILED: an already-joined NULL-university club appeared in the eligible pool';
    RAISE NOTICE 'TEST C PASSED: already-joined club excluded regardless of university_id';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST D: full end-to-end pass through the real public RPC surface, called
-- as the actual authenticated role via RLS. No fabrication.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university_id) VALUES
    ('a4000000-0000-4000-8000-00000000000d', 'harness_user_d', 'a0870000-0000-4000-8000-000000000087');
  INSERT INTO public.clubs (id, name, is_active, member_count, university_id) VALUES
    ('c4000000-0000-4000-8000-000000000001', 'Backfilled Club D', true, 5, 'a0870000-0000-4000-8000-000000000087'),
    ('c4000000-0000-4000-8000-000000000002', 'Unbackfilled Club D1', true, 3, NULL),
    ('c4000000-0000-4000-8000-000000000003', 'Unbackfilled Club D2', true, 2, NULL);
  SET LOCAL request.jwt.claim.sub = 'a4000000-0000-4000-8000-00000000000d';
  SET LOCAL ROLE authenticated;
  DO $$
  DECLARE
    v_batch RECORD;
    v_result JSONB;
    v_count INT;
    v_club JSONB;
  BEGIN
    v_batch := generate_club_recommendation_batch('a4000000-0000-4000-8000-00000000000d'::uuid, 'interest_update');
    ASSERT v_batch.match_count >= 2, 'TEST D FAILED: batch match_count must be >=2, got ' || v_batch.match_count;

    v_result := get_my_club_recommendations();
    ASSERT v_result IS NOT NULL, 'TEST D FAILED: get_my_club_recommendations returned NULL';
    v_count := (v_result->>'count')::INT;
    ASSERT v_count >= 2, 'TEST D FAILED: recommendation count must be >=2, got ' || v_count;

    -- Nothing fabricated: every returned club id is a real row in clubs.
    FOR v_club IN SELECT * FROM jsonb_array_elements(v_result->'clubs') LOOP
      ASSERT EXISTS (SELECT 1 FROM public.clubs WHERE id = (v_club->>'id')::uuid),
        'TEST D FAILED: returned club id ' || (v_club->>'id') || ' is not a real club row';
    END LOOP;

    RAISE NOTICE 'TEST D PASSED: end-to-end RPC returned % real clubs, count=%', jsonb_array_length(v_result->'clubs'), v_count;
  END $$;
ROLLBACK;

-- ============================================================
-- TEST E: never pads beyond the real eligible count — 1 real eligible club
-- campus-wide stays 1, not fabricated to 2.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('a5000000-0000-4000-8000-00000000000e', 'harness_user_e');
  -- Only ONE eligible club exists at all: one is inactive, one already joined.
  INSERT INTO public.clubs (id, name, is_active, member_count, university_id) VALUES
    ('c5000000-0000-4000-8000-000000000001', 'Only Eligible Club', true, 1, NULL),
    ('c5000000-0000-4000-8000-000000000002', 'Inactive Club', false, 1, NULL),
    ('c5000000-0000-4000-8000-000000000003', 'Already Joined Club', true, 1, NULL);
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('c5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-00000000000e', 'member');
  DO $$
  DECLARE v_target INT; v_eligible INT; v_natural INT;
  BEGIN
    SELECT count(*) FILTER (WHERE r.interest_overlap > 0), count(*)
      INTO v_natural, v_eligible
      FROM rank_eligible_clubs('a5000000-0000-4000-8000-00000000000e'::uuid, 'a0870000-0000-4000-8000-000000000087'::uuid, ARRAY[]::TEXT[]) r;
    v_target := club_match_target_count(v_natural, v_eligible);
    ASSERT v_eligible = 1, 'TEST E FAILED: expected exactly 1 real eligible club, got ' || v_eligible;
    ASSERT v_target = 1, 'TEST E FAILED: target must stay 1 (never fabricate to 2), got ' || v_target;
    RAISE NOTICE 'TEST E PASSED: target correctly capped at the real eligible count (1)';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST F: preview_club_match_count() gets the same NULL-university fix.
-- ============================================================
BEGIN;
  INSERT INTO public.clubs (id, name, is_active, member_count, university_id) VALUES
    ('c6000000-0000-4000-8000-000000000001', 'Backfilled Club F', true, 5, 'a0870000-0000-4000-8000-000000000087'),
    ('c6000000-0000-4000-8000-000000000002', 'Unbackfilled Club F1', true, 3, NULL),
    ('c6000000-0000-4000-8000-000000000003', 'Unbackfilled Club F2', true, 2, NULL);
  DO $$
  DECLARE v_preview INT;
  BEGIN
    v_preview := preview_club_match_count(ARRAY[]::TEXT[]);
    ASSERT v_preview >= 2, 'TEST F FAILED: preview_club_match_count must reach >=2 with 3 real eligible clubs (2 unbackfilled), got ' || v_preview;
    RAISE NOTICE 'TEST F PASSED: preview_club_match_count = %', v_preview;
  END $$;
ROLLBACK;
