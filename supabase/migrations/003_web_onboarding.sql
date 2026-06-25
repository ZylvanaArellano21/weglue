-- ============================================================
-- We Glue – Web Onboarding Schema Updates
-- Migration: 003_web_onboarding.sql
-- ============================================================

-- ============================================================
-- ADD MISSING COLUMNS TO profiles
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_to_terms BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_at TIMESTAMPTZ;

-- ============================================================
-- ANON READ POLICIES (for pre-auth club matching survey)
-- ============================================================

-- Allow anonymous users to read clubs so the onboarding survey
-- can calculate matched club count before account creation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clubs' AND policyname = 'clubs: anon can read'
  ) THEN
    CREATE POLICY "clubs: anon can read"
      ON clubs FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_interests' AND policyname = 'club_interests: anon can read'
  ) THEN
    CREATE POLICY "club_interests: anon can read"
      ON club_interests FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;

-- ============================================================
-- RLS: profiles must allow service-role inserts from trigger
-- (no change needed — trigger uses SECURITY DEFINER which bypasses RLS)
-- ============================================================
