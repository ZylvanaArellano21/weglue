-- ============================================================
-- We Glue – Single-campus launch mode + persistent club recommendations
-- Migration: 042_single_campus_and_club_recommendations.sql
--
-- Part A — SINGLE-CAMPUS LAUNCH MODE
--   We Glue launches at ONE campus (Lone Star College). Every verified .edu
--   signup joins that campus regardless of their real email domain, so no
--   student is blocked. This is TEMPORARY, and it is configured in exactly
--   ONE place: the app_config singleton (single_campus_mode +
--   launch_university_id). Nothing else may hardcode a university.
--
--   Before 042, profiles.university was a free-text column that NOTHING ever
--   wrote — every profile had university = NULL, while every club was tagged
--   'Lone Star College'. University-scoped features (chat invites, officer
--   search, club matching) were therefore comparing NULLs. This migration
--   introduces a canonical universities table with a real ID, backfills every
--   NULL profile onto the launch campus, and keeps the legacy TEXT columns in
--   sync from the canonical ID so existing code keeps working untouched.
--
--   To disable single-campus mode later:
--     UPDATE app_config SET single_campus_mode = false;
--   resolve_signup_university_id() then returns NULL instead of the launch
--   campus, and a real domain→university mapping must be supplied first (see
--   the note on that function). Existing users are NOT moved by flipping the
--   flag — their university_id is already materialized on the row on purpose.
--
-- Part B — CLUB RECOMMENDATION BATCHES
--   The match count shown on the account-creation screen must be the SAME
--   clubs the user later sees on Home → Events, across devices, reinstalls,
--   and a verify-on-another-device flow. So a batch is a server-side row, not
--   local state. Onboarding has no session (email confirmation is ON), so the
--   batch is materialized by the signup trigger from the user's own signup
--   metadata — never by an unauthenticated client write for an arbitrary user.
-- ============================================================

-- ============================================================
-- PART A.1 — Canonical universities
-- ============================================================

CREATE TABLE IF NOT EXISTS universities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  slug       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The launch campus. Name matches the free-text value already on clubs rows
-- so the backfill below can bind existing clubs to this canonical row.
INSERT INTO universities (name, slug)
VALUES ('Lone Star College', 'lone-star-college')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE universities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universities: read all" ON universities;
CREATE POLICY "universities: read all"
  ON universities FOR SELECT
  TO authenticated, anon
  USING (true);
-- No INSERT/UPDATE/DELETE policy: only the service role may change the
-- university list. Adding a second campus is a deliberate, reviewed operation.

-- ============================================================
-- PART A.2 — Centralized launch configuration (the ONLY switch)
-- ============================================================

CREATE TABLE IF NOT EXISTS app_config (
  id                   BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  single_campus_mode   BOOLEAN NOT NULL DEFAULT true,
  launch_university_id UUID REFERENCES universities(id),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (id, single_campus_mode, launch_university_id)
SELECT true, true, u.id FROM universities u WHERE u.slug = 'lone-star-college'
ON CONFLICT (id) DO UPDATE
  SET launch_university_id = EXCLUDED.launch_university_id
  WHERE app_config.launch_university_id IS NULL;

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config: read all" ON app_config;
CREATE POLICY "app_config: read all"
  ON app_config FOR SELECT
  TO authenticated, anon
  USING (true);
-- Deliberately no write policy — flipping single_campus_mode is a service-role
-- operation, never something a client can do.

-- ============================================================
-- PART A.3 — Canonical university on profiles + clubs
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS university_id UUID REFERENCES universities(id),
  -- The user's REAL normalized email domain, preserved separately so a future
  -- domain→university migration can place people on their actual campus. The
  -- launch campus assignment above deliberately ignores it for now.
  ADD COLUMN IF NOT EXISTS email_domain  TEXT,
  -- First-login "Personalize your picture!" prompt. Defaults to 'hidden' so
  -- every pre-existing account is backfilled as already-handled and nobody
  -- suddenly gets a new-user prompt. handle_new_user sets 'pending' for
  -- genuinely new accounts only.
  ADD COLUMN IF NOT EXISTS picture_prompt_status TEXT NOT NULL DEFAULT 'hidden'
    CHECK (picture_prompt_status IN ('pending', 'hidden'));

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS university_id UUID REFERENCES universities(id);

CREATE INDEX IF NOT EXISTS idx_profiles_university_id ON profiles(university_id);
CREATE INDEX IF NOT EXISTS idx_clubs_university_id    ON clubs(university_id);

-- Keep the legacy free-text university column derived from the canonical ID.
-- Existing university-scoped code (migration 040's chat invite RPCs,
-- clubService officer search) compares profiles.university to clubs.university
-- as TEXT. Rather than rewrite all of it, the TEXT column becomes a mirror of
-- the canonical row — so there is exactly one source of truth (university_id)
-- and no screen, hook, service, or RPC hardcodes a campus name.
CREATE OR REPLACE FUNCTION sync_university_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.university_id IS NOT NULL THEN
    SELECT u.name INTO NEW.university FROM universities u WHERE u.id = NEW.university_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_university_name ON profiles;
CREATE TRIGGER trg_profiles_university_name
  BEFORE INSERT OR UPDATE OF university_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_university_name();

DROP TRIGGER IF EXISTS trg_clubs_university_name ON clubs;
CREATE TRIGGER trg_clubs_university_name
  BEFORE INSERT OR UPDATE OF university_id ON clubs
  FOR EACH ROW EXECUTE FUNCTION sync_university_name();

-- ============================================================
-- PART A.4 — Backfill (idempotent)
-- ============================================================

-- Clubs: bind existing free-text 'Lone Star College' rows to the canonical row.
-- Clubs with a NULL university are launch-campus clubs too (single-campus).
UPDATE clubs c
SET university_id = u.id
FROM universities u
WHERE c.university_id IS NULL
  AND u.slug = 'lone-star-college'
  AND (c.university = u.name OR c.university IS NULL);

-- Profiles: every existing user with NO university joins the launch campus.
-- This is the backfill that repairs the NULL-university population.
UPDATE profiles p
SET university_id = cfg.launch_university_id
FROM app_config cfg
WHERE p.university_id IS NULL
  AND cfg.launch_university_id IS NOT NULL;

-- Old onboarding gates are gone: nobody may be trapped out of Home because
-- they never uploaded a picture or never opened the old club catalog.
UPDATE profiles SET onboarding_completed = true WHERE onboarding_completed = false;

-- ============================================================
-- PART A.5 — Server-side university resolution
-- ============================================================

-- The ONE function that decides which campus a new signup joins.
-- Never trusts client input: it takes no university argument.
--
-- While single_campus_mode is true  → always the launch campus.
-- When it is flipped to false       → returns NULL, and a real
--   domain→university mapping must be added here (deliberately NOT built in
--   this task). Returning NULL rather than guessing means a second-campus
--   launch cannot silently misfile students.
CREATE OR REPLACE FUNCTION resolve_signup_university_id(p_email TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_single_campus BOOLEAN;
  v_launch_id     UUID;
BEGIN
  SELECT single_campus_mode, launch_university_id
  INTO   v_single_campus, v_launch_id
  FROM   app_config
  LIMIT  1;

  IF COALESCE(v_single_campus, false) THEN
    RETURN v_launch_id;
  END IF;

  -- Multi-campus era: resolve p_email's domain against a university_domains
  -- mapping table here. Until that exists, refuse to guess.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION resolve_signup_university_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_signup_university_id(TEXT) TO authenticated, service_role;

-- ============================================================
-- PART B.1 — Recommendation batches
-- ============================================================

CREATE TABLE IF NOT EXISTS club_recommendation_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Ordered, ranked club IDs. Order is the display order on Home → Events.
  club_ids     UUID[] NOT NULL,
  match_count  INT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('onboarding', 'interest_update')),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'dismissed', 'completed', 'superseded')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_club_rec_batches_user ON club_recommendation_batches(user_id);

-- At most ONE active batch per user. This is what makes repeated Save taps,
-- concurrent joins, and racing dismisses safe: a duplicate active batch is
-- rejected by the database, not merely avoided by client code.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_rec_batch_per_user
  ON club_recommendation_batches(user_id)
  WHERE status = 'active';

ALTER TABLE club_recommendation_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "club_rec_batches: read own" ON club_recommendation_batches;
CREATE POLICY "club_rec_batches: read own"
  ON club_recommendation_batches FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No client INSERT/UPDATE/DELETE policies. Batches are created and resolved
-- exclusively through the SECURITY DEFINER RPCs below, so a user can never
-- forge a batch, write one for someone else, or resurrect a dismissed one.

-- ============================================================
-- PART B.2 — Ranking
-- ============================================================

-- Ordered eligible clubs for a user, best match first.
--
-- Ranking (per spec, adapted to the data that actually exists):
--   1. Clubs matching the user's selected INTERESTS, most overlap first.
--      Clubs carry interest tags (club_interests) but have NO activity tags —
--      there is no club_activities table and event_activities is empty — so we
--      rank on interests and never fabricate activity data.
--   2. Relevant/popular ACTIVE clubs as fallback (member_count).
--   3. Membership size only as the final tie-breaker.
--
-- Always excluded: clubs the user already joined, inactive clubs, clubs from
-- another university. Deleted clubs simply don't exist as rows. DISTINCT club
-- IDs only — a club can never appear twice.
CREATE OR REPLACE FUNCTION rank_eligible_clubs(
  p_user_id      UUID,
  p_university_id UUID,
  p_interests    TEXT[],
  p_limit        INT DEFAULT 12
)
RETURNS TABLE (club_id UUID, interest_overlap INT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    (
      SELECT COUNT(*)::INT
      FROM club_interests ci
      WHERE ci.club_id = c.id
        AND ci.interest = ANY(COALESCE(p_interests, ARRAY[]::TEXT[]))
    ) AS interest_overlap
  FROM clubs c
  WHERE c.is_active = true
    AND c.university_id IS NOT DISTINCT FROM p_university_id
    AND NOT EXISTS (
      SELECT 1 FROM club_members cm
      WHERE cm.club_id = c.id
        AND cm.user_id = p_user_id
    )
  ORDER BY
    interest_overlap DESC,   -- natural matches first, strongest overlap first
    c.member_count DESC,     -- then popular active clubs (fallback + tie-break)
    c.name ASC               -- stable, deterministic ordering
  LIMIT GREATEST(p_limit, 2);
$$;

-- How many clubs a batch should contain: every natural (interest) match, but
-- never fewer than 2 — topped up with the best-ranked fallback clubs — and
-- never more than the eligible pool. Returning 0 or 1 is only possible when
-- the campus genuinely has fewer than 2 eligible clubs.
CREATE OR REPLACE FUNCTION club_match_target_count(
  p_natural INT,
  p_eligible INT
)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(GREATEST(p_natural, 2), p_eligible);
$$;

-- ============================================================
-- PART B.3 — Batch generation
-- ============================================================

CREATE OR REPLACE FUNCTION generate_club_recommendation_batch(
  p_user_id UUID,
  p_source  TEXT
)
RETURNS club_recommendation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id UUID;
  v_interests     TEXT[];
  v_natural       INT;
  v_eligible      INT;
  v_target        INT;
  v_club_ids      UUID[];
  v_batch         club_recommendation_batches;
BEGIN
  -- Serialize per user: repeated Save taps / concurrent calls can never
  -- produce two active batches (the unique index is the backstop).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  SELECT university_id INTO v_university_id FROM profiles WHERE id = p_user_id;

  SELECT COALESCE(ARRAY_AGG(ui.interest), ARRAY[]::TEXT[])
  INTO   v_interests
  FROM   user_interests ui
  WHERE  ui.user_id = p_user_id;

  SELECT
    COUNT(*) FILTER (WHERE r.interest_overlap > 0),
    COUNT(*)
  INTO v_natural, v_eligible
  FROM rank_eligible_clubs(p_user_id, v_university_id, v_interests) r;

  v_target := club_match_target_count(v_natural, v_eligible);

  IF v_target < 1 THEN
    -- No eligible clubs at all on this campus. Supersede any active batch and
    -- write nothing: the app shows a safe generic path into Club Discovery
    -- rather than an untruthful "0 clubs".
    UPDATE club_recommendation_batches
    SET status = 'superseded', resolved_at = NOW()
    WHERE user_id = p_user_id AND status = 'active';
    RETURN NULL;
  END IF;

  SELECT ARRAY_AGG(t.club_id ORDER BY t.ord)
  INTO   v_club_ids
  FROM   (
    SELECT r.club_id, ROW_NUMBER() OVER () AS ord
    FROM   rank_eligible_clubs(p_user_id, v_university_id, v_interests) r
    LIMIT  v_target
  ) t;

  -- A new survey supersedes the previous batch (dismissed, completed, or
  -- still active) so saving interests always brings the section back.
  UPDATE club_recommendation_batches
  SET status = 'superseded', resolved_at = NOW()
  WHERE user_id = p_user_id AND status = 'active';

  INSERT INTO club_recommendation_batches (user_id, club_ids, match_count, source, status)
  VALUES (p_user_id, v_club_ids, COALESCE(ARRAY_LENGTH(v_club_ids, 1), 0), p_source, 'active')
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

-- Authenticated entry point: regenerate for MYSELF only. auth.uid() is the
-- only identity used — a client cannot pass someone else's user_id.
CREATE OR REPLACE FUNCTION regenerate_my_club_recommendations()
RETURNS club_recommendation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch club_recommendation_batches;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT * INTO v_batch FROM generate_club_recommendation_batch(auth.uid(), 'interest_update');
  RETURN v_batch;
END;
$$;

REVOKE ALL ON FUNCTION generate_club_recommendation_batch(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION regenerate_my_club_recommendations() TO authenticated;

-- ============================================================
-- PART B.4 — Pre-signup match count (no session exists yet)
-- ============================================================

-- The account-creation screen must show a REAL count before the account
-- exists. This is read-only: it writes nothing, takes no user ID, and cannot
-- be used to create or modify a batch for anybody. The trigger below is what
-- persists the real batch, using the same ranking, so the number the user saw
-- is the number they get.
CREATE OR REPLACE FUNCTION preview_club_match_count(p_interests TEXT[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_university_id UUID;
  v_natural       INT;
  v_eligible      INT;
BEGIN
  -- Prospective users get the launch campus — the same campus they will be
  -- assigned at signup by resolve_signup_university_id().
  SELECT launch_university_id INTO v_university_id FROM app_config LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE r.interest_overlap > 0),
    COUNT(*)
  INTO v_natural, v_eligible
  FROM rank_eligible_clubs(NULL, v_university_id, p_interests) r;

  RETURN club_match_target_count(v_natural, v_eligible);
END;
$$;

GRANT EXECUTE ON FUNCTION preview_club_match_count(TEXT[]) TO anon, authenticated;

-- ============================================================
-- PART B.5 — Reading the active batch (self-healing)
-- ============================================================

-- Returns the active batch with its clubs resolved. If a stored club was
-- deleted / deactivated / already joined since the batch was created, it is
-- dropped and replaced by the next valid ranked club so the original count is
-- preserved whenever enough eligible clubs still exist.
CREATE OR REPLACE FUNCTION get_my_club_recommendations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_batch         club_recommendation_batches;
  v_university_id UUID;
  v_interests     TEXT[];
  v_valid         UUID[];
  v_final         UUID[];
  v_clubs         JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_batch
  FROM club_recommendation_batches
  WHERE user_id = v_user_id AND status = 'active'
  LIMIT 1;

  IF v_batch.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT university_id INTO v_university_id FROM profiles WHERE id = v_user_id;

  -- Keep only stored clubs that are still valid, preserving batch order.
  SELECT COALESCE(ARRAY_AGG(x.id ORDER BY x.ord), ARRAY[]::UUID[])
  INTO   v_valid
  FROM (
    SELECT c.id, o.ord
    FROM UNNEST(v_batch.club_ids) WITH ORDINALITY AS o(id, ord)
    JOIN clubs c ON c.id = o.id
    WHERE c.is_active = true
      AND c.university_id IS NOT DISTINCT FROM v_university_id
      AND NOT EXISTS (
        SELECT 1 FROM club_members cm
        WHERE cm.club_id = c.id AND cm.user_id = v_user_id
      )
  ) x;

  v_final := v_valid;

  -- Top up to the original count from the ranked fallback pool.
  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) < v_batch.match_count THEN
    SELECT COALESCE(ARRAY_AGG(ui.interest), ARRAY[]::TEXT[])
    INTO   v_interests
    FROM   user_interests ui
    WHERE  ui.user_id = v_user_id;

    SELECT v_final || COALESCE(ARRAY_AGG(t.club_id ORDER BY t.ord), ARRAY[]::UUID[])
    INTO   v_final
    FROM (
      SELECT r.club_id, ROW_NUMBER() OVER () AS ord
      FROM   rank_eligible_clubs(v_user_id, v_university_id, v_interests) r
      WHERE  NOT (r.club_id = ANY(v_final))
      LIMIT  GREATEST(v_batch.match_count - COALESCE(ARRAY_LENGTH(v_final, 1), 0), 0)
    ) t;
  END IF;

  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'id',         c.id,
             'name',       c.name,
             'avatar_url', c.avatar_url,
             'cover_image_url', c.cover_image_url
           ) ORDER BY o.ord
         )
  INTO   v_clubs
  FROM   UNNEST(v_final) WITH ORDINALITY AS o(id, ord)
  JOIN   clubs c ON c.id = o.id;

  RETURN JSONB_BUILD_OBJECT(
    'batch_id', v_batch.id,
    'count',    COALESCE(JSONB_ARRAY_LENGTH(v_clubs), 0),
    'source',   v_batch.source,
    'clubs',    v_clubs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_club_recommendations() TO authenticated;

-- ============================================================
-- PART B.6 — Dismiss (idempotent)
-- ============================================================

CREATE OR REPLACE FUNCTION dismiss_club_recommendation_batch(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Scoped to the caller's own active batch. Dismissing an already-resolved
  -- batch (double tap, retry, another device) is a no-op that still succeeds.
  UPDATE club_recommendation_batches
  SET status = 'dismissed', resolved_at = NOW()
  WHERE id = p_batch_id
    AND user_id = auth.uid()
    AND status = 'active';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION dismiss_club_recommendation_batch(UUID) TO authenticated;

-- ============================================================
-- PART B.7 — Joining a matched club completes the whole batch
-- ============================================================

-- A DB trigger (not client code) so the batch completes no matter WHERE the
-- join happened — matched card, Club Profile, Discovery, an invite, another
-- device. Joining a club that is NOT in the active batch leaves it alone.
CREATE OR REPLACE FUNCTION complete_recommendation_batch_on_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE club_recommendation_batches
    SET status = 'completed', resolved_at = NOW()
    WHERE user_id = NEW.user_id
      AND status = 'active'
      AND NEW.club_id = ANY(club_ids);
  EXCEPTION WHEN OTHERS THEN
    -- Never block a join because of recommendation bookkeeping.
    RAISE WARNING 'complete_recommendation_batch_on_join failed for %: %', NEW.user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_members_complete_recommendations ON club_members;
CREATE TRIGGER trg_club_members_complete_recommendations
  AFTER INSERT ON club_members
  FOR EACH ROW EXECUTE FUNCTION complete_recommendation_batch_on_join();

-- ============================================================
-- PART B.8 — First-login profile-picture prompt
-- ============================================================

CREATE OR REPLACE FUNCTION dismiss_picture_prompt()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE profiles SET picture_prompt_status = 'hidden' WHERE id = auth.uid();
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION dismiss_picture_prompt() TO authenticated;

-- ============================================================
-- PART C — Signup trigger: campus + survey + batch, server-side
-- ============================================================

-- Email confirmation is ON, so there is NO session during onboarding. The
-- interests/activities the user picked before creating the account travel in
-- their OWN signup metadata and are materialized here, server-side, at the
-- moment the auth user is created. That is what makes the count on the
-- account-creation screen survive: verifying on another device, logging in on
-- Android after signing up on iPhone, closing the app before verification, and
-- reinstalling.
--
-- CRITICAL: never RAISE inside an auth.users trigger — GoTrue masks it as an
-- opaque 500 and every signup breaks. Every block below is exception-guarded.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id UUID;
  v_email_domain  TEXT;
  v_interests     TEXT[];
  v_activities    TEXT[];
BEGIN
  BEGIN
    v_university_id := resolve_signup_university_id(NEW.email);
    v_email_domain  := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, onboarding_completed
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      v_university_id,
      v_email_domain,
      -- Genuinely new account with no picture yet → show the Home prompt once.
      'pending',
      -- There is no mandatory onboarding any more.
      true
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- Survey answers chosen before the account existed.
  BEGIN
    SELECT COALESCE(ARRAY_AGG(value::TEXT), ARRAY[]::TEXT[])
    INTO   v_interests
    FROM   JSONB_ARRAY_ELEMENTS_TEXT(
             COALESCE(NEW.raw_user_meta_data->'interests', '[]'::JSONB)
           ) AS value;

    SELECT COALESCE(ARRAY_AGG(value::TEXT), ARRAY[]::TEXT[])
    INTO   v_activities
    FROM   JSONB_ARRAY_ELEMENTS_TEXT(
             COALESCE(NEW.raw_user_meta_data->'activities', '[]'::JSONB)
           ) AS value;

    -- Insert only values the CHECK constraints accept. A junk value from a
    -- tampered client is dropped instead of raising (which would 500 signup).
    INSERT INTO public.user_interests (user_id, interest)
    SELECT NEW.id, i
    FROM   UNNEST(v_interests) AS i
    WHERE  i IN (
      'Finance & Business', 'Social Events', 'Music', 'Fashion',
      'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
      'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
      'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
      'Film & Media', 'Photography', 'Strategy and Critical Thinking',
      'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_activities (user_id, activity)
    SELECT NEW.id, a
    FROM   UNNEST(v_activities) AS a
    WHERE  a IN (
      'Projects', 'Volunteering', 'Workshops', 'Campus Fairs',
      'Trips', 'Study Groups', 'Networking', 'Tournaments',
      'Social Events', 'Campus Tours'
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: survey insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- The recommendation batch the user will see on Home after verifying.
  BEGIN
    PERFORM generate_club_recommendation_batch(NEW.id, 'onboarding');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: batch generation failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- PART D — ensure_profile repair path keeps campus + prompt consistent
-- ============================================================

-- 027 added ensure_profile() to repair a missing profile row. It must not
-- recreate a profile without a campus, or the user would silently see no clubs.
CREATE OR REPLACE FUNCTION ensure_profile()
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_email    TEXT;
  v_meta     JSONB;
  v_profile  profiles;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT email, raw_user_meta_data INTO v_email, v_meta
  FROM auth.users WHERE id = v_user_id;

  INSERT INTO profiles (
    id, username, full_name, university_id, email_domain,
    picture_prompt_status, onboarding_completed
  )
  VALUES (
    v_user_id,
    COALESCE(v_meta->>'username', 'user_' || LEFT(v_user_id::TEXT, 8)) || '_' || LEFT(gen_random_uuid()::TEXT, 4),
    COALESCE(v_meta->>'full_name', ''),
    resolve_signup_university_id(v_email),
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- Existing row missing a campus (pre-042 account) — heal it.
  UPDATE profiles
  SET university_id = resolve_signup_university_id(v_email)
  WHERE id = v_user_id AND university_id IS NULL;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_profile() TO authenticated;
