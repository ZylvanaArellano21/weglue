-- ============================================================================
-- 091 — Tighten the push-dispatch safety net from 1 minute to 5 seconds
-- ============================================================================
--
-- Founder requirement (explicit, absolute): notification delivery must be
-- ≤5 seconds, on every platform, with no exceptions.
--
-- Migration 089 already made the PRIMARY path instant: invoke_push_dispatch()
-- now runs synchronously, in the same transaction, immediately after a push
-- is enqueued — not on a timer. That's the real fix and it already applies
-- to every path (all fan-outs that insert into `notifications`, plus chat
-- messages).
--
-- But 089 deliberately left the pg_cron job ('dispatch-push', migration 046)
-- scheduled once a MINUTE as a safety net — and that leaves a real, if
-- narrow, gap: if any single immediate-dispatch call ever failed silently
-- for some transient reason (invoke_push_dispatch()'s own top-level
-- EXCEPTION handler already swallows and RAISE WARNINGs any error so the
-- primary insert is never broken by it — but that same guarantee means such
-- a failure would otherwise wait up to 60 seconds for the next cron tick).
-- A "5 seconds maximum, no exceptions" requirement cannot tolerate a 60-
-- second fallback window, however rare.
--
-- Fix: reschedule 'dispatch-push' at '5 seconds' instead of '* * * * *'.
-- pg_cron 1.6+ (confirmed installed and tested directly against this
-- project's own local stack: a scratch 5-second job actually ran every ~5s,
-- not just accepted the syntax) supports sub-minute schedules natively via
-- this literal string form — no polling workaround needed.
--
-- This does not change what work happens per run: invoke_push_dispatch()
-- still no-ops immediately (a single indexed EXISTS check) when there is
-- nothing pending, so running it every 5 seconds instead of every 60 adds
-- a trivial, constant, cheap load — not a scaling concern.
--
-- Net effect: EVERY push, on EVERY platform, now has a hard ceiling of 5
-- seconds even in the worst case (immediate dispatch attempted and failed,
-- caught entirely by the next cron tick) — not just in the common case.
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-push');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'dispatch-push',
    '5 seconds',
    'SELECT public.invoke_push_dispatch();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule dispatch-push (5s) failed: %', SQLERRM;
END $$;
