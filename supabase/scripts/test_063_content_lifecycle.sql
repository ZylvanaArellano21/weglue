-- Day 10C migration 063 focused database harness (LOCAL / throwaway only).
--
-- Run after `supabase db reset --local`, never against Production. For the
-- Docker-backed local stack, invoke the database client inside its container:
--   docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/scripts/test_063_content_lifecycle.sql
--
-- The script rolls its fixtures back. It proves lifecycle transitions and RLS
-- under authenticated/service_role, rather than treating a PostgreSQL owner as
-- a student. No production content is read or written.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TABLE t063_results (name text PRIMARY KEY, ok boolean NOT NULL);
CREATE OR REPLACE FUNCTION public.t063_ok(p_name text, p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.t063_results VALUES (p_name, COALESCE(p_ok, false));
END;
$$;
GRANT EXECUTE ON FUNCTION public.t063_ok(text, boolean) TO authenticated, service_role;
-- This local reset role topology does not retain the ordinary PostgREST table
-- grants that Production supplies. Grant them only inside this rolled-back
-- harness so the assertions exercise RLS predicates rather than ACL denial.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.post_comments, public.events, public.notifications TO authenticated;
GRANT SELECT ON public.user_privacy, public.follows, public.user_blocks, public.club_members TO authenticated;

-- ── Fixtures ──────────────────────────────────────────────────────────────
\set CREATOR '''a6300000-0000-4000-8000-000000000001'''
\set VIEWER  '''a6300000-0000-4000-8000-000000000002'''
\set FOUNDER '''a6300000-0000-4000-8000-000000000003'''
\set CLUB    '''c6300000-0000-4000-8000-000000000001'''
\set POST    '''d6300000-0000-4000-8000-000000000001'''
\set COMMENT '''c6300000-0000-4000-8000-000000000002'''
\set EVENT   '''e6300000-0000-4000-8000-000000000001'''
\set CREATOR_DELETED_POST '''d6300000-0000-4000-8000-000000000002'''
\set PURGED  '''d6300000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  (:CREATOR, 'creator-063@test.invalid', '{}'::jsonb),
  (:VIEWER,  'viewer-063@test.invalid', '{}'::jsonb),
  (:FOUNDER, 'founder-063@test.invalid', '{"account_type":"platform_admin"}'::jsonb);
-- The full local stack has the production auth signup trigger enabled. Its
-- generated profile is not part of this fixture, so replace only those local
-- fixture rows with deterministic identities before inserting content.
DELETE FROM public.profiles WHERE id IN (:CREATOR, :VIEWER, :FOUNDER);
INSERT INTO public.profiles (id, username, full_name) VALUES
  (:CREATOR, 'creator063', 'Creator 063'),
  (:VIEWER,  'viewer063',  'Viewer 063');
INSERT INTO public.clubs (id, name, handle, description, is_active)
VALUES (:CLUB, 'Lifecycle Test Club', 'lifecycle-test-063', 'Local lifecycle test fixture.', true);
INSERT INTO public.posts (id, author_id, club_id, post_type, image_url, caption) VALUES
  (:POST, :CREATOR, :CLUB, 'picture', 'local-test-image', 'post body must stay canonical'),
  (:CREATOR_DELETED_POST, :CREATOR, :CLUB, 'picture', 'local-test-image', 'creator deletion body');
INSERT INTO public.post_comments (id, post_id, user_id, content) VALUES
  (:COMMENT, :POST, :CREATOR, 'comment body must stay canonical');
INSERT INTO public.events (id, club_id, created_by, title, event_date, start_time, end_time, visibility) VALUES
  (:EVENT, :CLUB, :CREATOR, 'Lifecycle test event', CURRENT_DATE + 3, '12:00', '13:00', 'everyone');
INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message) VALUES
  (:VIEWER, :CREATOR, 'like', :POST, 'post', 'Existing post notification'),
  (:VIEWER, :CREATOR, 'event_reminder_hour', :EVENT, 'event', 'Existing event notification');

-- ── Creator deletion: forward-only metadata + immutable audit evidence ────
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :CREATOR)::text, false);
DELETE FROM public.posts WHERE id = :CREATOR_DELETED_POST;
SELECT public.t063_ok('creator deletion removes the canonical post',
  NOT EXISTS (SELECT 1 FROM public.posts WHERE id = :CREATOR_DELETED_POST));
RESET ROLE;
SELECT public.t063_ok('creator deletion stores only lifecycle metadata',
  EXISTS (SELECT 1 FROM public.content_lifecycle
          WHERE entity_type = 'post' AND entity_id = :CREATOR_DELETED_POST
            AND owner_id = :CREATOR AND state = 'creator_deleted' AND creator_deleted_at IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'content_lifecycle'
       AND column_name IN ('caption','content','title','description','image_url','media_url','internal_reason')
  ));
SELECT public.t063_ok('creator deletion is audited with a correlation id',
  EXISTS (SELECT 1 FROM public.admin_audit_events
          WHERE action = 'post.creatorDelete' AND target_id = :CREATOR_DELETED_POST
            AND actor_user_id = :CREATOR AND correlation_id IS NOT NULL));

-- ── Remove / restore posts and student visibility ─────────────────────────
SET ROLE service_role;
SELECT public.t063_ok('post remove returns ok',
  (public.admin_tx_post_remove(:FOUNDER, 'founder-063@test.invalid', 'Documented post removal.', gen_random_uuid(), :POST)->>'status') = 'ok');
SELECT public.t063_ok('post removal creates structural lifecycle state',
  EXISTS (SELECT 1 FROM public.content_lifecycle
          WHERE entity_type = 'post' AND entity_id = :POST AND state = 'removed'
            AND removed_at IS NOT NULL AND removed_by = :FOUNDER AND removal_correlation_id IS NOT NULL));
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :VIEWER)::text, false);
SELECT public.t063_ok('administrator-removed post is hidden from a student',
  NOT EXISTS (SELECT 1 FROM public.posts WHERE id = :POST));
SELECT public.t063_ok('administrator-removed comment has no public tombstone',
  NOT EXISTS (SELECT 1 FROM public.post_comments WHERE post_id = :POST));
SELECT public.t063_ok('administrator-removed post notifications are hidden',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE entity_type='post' AND entity_id=:POST));
SELECT public.t063_ok('removed post is not used by SECURITY DEFINER people discovery',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_people(:VIEWER) d
              WHERE d.user_id=:CREATOR AND d.club_id=:CLUB));
RESET ROLE;

SET ROLE service_role;
SELECT public.t063_ok('duplicate post remove is rejected without another transition',
  (public.admin_tx_post_remove(:FOUNDER, 'founder-063@test.invalid', 'Duplicate removal attempt.', gen_random_uuid(), :POST)->>'status') = 'already_removed'
  AND (SELECT state FROM public.content_lifecycle WHERE entity_type='post' AND entity_id=:POST) = 'removed');
SELECT public.t063_ok('post restore returns ok',
  (public.admin_tx_post_restore(:FOUNDER, 'founder-063@test.invalid', 'Documented post restoration.', gen_random_uuid(), :POST)->>'status') = 'ok');
SELECT public.t063_ok('restored post returns to active state with history marker',
  EXISTS (SELECT 1 FROM public.content_lifecycle
          WHERE entity_type='post' AND entity_id=:POST AND state='active'
            AND restored_at IS NOT NULL AND restoration_correlation_id IS NOT NULL));
SELECT public.t063_ok('restore from active is an invalid transition',
  (public.admin_tx_post_restore(:FOUNDER, 'founder-063@test.invalid', 'Invalid repeat restoration.', gen_random_uuid(), :POST)->>'status') = 'not_removed');
SELECT public.t063_ok('missing content returns not_found',
  (public.admin_tx_post_remove(:FOUNDER, 'founder-063@test.invalid', 'Missing content check.', gen_random_uuid(), 'f6300000-0000-4000-8000-000000000001') ->> 'status') = 'not_found');
SELECT public.t063_ok('creator-deleted content cannot be restored',
  (public.admin_tx_post_restore(:FOUNDER, 'founder-063@test.invalid', 'Attempt creator restore.', gen_random_uuid(), :CREATOR_DELETED_POST)->>'status') = 'creator_deleted');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :VIEWER)::text, false);
SELECT public.t063_ok('restored post is readable again through normal student RLS',
  EXISTS (SELECT 1 FROM public.posts WHERE id = :POST));
RESET ROLE;

-- ── Comments are hidden (not tombstoned) and then restored ────────────────
SET ROLE service_role;
SELECT public.t063_ok('comment remove returns ok',
  (public.admin_tx_comment_remove(:FOUNDER, 'founder-063@test.invalid', 'Documented comment removal.', gen_random_uuid(), :COMMENT)->>'status') = 'ok');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :CREATOR)::text, false);
SELECT public.t063_ok('removed comment is hidden even from its creator',
  NOT EXISTS (SELECT 1 FROM public.post_comments WHERE id = :COMMENT));
RESET ROLE;
SET ROLE service_role;
SELECT public.t063_ok('comment restore returns ok',
  (public.admin_tx_comment_restore(:FOUNDER, 'founder-063@test.invalid', 'Documented comment restoration.', gen_random_uuid(), :COMMENT)->>'status') = 'ok');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :CREATOR)::text, false);
SELECT public.t063_ok('restored comment is readable again',
  EXISTS (SELECT 1 FROM public.post_comments WHERE id = :COMMENT));
RESET ROLE;

-- ── Events: visibility + restore; no reminder data is leaked by its select ─
SET ROLE service_role;
SELECT public.t063_ok('event remove returns ok',
  (public.admin_tx_event_remove(:FOUNDER, 'founder-063@test.invalid', 'Documented event removal.', gen_random_uuid(), :EVENT)->>'status') = 'ok');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :VIEWER)::text, false);
SELECT public.t063_ok('removed event is hidden from student event RLS',
  NOT EXISTS (SELECT 1 FROM public.events WHERE id = :EVENT));
SELECT public.t063_ok('removed event notifications are hidden',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE entity_type='event' AND entity_id=:EVENT));
RESET ROLE;
SET ROLE service_role;
SELECT public.t063_ok('event restore returns ok',
  (public.admin_tx_event_restore(:FOUNDER, 'founder-063@test.invalid', 'Documented event restoration.', gen_random_uuid(), :EVENT)->>'status') = 'ok');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :VIEWER)::text, false);
SELECT public.t063_ok('restored event is readable again through normal RLS',
  EXISTS (SELECT 1 FROM public.events WHERE id = :EVENT));
RESET ROLE;

-- ── Atomic audit failure: an audit exception rolls the lifecycle write back ─
CREATE OR REPLACE FUNCTION public.t063_reject_audit() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced lifecycle audit failure'; END; $$;
CREATE TRIGGER t063_reject_audit BEFORE INSERT ON public.admin_audit_events
FOR EACH ROW EXECUTE FUNCTION public.t063_reject_audit();
SET ROLE service_role;
DO $$
BEGIN
  PERFORM public.admin_tx_event_remove(
    'a6300000-0000-4000-8000-000000000003', 'founder-063@test.invalid',
    'This transaction must roll back.', gen_random_uuid(), 'e6300000-0000-4000-8000-000000000001'
  );
  RAISE EXCEPTION 'forced audit trigger did not fire';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
RESET ROLE;
DROP TRIGGER t063_reject_audit ON public.admin_audit_events;
SELECT public.t063_ok('audit failure rolls back the lifecycle mutation',
  (SELECT state FROM public.content_lifecycle WHERE entity_type='event' AND entity_id=:EVENT) = 'active');

-- ── Historical purged record remains structural-only in the dashboard view ─
INSERT INTO public.content_lifecycle (
  entity_type, entity_id, state, owner_id, content_created_at, removed_at, removed_by,
  removal_correlation_id, purge_requested_at, purge_completed_at
) VALUES (
  'post', :PURGED, 'purged', :CREATOR, now(), now(), :FOUNDER,
  gen_random_uuid(), now(), now()
);
SELECT public.t063_ok('purged history remains visible without a canonical content row',
  EXISTS (SELECT 1 FROM public.admin_content_lifecycle_records
          WHERE entity_type='post' AND entity_id=:PURGED AND state='purged')
  AND NOT EXISTS (SELECT 1 FROM public.posts WHERE id=:PURGED));

-- ── Security boundary / read-only purge scope ──────────────────────────────
SELECT public.t063_ok('only service_role may execute lifecycle admin RPCs',
  has_function_privilege('service_role', 'public.admin_tx_post_remove(uuid,text,text,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.admin_tx_post_remove(uuid,text,text,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_tx_post_remove(uuid,text,text,uuid,uuid)', 'EXECUTE'));
SELECT public.t063_ok('lifecycle table and dashboard view are not student-readable',
  NOT has_table_privilege('authenticated', 'public.content_lifecycle', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.admin_content_lifecycle_records', 'SELECT'));
SELECT public.t063_ok('Day 10C creates no purge mutation function or worker surface',
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'admin_tx_%purge%')
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE '%content_lifecycle%purge%'));
SELECT public.t063_ok('all lifecycle transitions have related audit evidence',
  EXISTS (SELECT 1 FROM public.admin_audit_events WHERE action='post.remove' AND target_id=:POST)
  AND EXISTS (SELECT 1 FROM public.admin_audit_events WHERE action='post.restore' AND target_id=:POST)
  AND EXISTS (SELECT 1 FROM public.admin_audit_events WHERE action='comment.remove' AND target_id=:COMMENT)
  AND EXISTS (SELECT 1 FROM public.admin_audit_events WHERE action='comment.restore' AND target_id=:COMMENT)
  AND EXISTS (SELECT 1 FROM public.admin_audit_events WHERE action='event.remove' AND target_id=:EVENT)
  AND EXISTS (SELECT 1 FROM public.admin_audit_events WHERE action='event.restore' AND target_id=:EVENT));

SELECT name, ok FROM public.t063_results ORDER BY name;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) AS total FROM public.t063_results;

DO $$
DECLARE failures int;
BEGIN
  SELECT count(*) INTO failures FROM public.t063_results WHERE NOT ok;
  IF failures > 0 THEN
    RAISE EXCEPTION '063 lifecycle harness failed: % assertion(s)', failures;
  END IF;
END;
$$;

ROLLBACK;
