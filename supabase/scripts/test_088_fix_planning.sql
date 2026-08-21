-- Day 10G local database/security harness for migration 088.
-- Run after a disposable local reset with migrations through 088.

\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  v_summary jsonb;
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'notify_photo_post_university')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'enforce_message_channel_post_permission')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'unblock_user') THEN
    RAISE EXCEPTION 'migration 088 functions are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_photo_post_university_notify')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_message_channel_post_permission') THEN
    RAISE EXCEPTION 'migration 088 triggers are missing';
  END IF;

  SELECT public.get_unread_summary_for(NULL) INTO v_summary;
  IF COALESCE((v_summary ->> 'unread_notifications')::int, -1) <> 0
     OR COALESCE((v_summary ->> 'unread_threads')::int, -1) <> 0
     OR COALESCE((v_summary ->> 'unread_direct_messages')::int, -1) <> 0
     OR COALESCE((v_summary ->> 'unread_group_messages')::int, -1) <> 0
     OR COALESCE(jsonb_typeof(v_summary -> 'unread_conversations'), '') <> 'array' THEN
    RAISE EXCEPTION 'unread summary shape is wrong';
  END IF;

  IF has_function_privilege('authenticated', 'public.unblock_user(uuid)', 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'unblock_user grant missing';
  END IF;
END;
$$;
