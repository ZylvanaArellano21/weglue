-- ============================================================================
-- 109 — idempotent reconciliation of signup survey data (interests / activities)
--
-- (was 107 on staging; renumbered to 109 — production reached 107 via the
--  seed-club migration seed_asap_club. Ledger gaps are already present.)
--
-- Context: handle_new_user() (migration 099 on staging; the pre-099 version on production — the reconciliation is version-agnostic) inserts user_interests /
-- user_activities from the signup metadata INSIDE GoTrue's auth.users INSERT,
-- wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING` so a transient failure
-- can never block a signup. If that best-effort insert ever drops rows under
-- load, there is today no recovery path: the profile already has
-- onboarding_completed = true, so the app never re-prompts for interests.
--
-- The distributed 500-signup capacity run (2026-08-31) showed 0/501 real
-- metadata-bearing signups affected — every one had the exact expected
-- interests/activities. This migration is a durable safety net for the latent
-- risk, not a fix for an observed corruption.
--
-- It does NOT touch the signup transaction and does NOT change onboarding.
-- auth.users.raw_user_meta_data is the permanent source of truth for what the
-- student selected; reconciliation is a pure re-derivation from it.
--
-- Taxonomy lists are copied verbatim from handle_new_user() (099) — they are
-- the same lists the CHECK constraints on user_interests / user_activities
-- enforce, so the WHERE filter keeps every INSERT constraint-safe.
-- ============================================================================

BEGIN;

-- Single user: re-insert any interest/activity that is in the signup metadata,
-- valid in the taxonomy, and not already stored. Idempotent (ON CONFLICT DO
-- NOTHING); safe to call any number of times.
CREATE OR REPLACE FUNCTION public.reconcile_signup_survey(p_user_id uuid)
RETURNS TABLE (interests_added integer, activities_added integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_i integer := 0;
  v_a integer := 0;
BEGIN
  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = p_user_id;
  IF v_meta IS NULL THEN
    interests_added := 0; activities_added := 0; RETURN NEXT; RETURN;
  END IF;

  BEGIN
    WITH ins AS (
      INSERT INTO public.user_interests (user_id, interest)
      SELECT p_user_id, value
      FROM jsonb_array_elements_text(COALESCE(v_meta->'interests', '[]'::jsonb)) AS value
      WHERE value IN (
        'Finance & Business', 'Social Events', 'Music', 'Fashion',
        'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
        'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
        'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
        'Film & Media', 'Photography', 'Strategy and Critical Thinking',
        'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
      )
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_i FROM ins;

    WITH ins AS (
      INSERT INTO public.user_activities (user_id, activity)
      SELECT p_user_id, value
      FROM jsonb_array_elements_text(COALESCE(v_meta->'activities', '[]'::jsonb)) AS value
      WHERE value IN (
        'Projects', 'Volunteering', 'Workshops', 'Campus Fairs', 'Trips',
        'Study Groups', 'Networking', 'Tournaments', 'Social Events', 'Campus Tours'
      )
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_a FROM ins;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reconcile_signup_survey insert failed for %: %', p_user_id, SQLERRM;
  END;

  interests_added := v_i; activities_added := v_a; RETURN NEXT;
END;
$$;

-- Batch sweep for a cron job: any recent profile whose stored survey rows are
-- fewer than its signup metadata declares gets reconciled. O(recent signups),
-- runs off the signup path entirely.
CREATE OR REPLACE FUNCTION public.reconcile_recent_signup_surveys(
  p_since interval DEFAULT interval '48 hours',
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT u.id
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE u.created_at >= now() - p_since
      AND (
        (SELECT count(*) FROM public.user_interests ui WHERE ui.user_id = u.id)
          < jsonb_array_length(COALESCE(u.raw_user_meta_data->'interests', '[]'::jsonb))
        OR
        (SELECT count(*) FROM public.user_activities ua WHERE ua.user_id = u.id)
          < jsonb_array_length(COALESCE(u.raw_user_meta_data->'activities', '[]'::jsonb))
      )
    ORDER BY u.created_at DESC
    LIMIT p_limit
  LOOP
    PERFORM public.reconcile_signup_survey(r.id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Read-repair: a signed-in client may reconcile its OWN row (e.g. on first
-- Home load after onboarding). Thin wrapper so authenticated never touches the
-- batch/admin functions.
CREATE OR REPLACE FUNCTION public.reconcile_my_signup_survey()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.reconcile_signup_survey(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.reconcile_signup_survey(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_recent_signup_surveys(interval, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_my_signup_survey() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_my_signup_survey() TO authenticated;

COMMIT;

-- Operator: schedule the sweep (kept out of the migration so it does not
-- self-schedule; paste after apply):
--   SELECT cron.schedule('reconcile-signup-surveys', '*/10 * * * *',
--     $$SELECT public.reconcile_recent_signup_surveys()$$);
