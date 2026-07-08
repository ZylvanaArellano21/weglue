-- ============================================================================
-- We Glue – Schema-drift repair: events.specific_user_ids
-- Migration: 030_events_specific_user_ids_backfill.sql
-- ============================================================================
--
-- Pure Postgres — identical effect on the iOS (App Store) and Android (Play
-- Store) builds, since both talk to the same Supabase database.
--
-- Background
-- ----------
-- events.specific_user_ids (the recipient allow-list for "Only these members" /
-- visibility = 'specific' events) exists in the live production database but was
-- added there directly, so no migration created it. Migrations 018, 026 and 029
-- already REFERENCE it (p_user_id / auth.uid() = ANY(events.specific_user_ids)).
--
-- This migration closes the drift for any database that applied the *original*
-- 001 (which lacked the column) — production included. It is a safe no-op where
-- the column already exists.
--
-- Confirmed column shape (from the live schema dump + generated types in
-- packages/database/src/types.ts, which types it as `string[] | null`):
--   type      : uuid[]
--   nullable  : yes
--   default   : none  (the app inserts NULL for non-'specific' events, and the
--                       visibility RLS in 029 treats NULL as "no recipients")
--
-- We deliberately do NOT add a DEFAULT so a rebuilt schema matches production
-- exactly, and we do NOT change any visibility/RLS behavior.
-- ============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS specific_user_ids uuid[];

-- No GIN index is added on purpose. The only reads of this column use
-- `<uuid> = ANY(specific_user_ids)` (RLS policy in 029 + get_discovery_events in
-- 018/026). Postgres cannot use a GIN array index for the `= ANY(...)` form —
-- that requires the containment operators (@>, <@, &&), which this codebase does
-- not use — so a GIN index here would be dead weight. If a future query switches
-- to `specific_user_ids @> ARRAY[<uuid>]`, add the index then.
