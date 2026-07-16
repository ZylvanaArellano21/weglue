-- 048: Security hardening ahead of the first store release.
--
-- 1. Pin search_path on every SECURITY DEFINER function that still resolved
--    objects through the caller's search_path. Without a pinned path, a role
--    that can create objects in a schema earlier in the effective path could
--    shadow a table or function these run against with definer privileges
--    (the exact risk the Supabase security linter flags as
--    "function_search_path_mutable"). All of these live in public and only
--    reference public/auth objects, so pinning to public is behavior-neutral.
--
-- 2. Bound anonymous inserts into deletion_requests. The row is written by
--    the public account-deletion form (store compliance requires the form to
--    work without a login), but nothing constrained what an anonymous caller
--    could store: any shape, any size. A malformed "email" is useless for
--    processing the request, and unbounded text is a junk-data vector.

-- ── 1. Pin search_path ────────────────────────────────────────────────────────

alter function public.check_club_inactivity() set search_path = public;
alter function public.delete_own_user_data() set search_path = public;
alter function public.get_discovery_clubs(p_user_id uuid, p_category text, p_limit integer, p_offset integer) set search_path = public;
alter function public.get_discovery_events(p_user_id uuid, p_limit integer, p_offset integer) set search_path = public;
alter function public.get_discovery_people(p_user_id uuid) set search_path = public;
alter function public.handle_club_leave_rsvp_cleanup() set search_path = public;
alter function public.handle_post_tagged_club_photo() set search_path = public;
alter function public.is_channel_club_officer(p_channel_id uuid) set search_path = public;
alter function public.is_club_member(p_club_id uuid) set search_path = public;
alter function public.is_club_officer(p_club_id uuid) set search_path = public;
alter function public.is_conversation_participant(p_conv_id uuid) set search_path = public;
alter function public.recent_club_preview_message_ids(p_conv_id uuid) set search_path = public;
alter function public.search_discovery(p_user_id uuid, p_query text) set search_path = public;
alter function public.update_club_activity_on_event() set search_path = public;
alter function public.update_club_member_count() set search_path = public;

-- ── 2. Constrain the anonymous deletion-request surface ──────────────────────

alter table public.deletion_requests
  add constraint deletion_requests_email_shape
    check (char_length(email) <= 320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    not valid;

alter table public.deletion_requests
  add constraint deletion_requests_reason_length
    check (reason is null or char_length(reason) <= 2000)
    not valid;

-- NOT VALID keeps any pre-existing rows readable for support; only new inserts
-- must satisfy the shape. Validate what we can without failing the migration:
do $$
begin
  begin
    alter table public.deletion_requests validate constraint deletion_requests_email_shape;
    alter table public.deletion_requests validate constraint deletion_requests_reason_length;
  exception when check_violation then
    raise notice 'deletion_requests has pre-existing rows that fail the new shape checks; constraints stay NOT VALID for them.';
  end;
end $$;
