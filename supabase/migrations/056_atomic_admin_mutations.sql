-- ============================================================================
-- 056_atomic_admin_mutations.sql
--
-- Day 10A hardening — make every DATABASE-ONLY administrator mutation atomic
-- with its audit record.
--
-- THE PROBLEM THIS SOLVES
-- -----------------------
-- Migration 055 gave us a durable trail, but the audit INSERT was a separate
-- round-trip from the mutation. A mutation could therefore commit and the audit
-- write then fail, leaving an unaudited change. For database-only operations
-- that gap is unnecessary: PostgreSQL can do both in one transaction.
--
-- THE PATTERN
-- -----------
-- Every function here does, inside ONE transaction:
--     validate → snapshot before_state → mutate → snapshot after_state
--            → INSERT the audit row → return
--
--   • Audit insert raises (missing reason, forbidden payload, unknown action)
--     ⇒ the whole transaction rolls back ⇒ THE MUTATION IS UNDONE.
--   • Mutation raises ⇒ nothing commits ⇒ no success record can exist.
--   • Business rejection (not a member, last officer, …) ⇒ NO mutation is
--     performed and a durable FAILURE record is committed. The function
--     RETURNS a status rather than raising, precisely so that failure record
--     survives; raising would roll it back along with nothing else.
--
-- So: `audit row present` ⇔ `mutation committed`. In both directions, for every
-- operation in this file. That equivalence is what migration 055 alone could
-- not offer.
--
-- WHY REASON ENFORCEMENT NOW HAS TEETH
-- ------------------------------------
-- The 055 trigger raises when a `requires_reason` action commits a success row
-- without a reason. Because the audit insert now shares the mutation's
-- transaction, that raise ROLLS THE MUTATION BACK. A destructive action can no
-- longer mutate first and fail auditing afterwards — the case that made reason
-- enforcement advisory before.
--
-- MIGRATION 054 IS PRESERVED EXACTLY
-- ----------------------------------
-- The membership/officer functions CALL the 054 RPCs
-- (admin_set_club_member_role / admin_remove_club_member /
-- admin_transfer_club_officer) rather than reimplementing them. The last-officer
-- floor, its per-club advisory lock and the club_members backstop trigger are
-- untouched and still authoritative. A plpgsql function is a single transaction,
-- so calling them and writing the audit row is atomic.
--
-- ACTOR IDENTITY
-- --------------
-- p_actor_id / p_actor_email are supplied by the Next.js server from
-- requireSecureAdmin(). The database cannot verify a browser did not originate
-- them — that is a server-layer property, enforced because these functions are
-- executable ONLY by service_role, which exists only on the server. anon and
-- authenticated hold no EXECUTE on anything in this file.
--
-- NOT COVERED HERE (cannot be — no shared transaction exists):
--   Supabase Auth operations and Supabase Storage operations. Those use the
--   attempt→outcome correlated pattern in lib/admin/crossService.ts.
--
-- Additive. Creates functions only. No existing table, column, policy, trigger
-- or function is modified. Idempotent.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — Shared in-transaction audit helpers
-- ============================================================================
-- Both call public.admin_audit_log(), so every row still passes the SAME
-- validation, sanitization and reason enforcement as any other audit write.
-- There is no second, weaker path into the table.

CREATE OR REPLACE FUNCTION private.admin_tx_ok(
  p_actor_id UUID, p_actor_email TEXT, p_action TEXT, p_target_type TEXT,
  p_target_id UUID, p_reason TEXT, p_before JSONB, p_after JSONB,
  p_metadata JSONB, p_correlation_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE audit_id UUID;
BEGIN
  audit_id := public.admin_audit_log(
    p_actor_user_id  => p_actor_id,
    p_actor_email    => p_actor_email,
    p_action         => p_action,
    p_target_type    => p_target_type,
    p_target_id      => p_target_id,
    p_reason         => p_reason,
    p_before_state   => p_before,
    p_after_state    => p_after,
    p_metadata       => COALESCE(p_metadata, '{}'::JSONB),
    p_correlation_id => p_correlation_id,
    p_event_type     => 'success'
  );
  RETURN jsonb_build_object('status', 'ok', 'audit_id', audit_id, 'after', p_after);
END;
$$;

-- A validated business rejection. No mutation has been performed, so the
-- failure record is allowed to COMMIT — the caller returns this value rather
-- than raising.
CREATE OR REPLACE FUNCTION private.admin_tx_fail(
  p_actor_id UUID, p_actor_email TEXT, p_action TEXT, p_target_type TEXT,
  p_target_id UUID, p_metadata JSONB, p_correlation_id UUID, p_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE audit_id UUID;
BEGIN
  audit_id := public.admin_audit_log(
    p_actor_user_id  => p_actor_id,
    p_actor_email    => p_actor_email,
    p_action         => p_action,
    p_target_type    => p_target_type,
    p_target_id      => p_target_id,
    p_metadata       => COALESCE(p_metadata, '{}'::JSONB),
    p_error_code     => p_code,
    p_correlation_id => p_correlation_id,
    p_event_type     => 'failure'
  );
  RETURN jsonb_build_object('status', p_code, 'audit_id', audit_id);
END;
$$;

-- Row snapshots. Allowlisted column sets, mirroring STATE_FIELDS in
-- lib/admin/auditSanitize.ts. Private message content and report evidence
-- snapshots appear in none of them.
CREATE OR REPLACE FUNCTION private.admin_snap_member(p_club UUID, p_user UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', m.id, 'club_id', m.club_id, 'user_id', m.user_id,
                            'role', m.role, 'joined_at', m.joined_at)
    FROM public.club_members m WHERE m.club_id = p_club AND m.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION private.admin_snap_officer(p_club UUID, p_user UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', o.id, 'club_id', o.club_id, 'user_id', o.user_id,
                            'role_title', o.role_title, 'display_order', o.display_order)
    FROM public.club_officers o WHERE o.club_id = p_club AND o.user_id = p_user;
$$;


-- ============================================================================
-- SECTION 2 — Memberships and officers  (delegates to migration 054)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_membership_add(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_club_id UUID, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'userId', p_user_id);
  club_uni   UUID;
  user_uni   UUID;
  after_row  JSONB;
BEGIN
  SELECT c.university_id INTO club_uni FROM public.clubs c WHERE c.id = p_club_id;
  IF NOT FOUND THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'membership.add', 'club_member', p_user_id, meta, p_correlation_id, 'club_not_found');
  END IF;

  SELECT p.university_id INTO user_uni FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'membership.add', 'club_member', p_user_id, meta, p_correlation_id, 'user_not_found');
  END IF;

  IF club_uni IS NOT NULL AND user_uni IS NOT NULL AND club_uni <> user_uni THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'membership.add', 'club_member', p_user_id, meta, p_correlation_id, 'different_university');
  END IF;

  IF EXISTS (SELECT 1 FROM public.club_members m WHERE m.club_id = p_club_id AND m.user_id = p_user_id) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'membership.add', 'club_member', p_user_id, meta, p_correlation_id, 'already_member');
  END IF;

  INSERT INTO public.club_members (club_id, user_id, role) VALUES (p_club_id, p_user_id, 'member');

  after_row := private.admin_snap_member(p_club_id, p_user_id);
  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'membership.add', 'club_member', p_user_id,
                             p_reason, NULL, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_membership_remove(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_club_id UUID, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'userId', p_user_id);
  before_row JSONB;
  rpc_status TEXT;
BEGIN
  before_row := private.admin_snap_member(p_club_id, p_user_id);
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'membership.remove', 'club_member', p_user_id, meta, p_correlation_id, 'not_member');
  END IF;

  -- Migration 054 owns the last-officer floor and its advisory lock.
  rpc_status := public.admin_remove_club_member(p_club_id, p_user_id);
  IF rpc_status <> 'ok' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'membership.remove', 'club_member', p_user_id, meta, p_correlation_id, rpc_status);
  END IF;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'membership.remove', 'club_member', p_user_id,
                             p_reason, before_row, NULL, meta, p_correlation_id);
END;
$$;


-- officer.promote / officer.demote. The action name is derived from p_role, so
-- the caller cannot file a demotion under the promotion action.
CREATE OR REPLACE FUNCTION public.admin_tx_member_role_set(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_club_id UUID, p_user_id UUID, p_role TEXT, p_role_title TEXT DEFAULT 'Officer'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  act        TEXT := CASE WHEN p_role = 'officer' THEN 'officer.promote' ELSE 'officer.demote' END;
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'userId', p_user_id, 'role', p_role);
  before_row JSONB;
  after_row  JSONB;
  rpc_status TEXT;
BEGIN
  IF p_role NOT IN ('member', 'officer') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, act, 'club_officer', p_user_id, meta, p_correlation_id, 'invalid_role');
  END IF;

  before_row := private.admin_snap_member(p_club_id, p_user_id);
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, act, 'club_officer', p_user_id, meta, p_correlation_id, 'not_member');
  END IF;

  rpc_status := public.admin_set_club_member_role(p_club_id, p_user_id, p_role, COALESCE(p_role_title, 'Officer'), FALSE);
  IF rpc_status <> 'ok' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, act, 'club_officer', p_user_id, meta, p_correlation_id, rpc_status);
  END IF;

  after_row := COALESCE(private.admin_snap_member(p_club_id, p_user_id), '{}'::JSONB)
             || jsonb_build_object('roster', private.admin_snap_officer(p_club_id, p_user_id));

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, act, 'club_officer', p_user_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_officer_add(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_club_id UUID, p_user_id UUID, p_role_title TEXT DEFAULT 'Officer'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'userId', p_user_id);
  before_row JSONB;
  after_row  JSONB;
  rpc_status TEXT;
BEGIN
  IF p_role_title IS NULL OR char_length(btrim(p_role_title)) < 2 OR char_length(btrim(p_role_title)) > 40 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'officer.add', 'club_officer', p_user_id, meta, p_correlation_id, 'invalid_role_title');
  END IF;

  before_row := private.admin_snap_member(p_club_id, p_user_id);

  -- p_add_if_missing: membership row + display roster in one 054 transaction.
  rpc_status := public.admin_set_club_member_role(p_club_id, p_user_id, 'officer', btrim(p_role_title), TRUE);
  IF rpc_status <> 'ok' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'officer.add', 'club_officer', p_user_id, meta, p_correlation_id, rpc_status);
  END IF;

  after_row := COALESCE(private.admin_snap_member(p_club_id, p_user_id), '{}'::JSONB)
             || jsonb_build_object('roster', private.admin_snap_officer(p_club_id, p_user_id));

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'officer.add', 'club_officer', p_user_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_officer_title_set(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_club_id UUID, p_user_id UUID, p_role_title TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'userId', p_user_id);
  before_row JSONB;
  after_row  JSONB;
  title      TEXT := btrim(COALESCE(p_role_title, ''));
BEGIN
  IF char_length(title) < 2 OR char_length(title) > 40 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'officer.editTitle', 'club_officer', p_user_id, meta, p_correlation_id, 'invalid_role_title');
  END IF;

  before_row := private.admin_snap_officer(p_club_id, p_user_id);
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'officer.editTitle', 'club_officer', p_user_id, meta, p_correlation_id, 'not_officer');
  END IF;

  UPDATE public.club_officers SET role_title = title WHERE club_id = p_club_id AND user_id = p_user_id;

  after_row := private.admin_snap_officer(p_club_id, p_user_id);
  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'officer.editTitle', 'club_officer', p_user_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 3 — Gluemates
-- ============================================================================
-- A gluemate is the MUTUAL follow pair. Removing it deletes both directions in
-- one transaction; a one-way follow is left alone.

CREATE OR REPLACE FUNCTION public.admin_tx_gluemate_remove(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_user_a UUID, p_user_b UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('userAId', p_user_a, 'userBId', p_user_b);
  before_row JSONB;
  removed    INT;
BEGIN
  IF p_user_a = p_user_b THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'gluemate.remove', 'gluemate', p_user_a, meta, p_correlation_id, 'same_user');
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', f.id, 'follower_id', f.follower_id,
                                      'following_id', f.following_id, 'status', f.status))
    INTO before_row
    FROM public.follows f
   WHERE (f.follower_id = p_user_a AND f.following_id = p_user_b)
      OR (f.follower_id = p_user_b AND f.following_id = p_user_a);

  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'gluemate.remove', 'gluemate', p_user_a, meta, p_correlation_id, 'not_gluemates');
  END IF;

  DELETE FROM public.follows
   WHERE (follower_id = p_user_a AND following_id = p_user_b)
      OR (follower_id = p_user_b AND following_id = p_user_a);
  GET DIAGNOSTICS removed = ROW_COUNT;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'gluemate.remove', 'gluemate', p_user_a,
                             p_reason, jsonb_build_object('pair', before_row), NULL,
                             meta || jsonb_build_object('removed', removed), p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 4 — Universities
-- ============================================================================
-- NOTE: the single-campus gate for university.add lives in the server action
-- (lib/admin/actions.ts), which refuses before ever calling this function. The
-- gate is a product rule read from app_config, not a database invariant.

CREATE OR REPLACE FUNCTION public.admin_tx_university_add(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_name TEXT, p_slug TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta      JSONB := jsonb_build_object('name', p_name, 'slug', p_slug);
  new_id    UUID;
  after_row JSONB;
BEGIN
  IF char_length(btrim(COALESCE(p_name, ''))) < 2 OR char_length(btrim(COALESCE(p_name, ''))) > 100 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.add', 'university', NULL, meta, p_correlation_id, 'invalid_name');
  END IF;
  IF p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(p_slug) > 60 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.add', 'university', NULL, meta, p_correlation_id, 'invalid_slug');
  END IF;
  IF EXISTS (SELECT 1 FROM public.universities u WHERE u.name = btrim(p_name) OR u.slug = p_slug) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.add', 'university', NULL, meta, p_correlation_id, 'duplicate');
  END IF;

  INSERT INTO public.universities (name, slug, is_active)
  VALUES (btrim(p_name), p_slug, TRUE)
  RETURNING id INTO new_id;

  SELECT jsonb_build_object('id', u.id, 'name', u.name, 'slug', u.slug, 'is_active', u.is_active)
    INTO after_row FROM public.universities u WHERE u.id = new_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'university.add', 'university', new_id,
                             p_reason, NULL, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_university_edit(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_id UUID, p_name TEXT DEFAULT NULL, p_slug TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('id', p_id);
  before_row JSONB;
  after_row  JSONB;
  new_name   TEXT;
  new_slug   TEXT;
BEGIN
  SELECT jsonb_build_object('id', u.id, 'name', u.name, 'slug', u.slug, 'is_active', u.is_active)
    INTO before_row FROM public.universities u WHERE u.id = p_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.edit', 'university', p_id, meta, p_correlation_id, 'not_found');
  END IF;

  new_name := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), before_row ->> 'name');
  new_slug := COALESCE(NULLIF(btrim(COALESCE(p_slug, '')), ''), before_row ->> 'slug');

  IF char_length(new_name) < 2 OR char_length(new_name) > 100 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.edit', 'university', p_id, meta, p_correlation_id, 'invalid_name');
  END IF;
  IF new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(new_slug) > 60 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.edit', 'university', p_id, meta, p_correlation_id, 'invalid_slug');
  END IF;
  IF EXISTS (SELECT 1 FROM public.universities u WHERE u.id <> p_id AND (u.name = new_name OR u.slug = new_slug)) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.edit', 'university', p_id, meta, p_correlation_id, 'duplicate');
  END IF;

  UPDATE public.universities SET name = new_name, slug = new_slug WHERE id = p_id;

  SELECT jsonb_build_object('id', u.id, 'name', u.name, 'slug', u.slug, 'is_active', u.is_active)
    INTO after_row FROM public.universities u WHERE u.id = p_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_university_set_active(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_id UUID, p_is_active BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('id', p_id, 'isActive', p_is_active);
  before_row JSONB;
  after_row  JSONB;
BEGIN
  SELECT jsonb_build_object('id', u.id, 'name', u.name, 'slug', u.slug, 'is_active', u.is_active)
    INTO before_row FROM public.universities u WHERE u.id = p_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'university.setActive', 'university', p_id, meta, p_correlation_id, 'not_found');
  END IF;

  UPDATE public.universities SET is_active = p_is_active WHERE id = p_id;

  SELECT jsonb_build_object('id', u.id, 'name', u.name, 'slug', u.slug, 'is_active', u.is_active)
    INTO after_row FROM public.universities u WHERE u.id = p_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'university.setActive', 'university', p_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 5 — Posts, comments, events
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_post_caption_set(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_post_id UUID, p_caption TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('postId', p_post_id);
  before_row JSONB;
  after_row  JSONB;
  cap        TEXT := btrim(COALESCE(p_caption, ''));
BEGIN
  IF char_length(cap) > 2000 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'post.editCaption', 'post', p_post_id, meta, p_correlation_id, 'caption_too_long');
  END IF;

  SELECT jsonb_build_object('id', p.id, 'author_id', p.author_id, 'club_id', p.club_id, 'caption', p.caption)
    INTO before_row FROM public.posts p WHERE p.id = p_post_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'post.editCaption', 'post', p_post_id, meta, p_correlation_id, 'not_found');
  END IF;

  UPDATE public.posts SET caption = NULLIF(cap, '') WHERE id = p_post_id;

  SELECT jsonb_build_object('id', p.id, 'author_id', p.author_id, 'club_id', p.club_id, 'caption', p.caption)
    INTO after_row FROM public.posts p WHERE p.id = p_post_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'post.editCaption', 'post', p_post_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- Un-tags a post from ONE club: the primary tag on posts.club_id, any extra row
-- in post_club_tags, and that club's Glue-photo entry. All three in one
-- transaction, so a post can never be left half-detached.
CREATE OR REPLACE FUNCTION public.admin_tx_post_remove_from_club(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_post_id UUID, p_club_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta        JSONB := jsonb_build_object('postId', p_post_id, 'clubId', p_club_id);
  before_row  JSONB;
  after_row   JSONB;
  is_primary  BOOLEAN;
  has_extra   BOOLEAN;
BEGIN
  SELECT jsonb_build_object('id', p.id, 'author_id', p.author_id, 'club_id', p.club_id)
    INTO before_row FROM public.posts p WHERE p.id = p_post_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'post.removeFromClub', 'post', p_post_id, meta, p_correlation_id, 'not_found');
  END IF;

  is_primary := (before_row ->> 'club_id') = p_club_id::TEXT;
  has_extra  := EXISTS (SELECT 1 FROM public.post_club_tags t WHERE t.post_id = p_post_id AND t.club_id = p_club_id);

  IF NOT is_primary AND NOT has_extra THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'post.removeFromClub', 'post', p_post_id, meta, p_correlation_id, 'not_tagged');
  END IF;

  IF is_primary THEN
    UPDATE public.posts SET club_id = NULL WHERE id = p_post_id AND club_id = p_club_id;
  END IF;
  DELETE FROM public.post_club_tags WHERE post_id = p_post_id AND club_id = p_club_id;
  DELETE FROM public.club_photos    WHERE post_id = p_post_id AND club_id = p_club_id;

  SELECT jsonb_build_object('id', p.id, 'author_id', p.author_id, 'club_id', p.club_id)
    INTO after_row FROM public.posts p WHERE p.id = p_post_id;

  -- Verify inside the transaction: if anything still ties the post to the club,
  -- raise so the whole removal rolls back rather than reporting a half-success.
  IF (after_row ->> 'club_id') = p_club_id::TEXT
     OR EXISTS (SELECT 1 FROM public.post_club_tags t WHERE t.post_id = p_post_id AND t.club_id = p_club_id) THEN
    RAISE EXCEPTION 'admin_tx_post_remove_from_club: removal did not take effect'
      USING ERRCODE = 'data_exception';
  END IF;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'post.removeFromClub', 'post', p_post_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_comment_content_set(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_comment_id UUID, p_content TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('commentId', p_comment_id);
  before_row JSONB;
  after_row  JSONB;
  body       TEXT := btrim(COALESCE(p_content, ''));
BEGIN
  IF char_length(body) < 1 OR char_length(body) > 2000 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'comment.editContent', 'comment', p_comment_id, meta, p_correlation_id, 'invalid_content');
  END IF;

  SELECT jsonb_build_object('id', c.id, 'post_id', c.post_id, 'user_id', c.user_id, 'content', c.content)
    INTO before_row FROM public.post_comments c WHERE c.id = p_comment_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'comment.editContent', 'comment', p_comment_id, meta, p_correlation_id, 'not_found');
  END IF;

  UPDATE public.post_comments SET content = body WHERE id = p_comment_id;

  SELECT jsonb_build_object('id', c.id, 'post_id', c.post_id, 'user_id', c.user_id, 'content', c.content)
    INTO after_row FROM public.post_comments c WHERE c.id = p_comment_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'comment.editContent', 'comment', p_comment_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- Only the allowlisted keys of p_fields are applied; anything else is ignored.
CREATE OR REPLACE FUNCTION public.admin_tx_event_edit(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_event_id UUID, p_fields JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('eventId', p_event_id);
  before_row JSONB;
  after_row  JSONB;
  f          JSONB := COALESCE(p_fields, '{}'::JSONB);
BEGIN
  SELECT jsonb_build_object('id', e.id, 'club_id', e.club_id, 'title', e.title, 'emoji', e.emoji,
                            'description', e.description, 'event_date', e.event_date,
                            'start_time', e.start_time, 'end_time', e.end_time,
                            'location', e.location, 'building', e.building, 'room', e.room,
                            'visibility', e.visibility)
    INTO before_row FROM public.events e WHERE e.id = p_event_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'event.edit', 'event', p_event_id, meta, p_correlation_id, 'not_found');
  END IF;

  IF f ? 'title' AND (char_length(btrim(f ->> 'title')) < 2 OR char_length(btrim(f ->> 'title')) > 120) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'event.edit', 'event', p_event_id, meta, p_correlation_id, 'invalid_title');
  END IF;
  IF f ? 'visibility' AND (f ->> 'visibility') NOT IN ('club', 'public', 'specific') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'event.edit', 'event', p_event_id, meta, p_correlation_id, 'invalid_visibility');
  END IF;

  UPDATE public.events SET
    title       = CASE WHEN f ? 'title'       THEN btrim(f ->> 'title')        ELSE title       END,
    emoji       = CASE WHEN f ? 'emoji'       THEN NULLIF(f ->> 'emoji', '')   ELSE emoji       END,
    description = CASE WHEN f ? 'description' THEN NULLIF(f ->> 'description', '') ELSE description END,
    event_date  = CASE WHEN f ? 'event_date'  THEN (f ->> 'event_date')::DATE  ELSE event_date  END,
    start_time  = CASE WHEN f ? 'start_time'  THEN (f ->> 'start_time')::TIME  ELSE start_time  END,
    end_time    = CASE WHEN f ? 'end_time'    THEN NULLIF(f ->> 'end_time', '')::TIME ELSE end_time END,
    location    = CASE WHEN f ? 'location'    THEN NULLIF(f ->> 'location', '')ELSE location    END,
    building    = CASE WHEN f ? 'building'    THEN NULLIF(f ->> 'building', '')ELSE building    END,
    room        = CASE WHEN f ? 'room'        THEN NULLIF(f ->> 'room', '')    ELSE room        END,
    visibility  = CASE WHEN f ? 'visibility'  THEN f ->> 'visibility'          ELSE visibility  END
  WHERE id = p_event_id;

  SELECT jsonb_build_object('id', e.id, 'club_id', e.club_id, 'title', e.title, 'emoji', e.emoji,
                            'description', e.description, 'event_date', e.event_date,
                            'start_time', e.start_time, 'end_time', e.end_time,
                            'location', e.location, 'building', e.building, 'room', e.room,
                            'visibility', e.visibility)
    INTO after_row FROM public.events e WHERE e.id = p_event_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'event.edit', 'event', p_event_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 6 — RSVPs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_rsvp_upsert(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_event_id UUID, p_user_id UUID, p_status TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('eventId', p_event_id, 'userId', p_user_id, 'status', p_status);
  before_row JSONB;
  after_row  JSONB;
BEGIN
  IF p_status NOT IN ('going', 'cant') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'rsvp.upsert', 'rsvp', p_event_id, meta, p_correlation_id, 'invalid_status');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'rsvp.upsert', 'rsvp', p_event_id, meta, p_correlation_id, 'event_not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'rsvp.upsert', 'rsvp', p_event_id, meta, p_correlation_id, 'user_not_found');
  END IF;

  SELECT jsonb_build_object('id', r.id, 'event_id', r.event_id, 'user_id', r.user_id, 'status', r.status)
    INTO before_row FROM public.event_rsvps r WHERE r.event_id = p_event_id AND r.user_id = p_user_id;

  IF before_row IS NULL THEN
    INSERT INTO public.event_rsvps (event_id, user_id, status) VALUES (p_event_id, p_user_id, p_status);
  ELSE
    UPDATE public.event_rsvps SET status = p_status WHERE event_id = p_event_id AND user_id = p_user_id;
  END IF;

  SELECT jsonb_build_object('id', r.id, 'event_id', r.event_id, 'user_id', r.user_id, 'status', r.status)
    INTO after_row FROM public.event_rsvps r WHERE r.event_id = p_event_id AND r.user_id = p_user_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'rsvp.upsert', 'rsvp', p_event_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_rsvp_remove(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_event_id UUID, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('eventId', p_event_id, 'userId', p_user_id);
  before_row JSONB;
BEGIN
  SELECT jsonb_build_object('id', r.id, 'event_id', r.event_id, 'user_id', r.user_id, 'status', r.status)
    INTO before_row FROM public.event_rsvps r WHERE r.event_id = p_event_id AND r.user_id = p_user_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'rsvp.remove', 'rsvp', p_event_id, meta, p_correlation_id, 'not_found');
  END IF;

  DELETE FROM public.event_rsvps WHERE event_id = p_event_id AND user_id = p_user_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'rsvp.remove', 'rsvp', p_event_id,
                             p_reason, before_row, NULL, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 7 — Channels
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_channel_create(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_conversation_id UUID, p_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta      JSONB := jsonb_build_object('conversationId', p_conversation_id);
  new_id    UUID;
  after_row JSONB;
  nm        TEXT := btrim(COALESCE(p_name, ''));
  next_ord  INT;
BEGIN
  IF char_length(nm) < 1 OR char_length(nm) > 40 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.create', 'channel', NULL, meta, p_correlation_id, 'invalid_name');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = p_conversation_id) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.create', 'channel', NULL, meta, p_correlation_id, 'conversation_not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.conversation_channels ch
              WHERE ch.conversation_id = p_conversation_id AND lower(ch.name) = lower(nm)) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.create', 'channel', NULL, meta, p_correlation_id, 'duplicate_name');
  END IF;

  SELECT COALESCE(MAX(ch.display_order), 0) + 1 INTO next_ord
    FROM public.conversation_channels ch WHERE ch.conversation_id = p_conversation_id;

  INSERT INTO public.conversation_channels (conversation_id, name, display_order, kind)
  VALUES (p_conversation_id, nm, next_ord, 'topic')
  RETURNING id INTO new_id;

  SELECT jsonb_build_object('id', ch.id, 'conversation_id', ch.conversation_id, 'name', ch.name,
                            'display_order', ch.display_order, 'kind', ch.kind,
                            'post_permission', ch.post_permission)
    INTO after_row FROM public.conversation_channels ch WHERE ch.id = new_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'channel.create', 'channel', new_id,
                             p_reason, NULL, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_channel_rename(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_channel_id UUID, p_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('channelId', p_channel_id);
  before_row JSONB;
  after_row  JSONB;
  nm         TEXT := btrim(COALESCE(p_name, ''));
BEGIN
  IF char_length(nm) < 1 OR char_length(nm) > 40 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.rename', 'channel', p_channel_id, meta, p_correlation_id, 'invalid_name');
  END IF;

  SELECT jsonb_build_object('id', ch.id, 'conversation_id', ch.conversation_id, 'name', ch.name, 'kind', ch.kind)
    INTO before_row FROM public.conversation_channels ch WHERE ch.id = p_channel_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.rename', 'channel', p_channel_id, meta, p_correlation_id, 'not_found');
  END IF;
  IF (before_row ->> 'kind') = 'main' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.rename', 'channel', p_channel_id, meta, p_correlation_id, 'main_channel');
  END IF;

  UPDATE public.conversation_channels SET name = nm WHERE id = p_channel_id;

  SELECT jsonb_build_object('id', ch.id, 'conversation_id', ch.conversation_id, 'name', ch.name, 'kind', ch.kind)
    INTO after_row FROM public.conversation_channels ch WHERE ch.id = p_channel_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'channel.rename', 'channel', p_channel_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_tx_channel_set_permission(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_channel_id UUID, p_permission TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('channelId', p_channel_id, 'permission', p_permission);
  before_row JSONB;
  after_row  JSONB;
BEGIN
  IF p_permission NOT IN ('everyone', 'officers', 'certain') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.setPermission', 'channel', p_channel_id, meta, p_correlation_id, 'invalid_permission');
  END IF;

  SELECT jsonb_build_object('id', ch.id, 'conversation_id', ch.conversation_id, 'name', ch.name,
                            'post_permission', ch.post_permission, 'kind', ch.kind)
    INTO before_row FROM public.conversation_channels ch WHERE ch.id = p_channel_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.setPermission', 'channel', p_channel_id, meta, p_correlation_id, 'not_found');
  END IF;
  -- The Main chat always allows everyone to post; its permission is not editable.
  IF (before_row ->> 'kind') = 'main' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.setPermission', 'channel', p_channel_id, meta, p_correlation_id, 'main_channel');
  END IF;

  UPDATE public.conversation_channels SET post_permission = p_permission WHERE id = p_channel_id;

  SELECT jsonb_build_object('id', ch.id, 'conversation_id', ch.conversation_id, 'name', ch.name,
                            'post_permission', ch.post_permission)
    INTO after_row FROM public.conversation_channels ch WHERE ch.id = p_channel_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'channel.setPermission', 'channel', p_channel_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- Deletes ONLY a channel with no messages, and never the Main chat. Both checks
-- are inside the transaction, so a message arriving concurrently cannot slip
-- past a check made moments earlier in the application process.
CREATE OR REPLACE FUNCTION public.admin_tx_channel_delete_empty(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_channel_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('channelId', p_channel_id);
  before_row JSONB;
  msg_count  BIGINT;
BEGIN
  SELECT jsonb_build_object('id', ch.id, 'conversation_id', ch.conversation_id, 'name', ch.name, 'kind', ch.kind)
    INTO before_row FROM public.conversation_channels ch WHERE ch.id = p_channel_id FOR UPDATE;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.deleteEmpty', 'channel', p_channel_id, meta, p_correlation_id, 'not_found');
  END IF;
  IF (before_row ->> 'kind') = 'main' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.deleteEmpty', 'channel', p_channel_id, meta, p_correlation_id, 'main_channel');
  END IF;

  SELECT count(*) INTO msg_count FROM public.messages m WHERE m.channel_id = p_channel_id;
  IF msg_count > 0 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'channel.deleteEmpty', 'channel', p_channel_id,
                                 meta || jsonb_build_object('message_count', msg_count), p_correlation_id, 'channel_not_empty');
  END IF;

  DELETE FROM public.conversation_channels WHERE id = p_channel_id AND kind <> 'main';

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'channel.deleteEmpty', 'channel', p_channel_id,
                             p_reason, before_row, NULL, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 8 — Notifications
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_notification_set_read(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_notification_id UUID, p_read BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('notificationId', p_notification_id, 'read', p_read);
  before_row JSONB;
  after_row  JSONB;
BEGIN
  SELECT jsonb_build_object('id', n.id, 'user_id', n.user_id, 'type', n.type, 'read', n.read, 'read_at', n.read_at)
    INTO before_row FROM public.notifications n WHERE n.id = p_notification_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'notification.setRead', 'notification', p_notification_id, meta, p_correlation_id, 'not_found');
  END IF;

  UPDATE public.notifications
     SET read = p_read, read_at = CASE WHEN p_read THEN now() ELSE NULL END
   WHERE id = p_notification_id;

  SELECT jsonb_build_object('id', n.id, 'user_id', n.user_id, 'type', n.type, 'read', n.read, 'read_at', n.read_at)
    INTO after_row FROM public.notifications n WHERE n.id = p_notification_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'notification.setRead', 'notification', p_notification_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 9 — Reports
-- ============================================================================
-- Writes reports.status ONLY. content_snapshot / attachment_snapshot / details
-- are never read into the audit payload and never written here, so a moderation
-- action cannot leak reporter-supplied evidence into the trail.

CREATE OR REPLACE FUNCTION public.admin_tx_report_set_status(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_report_id UUID, p_next_status TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('reportId', p_report_id, 'nextStatus', p_next_status);
  before_row JSONB;
  after_row  JSONB;
  cur        TEXT;
BEGIN
  IF p_next_status NOT IN ('pending', 'reviewing', 'resolved', 'dismissed') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.setStatus', 'report', p_report_id, meta, p_correlation_id, 'invalid_status');
  END IF;

  SELECT jsonb_build_object('id', r.id, 'status', r.status, 'entity_type', r.entity_type,
                            'entity_id', r.entity_id, 'reporter_id', r.reporter_id, 'club_id', r.club_id),
         r.status
    INTO before_row, cur
    FROM public.reports r WHERE r.id = p_report_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.setStatus', 'report', p_report_id, meta, p_correlation_id, 'not_found');
  END IF;

  IF cur = p_next_status THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.setStatus', 'report', p_report_id, meta, p_correlation_id, 'no_change');
  END IF;

  -- The canonical transition matrix, identical to REPORT_TRANSITIONS in
  -- lib/admin/reportsData.ts. Resolved and dismissed are NOT dead ends: a
  -- report can be reopened to `pending`, which is the whole point of having a
  -- moderation queue you can revisit.
  IF NOT (
       (cur = 'pending'   AND p_next_status IN ('reviewing', 'resolved', 'dismissed'))
    OR (cur = 'reviewing' AND p_next_status IN ('resolved', 'dismissed', 'pending'))
    OR (cur = 'resolved'  AND p_next_status = 'pending')
    OR (cur = 'dismissed' AND p_next_status = 'pending')
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.setStatus', 'report', p_report_id, meta, p_correlation_id, 'invalid_transition');
  END IF;

  UPDATE public.reports SET status = p_next_status WHERE id = p_report_id;

  SELECT jsonb_build_object('id', r.id, 'status', r.status, 'entity_type', r.entity_type,
                            'entity_id', r.entity_id, 'reporter_id', r.reporter_id, 'club_id', r.club_id)
    INTO after_row FROM public.reports r WHERE r.id = p_report_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'report.setStatus', 'report', p_report_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 10 — Club reactivation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_club_reactivate(
  p_actor_id UUID, p_actor_email TEXT, p_reason TEXT, p_correlation_id UUID,
  p_club_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id);
  before_row JSONB;
  after_row  JSONB;
BEGIN
  SELECT jsonb_build_object('id', c.id, 'name', c.name, 'handle', c.handle, 'is_active', c.is_active)
    INTO before_row FROM public.clubs c WHERE c.id = p_club_id;
  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'deletedContent.reactivateClub', 'club', p_club_id, meta, p_correlation_id, 'not_found');
  END IF;
  IF (before_row ->> 'is_active')::BOOLEAN THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'deletedContent.reactivateClub', 'club', p_club_id, meta, p_correlation_id, 'already_active');
  END IF;

  UPDATE public.clubs SET is_active = TRUE WHERE id = p_club_id;

  SELECT jsonb_build_object('id', c.id, 'name', c.name, 'handle', c.handle, 'is_active', c.is_active)
    INTO after_row FROM public.clubs c WHERE c.id = p_club_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'deletedContent.reactivateClub', 'club', p_club_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$$;


-- ============================================================================
-- SECTION 11 — Privileges
-- ============================================================================
-- Executable by service_role ONLY. anon and authenticated get nothing: a
-- browser cannot reach any of these, even with a valid founder session.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_tx\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;

-- The private helpers are not in an exposed schema and are callable by nobody
-- but their SECURITY DEFINER callers.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname LIKE 'admin\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', fn.sig);
  END LOOP;
END $$;


-- ============================================================================
-- ROLLBACK (manual)
-- ============================================================================
--   DO $$ DECLARE fn RECORD; BEGIN
--     FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND p.proname LIKE 'admin\_tx\_%' LOOP
--       EXECUTE format('DROP FUNCTION %s', fn.sig);
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS private.admin_tx_ok(UUID,TEXT,TEXT,TEXT,UUID,TEXT,JSONB,JSONB,JSONB,UUID);
--   DROP FUNCTION IF EXISTS private.admin_tx_fail(UUID,TEXT,TEXT,TEXT,UUID,JSONB,UUID,TEXT);
--   DROP FUNCTION IF EXISTS private.admin_snap_member(UUID,UUID);
--   DROP FUNCTION IF EXISTS private.admin_snap_officer(UUID,UUID);
-- Dropping these reverts admin mutations to the non-atomic 055 path; it does not
-- affect any recorded audit history.
-- ============================================================================
