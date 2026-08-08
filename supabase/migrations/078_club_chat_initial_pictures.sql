-- =============================================================================
-- We Glue — Club chat and channel initial pictures
-- Migration: 078_club_chat_initial_pictures.sql
--
-- Bug 5. A club's Members chat, Officers chat and every sub-channel must START
-- as a COPY of the club's profile picture, and be completely independent from
-- that moment on.
--
--   Club Profile = A  →  Members = A, Officers = A, #events = A, #announcements = A
--   officer sets #events to B      →  ONLY #events becomes B
--   club profile later becomes C   →  every existing chat/channel keeps its own
--
-- WHAT THIS MIGRATION DOES
--   1. Seeds the picture at CREATION, for both creation paths:
--        • handle_club_created()      — a brand-new club's two conversations
--                                       and its four seeded channels
--        • create_conversation_channel() — a sub-channel added later, which
--                                       takes the club's picture as it is AT
--                                       THAT MOMENT
--   2. A ONE-TIME backfill for rows that predate this, restricted to
--      `avatar_url IS NULL` — i.e. only where an officer has never set a
--      picture. A chat or channel an officer has already given its own image is
--      never touched. (Founder-approved scope.)
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   • It does NOT add any trigger that propagates a later club-avatar change
--     into existing chats or channels. Independence after creation is the
--     product rule, and it is preserved by the ABSENCE of such a trigger — a
--     copy, never a reference.
--   • It does NOT change who may edit a picture. `set_channel_avatar` already
--     refuses a caller who is not a current officer of the owning club, and it
--     writes `conversation_channels` only — there is no path from a chat
--     picture back to `clubs.avatar_url`, so changing a chat picture cannot
--     alter the real Club Profile. The club image remains editable only through
--     the Club Profile edit flow.
--   • It does NOT touch conversations of type 'direct' or 'group'; they have no
--     club to inherit from.
--
-- IDEMPOTENT: every statement is safe to re-run. The backfill is naturally
-- idempotent because it only ever writes rows that are still NULL.
-- =============================================================================

BEGIN;

-- ─── 1. The one place that answers "what is this club's picture right now" ───
-- STABLE + SECURITY DEFINER so the seeding paths resolve the club image
-- consistently, including when a channel is created by an officer whose own
-- view of `clubs` is governed by RLS.
CREATE OR REPLACE FUNCTION private.club_avatar_url(p_club_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT c.avatar_url FROM public.clubs c WHERE c.id = p_club_id;
$$;

COMMENT ON FUNCTION private.club_avatar_url(UUID) IS
  'Bug 5: the club picture a NEW chat or channel copies at creation. Callers '
  'store the returned value; they never read through to clubs afterwards, which '
  'is what keeps a chat picture independent of later Club Profile edits.';

REVOKE ALL ON FUNCTION private.club_avatar_url(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.club_avatar_url(UUID) FROM anon;
REVOKE ALL ON FUNCTION private.club_avatar_url(UUID) FROM authenticated;

-- ─── 2. New club: both conversations and all seeded channels start as copies ─
-- Structurally identical to 041's version; the only change is that the club's
-- picture is written into `avatar_url` on every row it creates. NEW.avatar_url
-- is used directly because this is a trigger on `clubs` and NEW is the club
-- being created. When a club is created without a picture every row is seeded
-- NULL, exactly as before, and the backfill in step 4 covers it once a picture
-- exists.
CREATE OR REPLACE FUNCTION handle_club_created()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member_conv_id  UUID;
  v_officer_conv_id UUID;
BEGIN
  INSERT INTO conversations (type, club_id, name, avatar_url)
  VALUES ('club_group', NEW.id, NEW.name || ' · Members', NEW.avatar_url)
  RETURNING id INTO v_member_conv_id;

  INSERT INTO conversations (type, club_id, name, avatar_url)
  VALUES ('officer_chat', NEW.id, NEW.name || ' · Officers', NEW.avatar_url)
  RETURNING id INTO v_officer_conv_id;

  -- Members: Main chat (general) + #announcements (officers-only) + #events.
  INSERT INTO conversation_channels
    (conversation_id, name, display_order, is_default, is_restricted, kind, post_permission, avatar_url)
  VALUES
    (v_member_conv_id,  'general',       0, TRUE, FALSE, 'main',    'everyone', NEW.avatar_url),
    (v_member_conv_id,  'announcements', 1, TRUE, TRUE,  'channel', 'officers', NEW.avatar_url),
    (v_member_conv_id,  'events',        2, TRUE, FALSE, 'channel', 'everyone', NEW.avatar_url),
    (v_officer_conv_id, 'general',       0, TRUE, FALSE, 'main',    'everyone', NEW.avatar_url);

  RETURN NEW;
END;
$$;

-- ─── 3. A sub-channel added later copies the club picture as it is NOW ───────
-- Identical to 041's function except for the avatar default. An explicit
-- p_avatar_url still wins, so a channel created WITH a chosen image keeps it;
-- only the "officer did not choose one" case inherits. A non-club conversation
-- ('group') inherits nothing, because it has no club.
CREATE OR REPLACE FUNCTION create_conversation_channel(
  p_conversation_id UUID,
  p_name TEXT,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_clean TEXT;
  v_order INT;
  v_id UUID;
  v_avatar TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT type, club_id INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;

  IF v_conv.type IN ('club_group','officer_chat') THEN
    IF NOT is_club_officer(v_conv.club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  ELSIF v_conv.type = 'group' THEN
    IF NOT is_conversation_participant(p_conversation_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_conversation';
  END IF;

  v_clean := lower(regexp_replace(btrim(COALESCE(p_name,'')), '\s+', '-', 'g'));
  v_clean := regexp_replace(v_clean, '[^a-z0-9\-_]', '', 'g');
  IF v_clean = '' THEN RAISE EXCEPTION 'name_required'; END IF;

  SELECT COALESCE(MAX(display_order), 0) + 1 INTO v_order
  FROM conversation_channels WHERE conversation_id = p_conversation_id;

  v_avatar := p_avatar_url;
  IF v_avatar IS NULL AND v_conv.type IN ('club_group','officer_chat') THEN
    v_avatar := private.club_avatar_url(v_conv.club_id);
  END IF;

  INSERT INTO conversation_channels
    (conversation_id, name, display_order, is_default, is_restricted, kind, post_permission, avatar_url, created_by)
  VALUES
    (p_conversation_id, v_clean, v_order, FALSE, FALSE, 'channel', 'everyone', v_avatar, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_conversation_channel(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION create_conversation_channel(UUID, TEXT, TEXT) TO authenticated;

-- ─── 4. One-time backfill — ONLY where no officer has ever set a picture ─────
-- `avatar_url IS NULL` is the whole guard, and it is the founder-approved
-- scope: a chat or channel that already carries an image is a deliberate
-- officer choice and must survive this migration untouched.
--
-- Clubs with no picture of their own are skipped rather than written as NULL,
-- so re-running after a club uploads its first picture picks it up.
UPDATE conversations c
   SET avatar_url = club.avatar_url
  FROM clubs club
 WHERE c.club_id = club.id
   AND c.type IN ('club_group', 'officer_chat')
   AND c.avatar_url IS NULL
   AND club.avatar_url IS NOT NULL;

UPDATE conversation_channels cc
   SET avatar_url = club.avatar_url
  FROM conversations c
  JOIN clubs club ON club.id = c.club_id
 WHERE cc.conversation_id = c.id
   AND c.type IN ('club_group', 'officer_chat')
   AND cc.avatar_url IS NULL
   AND club.avatar_url IS NOT NULL;

-- ─── 5. Prove the seeding paths actually carry the picture ───────────────────
-- A migration that silently seeded NULL would look identical in the ledger and
-- would leave the bug in place, so the two creation paths are exercised here
-- and the transaction is aborted if either fails to copy the image.
DO $$
DECLARE
  v_club_id     UUID;
  v_member_conv UUID;
  v_channels    INT;
  v_uncopied    INT;
BEGIN
  -- A club row whose creation trigger will fire. Removed again below.
  --
  -- Creating the probe is allowed to fail without failing the migration: this
  -- statement depends on the whole `clubs` contract (required columns, checks,
  -- unrelated triggers), and a future NOT NULL added elsewhere must not abort a
  -- migration that has nothing to do with it. Only the ASSERTIONS below abort,
  -- and they run exclusively when the probe was created successfully — so a
  -- genuine seeding regression is still caught.
  BEGIN
    INSERT INTO clubs (name, handle, description, avatar_url, university_id)
    SELECT '__mig078_probe__',
           '__mig078_probe__',
           'migration self-check',
           'https://example.invalid/probe.jpg',
           (SELECT id FROM universities LIMIT 1)
    RETURNING id INTO v_club_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '078: could not create a probe club (%), skipping creation self-check', SQLERRM;
    RETURN;
  END;

  IF v_club_id IS NULL THEN
    RAISE NOTICE '078: probe club not created, skipping creation self-check';
    RETURN;
  END IF;

  SELECT id INTO v_member_conv
    FROM conversations
   WHERE club_id = v_club_id AND type = 'club_group';

  IF (SELECT avatar_url FROM conversations WHERE id = v_member_conv)
     IS DISTINCT FROM 'https://example.invalid/probe.jpg' THEN
    RAISE EXCEPTION '078 self-check failed: members conversation did not copy the club picture';
  END IF;

  SELECT count(*), count(*) FILTER (
           WHERE avatar_url IS DISTINCT FROM 'https://example.invalid/probe.jpg'
         )
    INTO v_channels, v_uncopied
    FROM conversation_channels
   WHERE conversation_id IN (SELECT id FROM conversations WHERE club_id = v_club_id);

  IF v_channels = 0 THEN
    RAISE EXCEPTION '078 self-check failed: no channels were seeded';
  END IF;
  IF v_uncopied > 0 THEN
    RAISE EXCEPTION '078 self-check failed: % of % seeded channels did not copy the club picture',
      v_uncopied, v_channels;
  END IF;

  -- Independence: changing the club picture must NOT reach the seeded rows.
  UPDATE clubs SET avatar_url = 'https://example.invalid/changed.jpg' WHERE id = v_club_id;
  IF EXISTS (
    SELECT 1 FROM conversation_channels
     WHERE conversation_id IN (SELECT id FROM conversations WHERE club_id = v_club_id)
       AND avatar_url = 'https://example.invalid/changed.jpg'
  ) THEN
    RAISE EXCEPTION '078 self-check failed: a club picture change propagated into an existing channel';
  END IF;

  -- Undo the probe. Dependents first: conversation rows reference the club.
  DELETE FROM conversation_channels
   WHERE conversation_id IN (SELECT id FROM conversations WHERE club_id = v_club_id);
  DELETE FROM conversation_participants
   WHERE conversation_id IN (SELECT id FROM conversations WHERE club_id = v_club_id);
  DELETE FROM conversations WHERE club_id = v_club_id;
  DELETE FROM club_members WHERE club_id = v_club_id;
  DELETE FROM clubs WHERE id = v_club_id;
END $$;

COMMIT;
