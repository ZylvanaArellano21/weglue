-- ============================================================
-- We Glue – Open Email Eligibility (allow any email to sign up)
-- Migration: 051_open_email_eligibility.sql
--
-- WHY:
--   Testers (Play Store closed testing + App Store TestFlight) do not all
--   have .edu / academic email addresses, which blocked them from signing
--   up and logging in. We are opening eligibility so ANY well-formed email
--   address (gmail.com, hotmail.com, outlook.com, school email — anything)
--   is accepted.
--
-- HOW:
--   `is_educational_email(email)` is the single server-side eligibility gate.
--   It is called by BOTH:
--     * the `before_user_created` auth hook (008) — the gate GoTrue runs at
--       signup, and
--     * `complete_signup` / Microsoft-OAuth onboarding (047) — the backstop
--       gate at onboarding completion.
--   Redefining this one function to accept any syntactically valid email
--   therefore opens every server-side gate at once, with no change needed to
--   the hook wiring or the onboarding RPCs.
--
--   The client-side validator (`validateEducationEmail` in @weglue/shared) is
--   relaxed to match: it now only checks that the address is well-formed.
--
-- REVERSIBILITY:
--   To restore .edu-only eligibility, re-run migration 008's definition of
--   is_educational_email (the domain allowlist/denylist version).
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_educational_email(email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  domain TEXT;
BEGIN
  -- Extract the domain (everything after the last @).
  domain := lower(substring(trim(email) FROM '@([^@]+)$'));

  -- Reject only clearly-malformed addresses: no domain, or a domain that does
  -- not contain a dot with characters on both sides (e.g. "example.com").
  IF domain IS NULL OR domain !~ '^[^\s@]+\.[^\s@]+$' THEN
    RETURN FALSE;
  END IF;

  -- Any well-formed email address is eligible.
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
