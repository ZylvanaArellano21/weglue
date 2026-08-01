-- Run after the migration suite on a production-shaped database.
-- Verifies policy shape without mutating production data.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_channels'
      AND policyname = 'conv_channels: participants can manage'
  ) THEN
    RAISE EXCEPTION 'broad conversation_channels participant-management policy still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages'
      AND policyname = 'messages: participants can read active'
      AND qual ILIKE '%deleted_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'active-message SELECT policy is missing its deleted_at guard';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_message_suggestions'
  ) THEN
    RAISE EXCEPTION 'get_message_suggestions is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_message_people'
  ) THEN
    RAISE EXCEPTION 'search_message_people is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_message_content'
  ) THEN
    RAISE EXCEPTION 'search_message_content is missing';
  END IF;
END;
$$;

ROLLBACK;
