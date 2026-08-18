-- Keep launch-campus clubs with a NULL university_id eligible for the
-- recommendation pool.
--
-- Migration 042 says clubs with a NULL university are launch-campus clubs too,
-- but rank_eligible_clubs() only matched rows whose university_id was exactly
-- the launch university. That excluded real launch-campus clubs that never got
-- their university_id backfilled, which could leave the recommendation batch
-- stuck at 0/1 even when the campus had enough eligible clubs.

CREATE OR REPLACE FUNCTION public.rank_eligible_clubs(
  p_user_id       UUID,
  p_university_id UUID,
  p_interests     TEXT[],
  p_limit         INT DEFAULT 12
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
    AND (
      c.university_id IS NOT DISTINCT FROM p_university_id
      OR c.university_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM club_members cm
      WHERE cm.club_id = c.id
        AND cm.user_id = p_user_id
    )
  ORDER BY
    interest_overlap DESC,
    c.member_count DESC,
    c.name ASC
  LIMIT GREATEST(p_limit, 2);
$$;

CREATE OR REPLACE FUNCTION public.generate_club_recommendation_batch(
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

  UPDATE club_recommendation_batches
  SET status = 'superseded', resolved_at = NOW()
  WHERE user_id = p_user_id AND status = 'active';

  INSERT INTO club_recommendation_batches (user_id, club_ids, match_count, source, status)
  VALUES (p_user_id, v_club_ids, COALESCE(ARRAY_LENGTH(v_club_ids, 1), 0), p_source, 'active')
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_club_match_count(p_interests TEXT[])
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
  SELECT launch_university_id INTO v_university_id FROM app_config LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE r.interest_overlap > 0),
    COUNT(*)
  INTO v_natural, v_eligible
  FROM rank_eligible_clubs(NULL, v_university_id, p_interests) r;

  RETURN club_match_target_count(v_natural, v_eligible);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_club_recommendations()
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

  SELECT COALESCE(ARRAY_AGG(x.id ORDER BY x.ord), ARRAY[]::UUID[])
  INTO   v_valid
  FROM (
    SELECT c.id, o.ord
    FROM UNNEST(v_batch.club_ids) WITH ORDINALITY AS o(id, ord)
    JOIN clubs c ON c.id = o.id
    WHERE c.is_active = true
      AND (
        c.university_id IS NOT DISTINCT FROM v_university_id
        OR c.university_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM club_members cm
        WHERE cm.club_id = c.id AND cm.user_id = v_user_id
      )
  ) x;

  v_final := v_valid;

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

