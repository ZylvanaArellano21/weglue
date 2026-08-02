-- ===========================================================================
-- 062 — Private accounts: personal posts become follower-only
--
-- THE GAP THIS CLOSES
--   Since migration 001 the posts SELECT policy has been:
--       CREATE POLICY "posts: anyone authenticated can read"
--         ON posts FOR SELECT TO authenticated USING (true);
--   `is_private` appeared in NO policy anywhere in the schema. It gated only
--   the follow handshake (followService sets status='pending') and what the
--   two clients chose to render.
--
--   The consequence was not merely theoretical. Home → Posts on BOTH platforms
--   queries every picture post from the viewer's university with no follow and
--   no membership requirement, reads `user_privacy.is_private` purely to label
--   the Follow button, and never filters on it. So a private student's PERSONAL
--   posts were served to every student on their campus, and to any raw
--   PostgREST request, while:
--     • the Privacy Center told them "Your profile is Private"; and
--     • their own profile page showed non-followers a padlock reading
--       "Follow to see their posts and events".
--   The product promised follower-only and the database delivered campus-wide.
--
-- THE RULE THIS INSTALLS  (personal vs official, per migration 057)
--   057 established the project's canonical distinction and this migration
--   reuses it verbatim rather than inventing a second one:
--       posts.club_id IS NULL      → PERSONAL / social content
--       posts.club_id IS NOT NULL  → OFFICIAL club content, ALWAYS VISIBLE
--   A student must not lose a club's announcements, events or safety
--   information, so a post the author deliberately published into a club stays
--   visible even when its author is private — exactly as it stays visible when
--   its author is blocked.
--
--   A personal post is therefore readable when ANY of:
--     1. you are its author;
--     2. its author is not private;
--     3. you are an ACCEPTED follower of its author.
--   A pending (requested) follow grants nothing, which is the whole point of a
--   private account.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No student-block filtering on posts. 057 forbids that by name: its
--     `users_may_interact()` is row-correlated and is documented as "NEVER put
--     it in a policy on profiles / posts / messages / notifications". Blocking
--     stays where 057 put it.
--   * No change to INSERT / UPDATE / DELETE on posts.
--   * No change to post_comments, post_likes or post_club_tags. A comment on a
--     now-unreadable post is orphaned, not leaked: it carries no post content.
--   * No administrator behaviour change. The Admin Dashboard reads through
--     service_role, which is BYPASSRLS, so moderation still sees every post.
--   * No client change is REQUIRED. Both apps already handle an absent post
--     (web PostModal renders its unavailable state; the profile grid simply
--     receives fewer rows).
--
-- PERFORMANCE CONTRACT
--   `(SELECT auth.uid())` is wrapped so PostgreSQL evaluates it once per
--   statement as an InitPlan instead of once per row — the same pattern 057
--   documents. Both correlated probes are single-row index lookups, and the two
--   partial indexes below keep them on tiny indexes because private accounts
--   and accepted follows are the minority and the common shape respectively.
--   Clauses are ordered cheapest-first: the author check and the club check are
--   column tests that short-circuit before any subquery runs.
--
-- ROLLBACK
--   Fully reversible, no data is written or destroyed:
--     BEGIN;
--       DROP POLICY IF EXISTS "posts: read respecting private accounts" ON public.posts;
--       CREATE POLICY "posts: anyone authenticated can read"
--         ON public.posts FOR SELECT TO authenticated USING (true);
--     COMMIT;
--   The two indexes are additive and may be left in place; they are harmless
--   without the policy.
--
-- MOBILE COMPATIBILITY
--   Backward compatible with the shipped iOS and Android builds. No column,
--   table, RPC signature or return shape changes. Older clients simply receive
--   fewer rows for private authors — which is the corrected behaviour, and the
--   state their UI already renders for a private profile.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Supporting indexes (created BEFORE the policy so the first query that
--    runs under the new policy already has them).
-- ---------------------------------------------------------------------------

-- Private accounts are the minority, so a partial index keeps the "is this
-- author private?" probe on a very small index. `user_privacy.user_id` is
-- already UNIQUE; this narrows that probe to only the rows that can match.
CREATE INDEX IF NOT EXISTS idx_user_privacy_is_private
  ON public.user_privacy (user_id)
  WHERE is_private;

-- The accepted-follower probe is (follower_id, following_id) filtered to
-- accepted, which this serves as an index-only lookup.
CREATE INDEX IF NOT EXISTS idx_follows_accepted_pair
  ON public.follows (follower_id, following_id)
  WHERE status = 'accepted';

-- ---------------------------------------------------------------------------
-- 2. The policy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "posts: anyone authenticated can read"     ON public.posts;
DROP POLICY IF EXISTS "posts: read respecting private accounts"  ON public.posts;

CREATE POLICY "posts: read respecting private accounts"
  ON public.posts FOR SELECT
  TO authenticated
  USING (
    -- 1. Your own posts, always — including while your account is private.
    author_id = (SELECT auth.uid())

    -- 2. Official club content is always visible (migration 057's rule).
    OR club_id IS NOT NULL

    -- 3. Personal post whose author is not private.
    --    `user_privacy` is readable by every authenticated user (migration
    --    026 replaced the original "read own" policy precisely so predicates
    --    like this one resolve instead of silently matching nothing).
    OR NOT EXISTS (
      SELECT 1
        FROM public.user_privacy up
       WHERE up.user_id = posts.author_id
         AND up.is_private
    )

    -- 4. Personal post whose author is private, read by an ACCEPTED follower.
    --    A pending request deliberately does not qualify.
    OR EXISTS (
      SELECT 1
        FROM public.follows f
       WHERE f.follower_id  = (SELECT auth.uid())
         AND f.following_id = posts.author_id
         AND f.status       = 'accepted'
    )
  );

COMMENT ON POLICY "posts: read respecting private accounts" ON public.posts IS
  'A private account''s PERSONAL posts (club_id IS NULL) are readable only by '
  'the author and their accepted followers. Official club posts '
  '(club_id IS NOT NULL) stay visible to everyone, matching migration 057''s '
  'personal-vs-official rule. A pending follow request grants no access.';

COMMIT;
