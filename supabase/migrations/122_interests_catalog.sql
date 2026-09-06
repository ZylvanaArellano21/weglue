-- 122 — Interest catalog and ID-backed survey storage.
-- Adds the stable catalog, preserves existing survey history by backfilling IDs,
-- and moves client interest replacement behind a validated RPC.
-- Applies on prod ledger @ 121; see docs/interest-matching/.

CREATE TABLE IF NOT EXISTS public.interests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  label       text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_interests_label_active
  ON public.interests (lower(label))
  WHERE is_active;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.interests'::regclass
      AND tgname = 'trg_interests_updated_at'
  ) THEN
    CREATE TRIGGER trg_interests_updated_at
      BEFORE UPDATE ON public.interests
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

INSERT INTO public.interests (slug, label, sort_order)
VALUES
  ('finance-and-business', 'Finance & Business', 0),
  ('social-events', 'Social Events', 1),
  ('music', 'Music', 2),
  ('fashion', 'Fashion', 3),
  ('art-and-culture', 'Art & Culture', 4),
  ('social-justice-and-activism', 'Social Justice & Activism', 5),
  ('numbers-and-economics', 'Numbers & Economics', 6),
  ('gaming', 'Gaming', 7),
  ('health-and-wellness', 'Health & Wellness', 8),
  ('environment', 'Environment', 9),
  ('sports-and-athletics', 'Sports & Athletics', 10),
  ('community-service', 'Community Service', 11),
  ('crafts', 'Crafts', 12),
  ('religion', 'Religion', 13),
  ('technology-and-computer', 'Technology and Computer', 14),
  ('film-and-media', 'Film & Media', 15),
  ('photography', 'Photography', 16),
  ('strategy-and-critical-thinking', 'Strategy and Critical Thinking', 17),
  ('writing', 'Writing', 18),
  ('theater', 'Theater', 19),
  ('travel-and-languages', 'Travel & Languages', 20),
  ('debate-and-politics', 'Debate & Politics', 21)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'interests'
      AND policyname = 'interests: active public read'
  ) THEN
    CREATE POLICY "interests: active public read"
      ON public.interests FOR SELECT
      TO anon, authenticated
      USING (is_active = true);
  END IF;
END
$$;

GRANT SELECT ON public.interests TO anon, authenticated;
GRANT SELECT ON public.interests TO service_role;

ALTER TABLE public.club_interests
  ADD COLUMN IF NOT EXISTS interest_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.club_interests'::regclass
      AND conname = 'club_interests_interest_id_fkey'
  ) THEN
    ALTER TABLE public.club_interests
      ADD CONSTRAINT club_interests_interest_id_fkey
      FOREIGN KEY (interest_id) REFERENCES public.interests(id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- Existing rows (demo-club seeds in non-prod environments) get their interest_id
-- from the legacy text label. Prod's club_interests is empty so this is a no-op there.
UPDATE public.club_interests ci
SET interest_id = i.id
FROM public.interests i
WHERE lower(i.label) = lower(ci.interest)
  AND ci.interest_id IS NULL;

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(DISTINCT ci.interest, ', ')
  INTO v_bad
  FROM public.club_interests ci
  WHERE ci.interest_id IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'club_interests rows with unresolved interest label(s): %', v_bad;
  END IF;
END
$$;

ALTER TABLE public.club_interests
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'primary';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.club_interests'::regclass
      AND conname = 'club_interests_tier_check'
  ) THEN
    ALTER TABLE public.club_interests
      ADD CONSTRAINT club_interests_tier_check
      CHECK (tier IN ('primary', 'secondary'));
  END IF;
END
$$;

ALTER TABLE public.club_interests
  ALTER COLUMN tier DROP DEFAULT;

ALTER TABLE public.club_interests
  DROP CONSTRAINT IF EXISTS club_interests_interest_check;

ALTER TABLE public.club_interests
  ALTER COLUMN interest DROP NOT NULL;

ALTER TABLE public.club_interests
  ALTER COLUMN interest_id SET NOT NULL;

DELETE FROM public.club_interests a
USING public.club_interests b
WHERE a.club_id = b.club_id
  AND a.interest_id = b.interest_id
  AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.club_interests'::regclass
      AND conname = 'uniq_club_interest'
  ) THEN
    ALTER TABLE public.club_interests
      ADD CONSTRAINT uniq_club_interest UNIQUE (club_id, interest_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_club_interests_interest_id
  ON public.club_interests (interest_id);

DROP POLICY IF EXISTS "club_interests: officers can manage" ON public.club_interests;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'club_interests'
      AND policyname = 'club_interests: anyone authenticated can read'
  ) THEN
    CREATE POLICY "club_interests: anyone authenticated can read"
      ON public.club_interests FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'club_interests'
      AND policyname = 'club_interests: anon can read'
  ) THEN
    CREATE POLICY "club_interests: anon can read"
      ON public.club_interests FOR SELECT
      TO anon
      USING (true);
  END IF;
END
$$;

REVOKE INSERT, UPDATE, DELETE ON public.club_interests FROM anon, authenticated;
GRANT SELECT ON public.club_interests TO service_role;

ALTER TABLE public.user_interests
  ADD COLUMN IF NOT EXISTS interest_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_interests'::regclass
      AND conname = 'user_interests_interest_id_fkey'
  ) THEN
    ALTER TABLE public.user_interests
      ADD CONSTRAINT user_interests_interest_id_fkey
      FOREIGN KEY (interest_id) REFERENCES public.interests(id) ON DELETE RESTRICT;
  END IF;
END
$$;

UPDATE public.user_interests ui
SET interest_id = i.id
FROM public.interests i
WHERE lower(i.label) = lower(ui.interest)
  AND ui.interest_id IS NULL;

DO $$
DECLARE
  v_offending text;
BEGIN
  SELECT string_agg(format('%s=%s', ui.user_id, ui.interest), ', ' ORDER BY ui.user_id, ui.interest)
  INTO v_offending
  FROM public.user_interests ui
  WHERE ui.interest_id IS NULL;

  IF v_offending IS NOT NULL THEN
    RAISE EXCEPTION 'user_interests rows unresolved: %', v_offending;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_interests_user_interest_id
  ON public.user_interests (user_id, interest_id);

DROP INDEX IF EXISTS public.uniq_user_interests_user_interest;

ALTER TABLE public.user_interests
  DROP CONSTRAINT IF EXISTS user_interests_interest_check;

ALTER TABLE public.user_interests
  ALTER COLUMN interest DROP NOT NULL;

-- ── Backward compatibility: keep user_interests.interest_id NULLABLE for now ──
-- Currently distributed iOS/Android builds write user_interests with only the
-- legacy `interest` label and no `interest_id`
-- (apps/mobile/services/profileService.ts, apps/web/lib/hooks/useInterestsRerun.ts
-- pre-catalog). Enforcing NOT NULL here would break "Edit interests" for every
-- installed mobile build until an app-store update. Instead:
--   * interest_id stays nullable;
--   * this BEFORE trigger resolves interest_id from the label against the active
--     catalog whenever a caller supplies a label but no id (and back-fills the
--     label when a modern caller supplies only the id);
--   * an unknown label is left as-is (interest_id NULL) so the insert is never
--     rejected — the recommendation joins simply skip that row;
--   * `set_my_interests()` and all new client code write interest_id directly.
-- A later, separately-approved cleanup migration will enforce NOT NULL once the
-- label-only builds have aged out. The one-time backfill above is still asserted
-- (see the trailing guard) so migration time state is verified.
CREATE OR REPLACE FUNCTION public.user_interests_resolve_interest_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.interest_id IS NULL AND NEW.interest IS NOT NULL THEN
    SELECT i.id INTO NEW.interest_id
    FROM public.interests i
    WHERE i.is_active = true
      AND lower(i.label) = lower(NEW.interest)
    LIMIT 1;
  END IF;

  IF NEW.interest IS NULL AND NEW.interest_id IS NOT NULL THEN
    SELECT i.label INTO NEW.interest
    FROM public.interests i
    WHERE i.id = NEW.interest_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_interests_resolve_interest_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_user_interests_resolve_interest_id ON public.user_interests;
CREATE TRIGGER trg_user_interests_resolve_interest_id
  BEFORE INSERT OR UPDATE ON public.user_interests
  FOR EACH ROW
  EXECUTE FUNCTION public.user_interests_resolve_interest_id();

CREATE OR REPLACE FUNCTION public.set_my_interests(p_slugs text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bad_slug text;
  v_has_bad_slug boolean;
  v_ids uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  SELECT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_slugs, ARRAY[]::text[])) AS r(value)
    WHERE r.value IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.interests i
         WHERE i.is_active = true
           AND (i.slug = r.value OR lower(i.label) = lower(r.value))
       )
  )
  INTO v_has_bad_slug;

  IF v_has_bad_slug THEN
    SELECT r.value
    INTO v_bad_slug
    FROM unnest(COALESCE(p_slugs, ARRAY[]::text[])) AS r(value)
    WHERE r.value IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.interests i
         WHERE i.is_active = true
           AND (i.slug = r.value OR lower(i.label) = lower(r.value))
       )
    LIMIT 1;

    RAISE EXCEPTION 'unknown_interest: %', COALESCE(v_bad_slug, 'null');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT i.id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.interests i
  WHERE i.is_active = true
    AND (
      i.slug = ANY(COALESCE(p_slugs, ARRAY[]::text[]))
      OR lower(i.label) = ANY (
        SELECT lower(x)
        FROM unnest(COALESCE(p_slugs, ARRAY[]::text[])) AS x
      )
    );

  DELETE FROM public.user_interests
  WHERE user_id = v_user_id;

  INSERT INTO public.user_interests (user_id, interest, interest_id)
  SELECT v_user_id, i.label, i.id
  FROM public.interests i
  WHERE i.id = ANY(v_ids)
  ON CONFLICT (user_id, interest_id) DO UPDATE
    SET interest = EXCLUDED.interest;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_interests(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_interests(text[]) TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.interests) < 22 THEN
    RAISE EXCEPTION 'interests catalog incomplete: expected at least 22 rows';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_interests WHERE interest_id IS NULL) THEN
    RAISE EXCEPTION 'user_interests contains NULL interest_id after migration';
  END IF;
  RAISE NOTICE '122 ok';
END
$$;
