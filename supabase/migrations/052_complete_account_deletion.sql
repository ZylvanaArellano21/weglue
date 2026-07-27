-- ─────────────────────────────────────────────────────────────────────────────
-- 052 — Complete, permanent account deletion  (App Store Guideline 5.1.1(v))
--
-- WHY
--
-- 044 made deletion ATOMIC: one transaction, `DELETE FROM auth.users`, cascade.
-- That fixed the ghost-account class of bug and is kept exactly as-is here.
-- What 044 did NOT do is cover every place a user's personal data lives. A full
-- audit of the live schema (every FK into public.profiles / auth.users, plus
-- every user-shaped column with NO FK at all) found seven residues that
-- survived a "successful" deletion:
--
--   1. deletion_requests.email        — the address typed into the public web
--                                       form. No FK, so nothing ever removed it.
--   2. events.specific_user_ids[]     — the deleted user's uuid stayed inside
--                                       OTHER users' event audience arrays.
--   3. notifications.group_actors[]   — same, inside OTHER users' grouped
--                                       notifications (actor_id cascades, the
--                                       array does not).
--   4. reports.reporter_email /
--      reports.reporter_username      — direct identifiers snapshotted at
--                                       report time. reporter_id is SET NULL by
--                                       the FK; these two were not.
--   5. club_officers                  — SET NULL left an officer row with a NULL
--                                       user: a dangling grant, not a deletion.
--   6. chat_invitations               — SET NULL left a LIVE join token with no
--                                       owner.
--   7. club_photos (direct uploads)   — SET NULL left the user's uploaded image
--                                       in the gallery and its object in
--                                       Storage forever. (Photos derived from a
--                                       post already die with the post via
--                                       club_photos.post_id ON DELETE CASCADE.)
--
-- STORAGE
--
-- Object storage is not transactional and must never be able to roll back a
-- database deletion — 044's reasoning, unchanged. What changes is WHERE the
-- object list comes from. It used to be assembled by the Edge Function in a
-- separate pre-pass over two buckets (avatars, posts), which could not see the
-- club-photo or chat-attachment objects and raced its own second read.
--
-- The function now returns the paths it is about to orphan, computed inside the
-- transaction from the rows themselves, immediately before they are destroyed.
-- One source of truth, no race, nothing missed. The Edge Function removes them
-- after the commit and — exactly as before — still reports success if that
-- sweep fails, because the account really is gone and trapping the user in a
-- non-existent account would be strictly worse than an orphaned file.
--
-- DELIBERATELY RETAINED  (documented in the privacy policy and in the in-app
-- deletion copy — we never claim to delete something we keep)
--
--   • messages in conversations that still have OTHER participants: sender_id
--     is SET NULL by the FK, so the thread other people lived through stays
--     readable and is permanently disconnected from the deleted user. Messages
--     in solo threads (nobody left to read them) are hard-deleted, attachments
--     and all. This is 044's semantics, unchanged.
--   • conversations.created_by / conversation_channels.created_by /
--     channel_posters.added_by: SET NULL. Shared containers survive their
--     creator, anonymized.
--   • reports: the report body, snapshot and message_sender_id are kept as
--     abuse/safety evidence — the minimum needed for moderation to remain
--     meaningful after a reporter deletes their account — with every direct
--     identifier of the reporter removed (id, email, username).
--
-- SECURITY  (unchanged from 044)
--
-- SECURITY DEFINER so it may touch auth.users, but the target is ALWAYS
-- auth.uid() and never an argument, so a caller can only ever delete themself.
-- No service-role key is needed by the caller and the client never sees one.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- PART A — public URL → storage object path
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `.../storage/v1/object/public/<bucket>/<path>` → `<path>`; NULL when the URL
-- does not belong to that bucket (external or already-migrated URLs), so a
-- foreign URL can never be handed to storage.remove().

CREATE OR REPLACE FUNCTION public.storage_path_from_public_url(
  p_url    TEXT,
  p_bucket TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_marker TEXT := '/storage/v1/object/public/' || p_bucket || '/';
  v_at     INT;
  v_path   TEXT;
BEGIN
  IF p_url IS NULL OR p_bucket IS NULL THEN
    RETURN NULL;
  END IF;

  v_at := position(v_marker IN p_url);
  IF v_at = 0 THEN
    RETURN NULL;
  END IF;

  v_path := substring(p_url FROM v_at + length(v_marker));
  -- Drop any ?token=/&t= cache-buster so the path matches the real object key.
  v_path := split_part(v_path, '?', 1);

  IF v_path IS NULL OR v_path = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_path;
END;
$$;

REVOKE ALL     ON FUNCTION public.storage_path_from_public_url(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.storage_path_from_public_url(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.storage_path_from_public_url(TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.storage_path_from_public_url(TEXT, TEXT) IS
  'Extracts the object key from a Supabase public storage URL for a given bucket; '
  'NULL when the URL is not in that bucket.';


-- ═════════════════════════════════════════════════════════════════════════════
-- PART B — delete_own_account_atomic(): now returns the Storage paths to sweep
-- ═════════════════════════════════════════════════════════════════════════════
--
-- The return type changes void → jsonb, so this is a DROP + CREATE rather than
-- a CREATE OR REPLACE. Both statements run inside this migration's transaction,
-- so the function is never missing for a concurrent caller.
--
-- Backwards compatible with the deployed Edge Function: supabase-js ignores an
-- unread RPC result, so an older function body that calls this and only checks
-- `error` keeps working unchanged while the new one reads the paths.

DROP FUNCTION IF EXISTS public.delete_own_account_atomic();

CREATE FUNCTION public.delete_own_account_atomic()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_avatars      TEXT[] := ARRAY[]::TEXT[];
  v_posts        TEXT[] := ARRAY[]::TEXT[];
  v_club_photos  TEXT[] := ARRAY[]::TEXT[];
  v_attachments  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  -- ── 1. Collect Storage object keys while the rows still point at them ──────
  -- Read-only; everything below is computed from rows that are about to be
  -- destroyed in this same transaction, so the list can neither race a
  -- concurrent write nor miss a row.

  -- Avatar. avatar_type = 'text' means an initials avatar — no object exists.
  SELECT COALESCE(
           array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),
           ARRAY[]::TEXT[]
         )
    INTO v_avatars
    FROM (
      SELECT public.storage_path_from_public_url(pr.avatar_url, 'avatars') AS p
      FROM   public.profiles pr
      WHERE  pr.id = v_uid
        AND  pr.avatar_url IS NOT NULL
        AND  COALESCE(pr.avatar_type, '') <> 'text'
    ) s;

  -- Post images (posts cascade from the profile).
  SELECT COALESCE(
           array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),
           ARRAY[]::TEXT[]
         )
    INTO v_posts
    FROM (
      SELECT public.storage_path_from_public_url(po.image_url, 'posts') AS p
      FROM   public.posts po
      WHERE  po.author_id = v_uid
        AND  po.image_url IS NOT NULL
    ) s;

  -- Club-gallery photos the user uploaded. The bucket filter is what separates
  -- the two kinds: a gallery upload lives in `club-photos`, while a photo
  -- materialized from a post still points at the `posts` object and therefore
  -- returns NULL here — its key is already in v_posts, so it is never listed
  -- twice or swept from the wrong bucket.
  SELECT COALESCE(
           array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),
           ARRAY[]::TEXT[]
         )
    INTO v_club_photos
    FROM (
      SELECT public.storage_path_from_public_url(cp.url, 'club-photos') AS p
      FROM   public.club_photos cp
      WHERE  cp.uploaded_by = v_uid
        AND  cp.url IS NOT NULL
    ) s;

  -- Attachments on messages that are about to be HARD-deleted (solo threads).
  -- Attachments on messages that survive anonymized stay, exactly like their
  -- message text — removing them would punch holes in other people's history.
  -- attachment_url is already a bucket-relative key, not a public URL.
  SELECT COALESCE(
           array_agg(DISTINCT m.attachment_url),
           ARRAY[]::TEXT[]
         )
    INTO v_attachments
    FROM public.messages m
    WHERE m.sender_id = v_uid
      AND m.attachment_url IS NOT NULL
      AND NOT EXISTS (
            SELECT 1
            FROM   public.conversation_participants cp
            WHERE  cp.conversation_id = m.conversation_id
              AND  cp.user_id <> v_uid
          );

  -- ── 2. Residues with no FK: scrub the uuid out of other users' rows ───────
  UPDATE public.events
  SET    specific_user_ids = array_remove(specific_user_ids, v_uid)
  WHERE  specific_user_ids IS NOT NULL
    AND  v_uid = ANY (specific_user_ids);

  UPDATE public.notifications
  SET    group_actors = array_remove(group_actors, v_uid),
         group_count  = GREATEST(
                          COALESCE(array_length(array_remove(group_actors, v_uid), 1), 0),
                          0
                        )
  WHERE  group_actors IS NOT NULL
    AND  v_uid = ANY (group_actors);

  -- The deletion request the user may have filed from the public web form.
  IF v_email IS NOT NULL THEN
    DELETE FROM public.deletion_requests dr
    WHERE  lower(dr.email) = lower(v_email);
  END IF;

  -- ── 3. Moderation evidence: keep the report, drop the reporter's identity ─
  -- reporter_id is nulled here rather than left to the FK's SET NULL, for the
  -- ordering reason documented at step 6.
  UPDATE public.reports r
  SET    reporter_id       = NULL,
         reporter_email    = NULL,
         reporter_username = NULL
  WHERE  r.reporter_id = v_uid;

  -- ── 4. Rows the FK would have left dangling with a NULL owner ─────────────
  -- An officer grant with no user, a live invite token with no creator, and a
  -- post-permission grant for a user who no longer exists are not "anonymized
  -- shared content" — they are orphans. Delete them.
  DELETE FROM public.club_officers    WHERE user_id    = v_uid;
  DELETE FROM public.chat_invitations WHERE created_by = v_uid;
  DELETE FROM public.channel_posters  WHERE user_id    = v_uid;

  -- Every club-gallery photo connected to this user: the ones they uploaded
  -- straight into the gallery AND the ones materialized from their own posts.
  DELETE FROM public.club_photos cp
  WHERE  cp.uploaded_by = v_uid
     OR  cp.post_id IN (SELECT p.id FROM public.posts p WHERE p.author_id = v_uid);

  -- ── 5. Solo-thread messages (044, unchanged) ──────────────────────────────
  -- Nobody else is in the thread, so hard-delete rather than leave anonymized
  -- orphans. Must run BEFORE the SET NULL sweep below, while sender_id still
  -- points at this user.
  DELETE FROM public.messages m
  WHERE  m.sender_id = v_uid
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.conversation_participants cp
           WHERE  cp.conversation_id = m.conversation_id
             AND  cp.user_id <> v_uid
         );

  -- ── 6. Pre-empt EVERY ON DELETE SET NULL back-reference ───────────────────
  --
  -- THIS IS A BUG FIX, not tidiness. Deleting the profile fires two kinds of
  -- referential action at once: CASCADE deletes (posts, events, …) and SET NULL
  -- updates (club_photos.uploaded_by, messages.sender_id, …). Postgres does not
  -- order them relative to each other, and a SET NULL update re-validates the
  -- OTHER foreign keys on the row it rewrites. When the row it rewrites also
  -- points at something the cascade has already removed, that re-validation
  -- fails and the whole deletion aborts.
  --
  -- Reproduced on the live schema: a user with a single club post could not be
  -- deleted at all —
  --   ERROR 23503: insert or update on table "club_photos" violates foreign key
  --   constraint "club_photos_post_id_fkey" … CONTEXT: DELETE FROM auth.users
  -- because club_photos.uploaded_by SET NULL rewrote a row whose post_id had
  -- just been cascade-deleted. messages carries the same shape via
  -- shared_post_id / shared_event_id.
  --
  -- 044's transaction was doing its job perfectly here: it rolled the failure
  -- back and left the account intact. The user simply saw "Could not delete
  -- your account" every single time — which is exactly the App Store 5.1.1(v)
  -- symptom, an in-app deletion option that does not actually delete.
  --
  -- Performing every SET NULL explicitly, first, means no referential UPDATE is
  -- still in flight when the cascade runs, so nothing can be re-validated
  -- against a half-removed graph. The end state is identical to what the FKs
  -- would have produced; only the ordering is now deterministic.
  UPDATE public.messages SET sender_id  = NULL WHERE sender_id  = v_uid;
  UPDATE public.messages SET deleted_by = NULL WHERE deleted_by = v_uid;
  UPDATE public.messages m SET shared_post_id = NULL
   WHERE m.shared_post_id IN (SELECT p.id FROM public.posts p WHERE p.author_id = v_uid);
  UPDATE public.messages m SET shared_event_id = NULL
   WHERE m.shared_event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = v_uid);
  UPDATE public.conversations         SET created_by = NULL WHERE created_by = v_uid;
  UPDATE public.conversation_channels SET created_by = NULL WHERE created_by = v_uid;
  UPDATE public.channel_posters       SET added_by   = NULL WHERE added_by   = v_uid;

  -- ── 7. The whole account, in one statement, in this transaction ───────────
  -- Cascades to profiles and every user-owned table. Every SET NULL it would
  -- have performed has already been applied above, so this is now pure deletes.
  DELETE FROM auth.users WHERE id = v_uid;

  RETURN jsonb_build_object(
    'avatars',          to_jsonb(v_avatars),
    'posts',            to_jsonb(v_posts),
    'club-photos',      to_jsonb(v_club_photos),
    'chat-attachments', to_jsonb(v_attachments)
  );
END;
$$;

-- REVOKE FROM PUBLIC is NOT enough on this project: Supabase ships
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role`, so a freshly CREATEd function carries an
-- EXPLICIT anon grant that a PUBLIC revoke cannot touch. anon could not
-- actually delete anything (auth.uid() is NULL, so the function raises), but a
-- deletion entry point should not be reachable by an unauthenticated role at
-- all. Verified by test 11b, which failed until this line existed.
REVOKE ALL     ON FUNCTION public.delete_own_account_atomic() FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.delete_own_account_atomic() FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_own_account_atomic() TO authenticated;

COMMENT ON FUNCTION public.delete_own_account_atomic() IS
  'Permanently deletes the calling user''s account and all owned data in a single '
  'transaction, and returns the Storage object keys the caller must sweep, keyed '
  'by bucket. Target is always auth.uid(); a caller can only delete themself. '
  'Idempotent by construction: a second call from the same session finds no user '
  'and raises Not authenticated, and a failed call rolls back to a fully intact '
  'account, so retrying is always safe.';


-- ═════════════════════════════════════════════════════════════════════════════
-- PART C — retire the legacy delete_own_user_data()
-- ═════════════════════════════════════════════════════════════════════════════
--
-- This function deletes every data row and then STOPS: auth.users survives and
-- can still sign in with no profile — the "Unknown User" ghost account 044 was
-- written to make impossible. It has been grantable to `authenticated` and
-- `anon` this whole time, so any signed-in user could self-inflict it directly
-- through PostgREST, bypassing the Edge Function entirely.
--
-- Safe to retire NOW, verified against released-client history rather than
-- assumed: every shipped build calls the `delete-account` Edge Function and
-- nothing else. Checked at v1.0.0, at b352d050 (iOS build 22, the binary
-- currently in App Store review) and at 75290a84 (Android build 26, the binary
-- currently in Play closed testing) — all three invoke
-- supabase.functions.invoke('delete-account'); none references
-- delete_own_user_data. The Edge Function itself has called
-- delete_own_account_atomic since 2026-07-13.
--
-- Dropping it outright would break any straggler with a hard fail and no
-- explanation, so it keeps its name and hard-fails loudly instead — and loses
-- its grants, which is what actually closes the hole.

CREATE OR REPLACE FUNCTION public.delete_own_user_data()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'delete_own_user_data() is retired: it deleted user data WITHOUT deleting '
    'the auth account, which left a signed-in user with no profile. Use the '
    'delete-account Edge Function, which calls delete_own_account_atomic().'
    USING ERRCODE = '0A000';
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_user_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_own_user_data() FROM anon;
REVOKE ALL ON FUNCTION public.delete_own_user_data() FROM authenticated;

COMMENT ON FUNCTION public.delete_own_user_data() IS
  'RETIRED (052). Always raises. Left in place so a straggler caller fails loudly '
  'instead of silently resolving to a missing function. Superseded by '
  'delete_own_account_atomic().';


-- ═════════════════════════════════════════════════════════════════════════════
-- PART D — retire the Microsoft-only OAuth onboarding RPC
-- ═════════════════════════════════════════════════════════════════════════════
--
-- complete_oauth_onboarding() exists only to finish onboarding for an account
-- created by an OAuth provider. Microsoft was the only provider We Glue ever
-- enabled, and it is now removed from the apps and disabled in GoTrue, so no
-- account can reach this path again. The function body stays (it is referenced
-- by 047's history and is harmless), but `authenticated` loses EXECUTE: leaving
-- a callable RPC that can flip onboarding_completed and claim a username is
-- attack surface with no remaining caller.
--
-- Password accounts were never affected: handle_new_user sets
-- onboarding_completed = true at creation for them, so this RPC only ever
-- returned 'already_completed'.

REVOKE ALL ON FUNCTION public.complete_oauth_onboarding(TEXT, TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_oauth_onboarding(TEXT, TEXT[], TEXT[]) FROM anon;
REVOKE ALL ON FUNCTION public.complete_oauth_onboarding(TEXT, TEXT[], TEXT[]) FROM authenticated;

COMMENT ON FUNCTION public.complete_oauth_onboarding(TEXT, TEXT[], TEXT[]) IS
  'RETIRED (052). No OAuth provider is enabled — We Glue uses its own '
  'email/password account system exclusively. EXECUTE revoked from all roles.';
