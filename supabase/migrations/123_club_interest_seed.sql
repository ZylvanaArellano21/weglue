-- 123 — Canonical club-interest assignments.
-- Seeds the approved primary/secondary taxonomy for every target club using
-- existing production club handles; no club rows are created here.
-- Applies on prod ledger @ 121; see docs/interest-matching/.
--
-- Note: the approved "Philosophy Club" mappings target handle `TheAcademy`.
-- The Philosophy Club was removed from production and recreated by its officers
-- as "The Academy" (same philosophy focus); The Academy is its successor for
-- matching. Same four mappings, unchanged: Strategy and Critical Thinking +
-- Debate & Politics (primary), Writing + Religion (secondary).

DO $$
DECLARE
  v_affected integer;
  v_expected constant integer := 45;
  v_primary_missing text;
BEGIN
  INSERT INTO public.club_interests (club_id, interest_id, tier, interest)
  SELECT c.id, i.id, v.tier, i.label
  FROM (
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
  ) AS v(handle, slug, tier)
  JOIN public.clubs c ON c.handle = v.handle
  JOIN public.interests i ON i.slug = v.slug
  ON CONFLICT (club_id, interest_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        interest = EXCLUDED.interest;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> v_expected THEN
    RAISE EXCEPTION
      'club interest seed affected % rows; expected % (missing club or interest slug)',
      v_affected, v_expected;
  END IF;

  SELECT string_agg(c.handle, ', ' ORDER BY c.handle)
  INTO v_primary_missing
  FROM (
    VALUES
      ('AccountingClub'),
      ('AsianAmericanAssociation'),
      ('EconomicsClub'),
      ('HumanServicesStudentOrganization'),
      ('MavericksinRecovery'),
      ('MusicClub'),
      ('TheAcademy'),
      ('MathSociety'),
      ('StudentGovernmentAssociation'),
      ('TechnologyClub'),
      ('ASAPAlliedScholarsforAnimalProtection'),
      ('EngineeringSociety'),
      ('ClimbingClub')
  ) AS expected(handle)
  JOIN public.clubs c ON c.handle = expected.handle
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.club_interests ci
    WHERE ci.club_id = c.id
      AND ci.tier = 'primary'
  );

  IF v_primary_missing IS NOT NULL THEN
    RAISE EXCEPTION 'clubs missing a primary interest: %', v_primary_missing;
  END IF;

  RAISE NOTICE '123 ok';
END
$$;
