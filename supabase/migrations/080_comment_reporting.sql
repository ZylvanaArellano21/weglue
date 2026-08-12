-- 080: Comment reporting.
--
-- Comments were the one user-generated content type with no report path at
-- all: `reports.entity_type` had no 'comment' value, so a client could never
-- insert one, and the app's own Community Guidelines page already claimed
-- "You can report a profile, post, comment, message, club, chat or event" —
-- a promise the product didn't keep.
--
-- Mirrors report_message() (040/067): a SECURITY DEFINER RPC snapshots the
-- comment's content server-side at report time, because post_comments has a
-- "users delete own" policy — without a snapshot, self-deleting the comment
-- right after being reported would erase the evidence a moderator needs.

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_entity_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_entity_type_check
  CHECK (entity_type IN ('club','event','post','user','message','chat','comment'));

CREATE OR REPLACE FUNCTION report_comment(
  p_comment_id UUID,
  p_reason TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_comment RECORD;
  v_reporter RECORD;
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_comment FROM post_comments WHERE id = p_comment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'comment_not_found'; END IF;
  IF v_comment.user_id = auth.uid() THEN RAISE EXCEPTION 'cannot_report_own'; END IF;

  -- Same predicate as "post_comments: authenticated read, block-aware" (057):
  -- a comment from someone in either side of a block relationship is not
  -- visible to the reporter, so it cannot be reported either.
  IF v_comment.user_id = ANY ((SELECT public.blocked_user_ids())::uuid[]) THEN
    RAISE EXCEPTION 'comment_not_found';
  END IF;

  SELECT username INTO v_reporter FROM profiles WHERE id = auth.uid();

  INSERT INTO reports (
    reporter_id, reporter_username, entity_type, entity_id,
    reason, details, status, content_snapshot
  ) VALUES (
    auth.uid(), v_reporter.username, 'comment', p_comment_id,
    p_reason, p_details, 'pending', v_comment.content
  ) RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_comment(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_entity_type_check'
  ) THEN
    RAISE EXCEPTION 'migration 080 failed: reports_entity_type_check missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'report_comment'
  ) THEN
    RAISE EXCEPTION 'migration 080 failed: report_comment() missing';
  END IF;
END $$;
