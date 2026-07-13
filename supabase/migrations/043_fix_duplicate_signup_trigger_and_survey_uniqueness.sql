-- ============================================================
-- We Glue – Fix duplicate signup trigger + survey uniqueness
-- Migration: 043_fix_duplicate_signup_trigger_and_survey_uniqueness.sql
--
-- Two defects, both caught by running a real signup end-to-end after 042:
--
-- 1. auth.users carried TWO triggers that each call handle_new_user():
--      • on_auth_user_created      (created in 007, replaced in 042)
--      • trg_on_auth_user_created  (an older duplicate, never dropped)
--    So every signup ran the handler TWICE: the survey rows were inserted
--    twice and a second recommendation batch was generated, immediately
--    superseding the first. Harmless-looking, but it doubled every new user's
--    interests and burned an extra batch. 042's DROP only knew one name.
--
-- 2. user_interests / user_activities had NO unique constraint on
--    (user_id, interest) / (user_id, activity) — only a PK on id. So the
--    `ON CONFLICT DO NOTHING` in handle_new_user matched nothing and happily
--    wrote duplicate rows. This also means the OLD onboarding screen's
--    `upsert(..., { onConflict: "user_id,interest" })` had been silently
--    broken against this schema all along.
--
-- Duplicate interests skew club matching (a doubled interest counts twice in
-- the overlap score), so this is a correctness fix, not just hygiene.
-- ============================================================

-- ------------------------------------------------------------
-- 1. One signup trigger, not two
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;

-- Recreate the canonical one idempotently so the end state is unambiguous:
-- exactly one AFTER INSERT trigger on auth.users calling handle_new_user().
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ------------------------------------------------------------
-- 2. De-duplicate existing survey rows, then enforce uniqueness
-- ------------------------------------------------------------

-- Keep the earliest row per (user_id, interest); drop the rest.
DELETE FROM user_interests a
USING user_interests b
WHERE a.user_id = b.user_id
  AND a.interest = b.interest
  AND a.id > b.id;

DELETE FROM user_activities a
USING user_activities b
WHERE a.user_id = b.user_id
  AND a.activity = b.activity
  AND a.id > b.id;

-- Now the constraint that makes ON CONFLICT DO NOTHING actually work — and
-- makes a duplicated interest impossible at the database level rather than by
-- convention.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_interests_user_interest
  ON user_interests(user_id, interest);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_activities_user_activity
  ON user_activities(user_id, activity);

-- ------------------------------------------------------------
-- 3. Retire recommendation batches that the double-trigger orphaned
-- ------------------------------------------------------------

-- Each affected signup produced an extra 'superseded' onboarding batch. The
-- unique partial index in 042 already guaranteed only one could be ACTIVE, so
-- no user ever saw a wrong batch — this is just cleanup of the dead rows.
DELETE FROM club_recommendation_batches
WHERE status = 'superseded'
  AND source = 'onboarding';
