-- ============================================================
-- We Glue – Lock down internal club-recommendation functions
-- Migration: 045_lock_down_internal_recommendation_functions.sql
--
-- SECURITY FIX (broken authorization / IDOR on recommendation batches)
--
-- 042 introduced two SECURITY DEFINER functions that are INTERNAL helpers,
-- never meant to be invoked directly by a client:
--   • generate_club_recommendation_batch(uuid, text)
--   • rank_eligible_clubs(uuid, uuid, text[], integer)
--
-- Both take a TARGET user_id as an argument and neither checks auth.uid(),
-- so they act on whatever identity the caller passes in. 042 only did
-- `REVOKE ... FROM PUBLIC` on generate_...(), and nothing at all on
-- rank_...(), while Supabase's default privileges still GRANT EXECUTE to the
-- client roles `anon` and `authenticated`. Net effect, proven against the
-- live project: any logged-in user — in fact even an anonymous caller —
-- could invoke
--     generate_club_recommendation_batch('<another-user-uuid>', 'interest_update')
-- to generate, replace, or churn a DIFFERENT user's recommendation batch and
-- read that batch row back, bypassing the "read own batch" RLS policy on
-- club_recommendation_batches. rank_eligible_clubs had the same exposure.
--
-- These helpers are only ever called from SECURITY DEFINER wrappers owned by
-- postgres, which keep the caller honest:
--   • regenerate_my_club_recommendations()  auth.uid() -> generate_...()
--   • handle_new_user()  (signup trigger)   NEW.id     -> generate_...()
--   • get_my_club_recommendations()         auth.uid() -> rank_...()
--   • preview_club_match_count()            launch campus, no user -> rank_...()
-- Because those wrappers execute as their definer (postgres, the owner of the
-- helpers), their internal calls keep working after this revoke. Only DIRECT
-- client execution is removed. `service_role` (the trusted backend key, never
-- shipped to a client) intentionally retains EXECUTE.
--
-- GRANTS ONLY. This migration creates, alters, or drops no table, column,
-- index, constraint, policy, trigger, or function body, and reads or writes
-- no application data. The single observable change is that `anon` and
-- `authenticated` can no longer directly execute the two helpers.
-- ============================================================

-- generate_club_recommendation_batch: internal only.
-- PUBLIC was already revoked in 042; anon/authenticated were left behind by
-- Supabase default privileges. Revoke all three (PUBLIC is a harmless no-op).
REVOKE EXECUTE ON FUNCTION public.generate_club_recommendation_batch(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- rank_eligible_clubs: internal only.
-- 042 never revoked anything here, so PUBLIC + anon + authenticated all held
-- EXECUTE. Remove every client-accessible grant.
REVOKE EXECUTE ON FUNCTION public.rank_eligible_clubs(uuid, uuid, text[], integer)
  FROM PUBLIC, anon, authenticated;
