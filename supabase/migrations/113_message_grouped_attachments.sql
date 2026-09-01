-- ============================================================================
-- 113 — grouped chat attachments
--
-- `messages.attachment_*` remains the position-0 compatibility projection.
-- New clients also write the normalized child rows, so old clients continue to
-- read and send single attachments without knowing about this table.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id           uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('image', 'video', 'file')),
  position     smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  mime         text,
  width        integer,
  height       integer,
  byte_size    bigint,
  file_name    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_attachments_message_position UNIQUE (message_id, position)
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON public.message_attachments (message_id, position);
CREATE INDEX IF NOT EXISTS idx_message_attachments_storage_path
  ON public.message_attachments (storage_path);

-- Existing messages are copied before the compatibility trigger is installed,
-- making this safe to re-run and preserving the old storage path as position 0.
INSERT INTO public.message_attachments (
  message_id, storage_path, kind, position, mime, byte_size, file_name
)
SELECT
  m.id,
  m.attachment_url,
  CASE
    WHEN m.message_type = 'image' THEN 'image'
    WHEN m.message_type = 'video' THEN 'video'
    ELSE 'file'
  END,
  0,
  m.attachment_mime,
  m.attachment_size,
  m.attachment_name
FROM public.messages m
WHERE m.attachment_url IS NOT NULL
ON CONFLICT (message_id, position) DO NOTHING;

-- Validate the complete grouped shape at transaction end, after a bulk insert
-- has supplied all positions. Images may be 1..5; video and file remain single
-- position-0 attachments. Positions must be contiguous and ordered.
CREATE OR REPLACE FUNCTION private.validate_message_attachments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_kind text;
  v_message_type text;
  v_min_position smallint;
  v_max_position smallint;
  v_distinct_kinds integer;
BEGIN
  SELECT count(*), min(position), max(position), count(DISTINCT kind), min(kind)
    INTO v_count, v_min_position, v_max_position, v_distinct_kinds, v_kind
    FROM public.message_attachments
   WHERE message_id = NEW.message_id;

  IF v_count < 1 OR v_count > 5 THEN
    RAISE EXCEPTION 'message_attachment_count_must_be_between_1_and_5'
      USING ERRCODE = '22023';
  END IF;
  IF v_min_position <> 0 OR v_max_position <> v_count - 1 THEN
    RAISE EXCEPTION 'message_attachment_positions_must_be_contiguous'
      USING ERRCODE = '22023';
  END IF;
  IF v_distinct_kinds <> 1 THEN
    RAISE EXCEPTION 'grouped_message_attachments_must_have_one_kind'
      USING ERRCODE = '22023';
  END IF;

  SELECT message_type INTO v_message_type
    FROM public.messages WHERE id = NEW.message_id;
  IF v_message_type IS NULL THEN
    RAISE EXCEPTION 'message_attachment_parent_not_found' USING ERRCODE = '23503';
  END IF;
  IF v_kind = 'image' THEN
    IF v_message_type <> 'image' THEN
      RAISE EXCEPTION 'image_attachment_requires_image_message' USING ERRCODE = '22023';
    END IF;
  ELSIF v_count <> 1 OR v_min_position <> 0 OR v_message_type <> v_kind THEN
    RAISE EXCEPTION 'video_and_file_messages_accept_one_position_zero_attachment'
      USING ERRCODE = '22023';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_message_attachments ON public.message_attachments;
CREATE CONSTRAINT TRIGGER trg_validate_message_attachments
  AFTER INSERT OR UPDATE ON public.message_attachments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.validate_message_attachments();

-- Keep old clients and old service paths useful after this migration. New
-- grouped sends set this transaction-local flag and insert every child row
-- themselves, avoiding a duplicate position-0 row.
CREATE OR REPLACE FUNCTION private.ensure_legacy_message_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.attachment_url IS NULL
     OR pg_catalog.current_setting('weglue.message_attachments_pending', true) = 'on'
     OR EXISTS (
       SELECT 1 FROM public.message_attachments ma WHERE ma.message_id = NEW.id
     ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.message_attachments (
    message_id, storage_path, kind, position, mime, byte_size, file_name
  ) VALUES (
    NEW.id,
    NEW.attachment_url,
    CASE WHEN NEW.message_type = 'image' THEN 'image'
         WHEN NEW.message_type = 'video' THEN 'video'
         ELSE 'file' END,
    0,
    NEW.attachment_mime,
    NEW.attachment_size,
    NEW.attachment_name
  ) ON CONFLICT (message_id, position) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_legacy_message_attachment ON public.messages;
CREATE TRIGGER trg_ensure_legacy_message_attachment
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.ensure_legacy_message_attachment();

-- Position 0 is authoritative for the compatibility columns. This also fills
-- those columns for the normalized grouped-send path.
CREATE OR REPLACE FUNCTION private.sync_legacy_message_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.position = 0 THEN
    UPDATE public.messages
       SET attachment_url = NEW.storage_path,
           attachment_name = NEW.file_name,
           attachment_size = NEW.byte_size,
           attachment_mime = NEW.mime
     WHERE id = NEW.message_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_message_attachment ON public.message_attachments;
CREATE TRIGGER trg_sync_legacy_message_attachment
  AFTER INSERT OR UPDATE OF storage_path, file_name, byte_size, mime, position
  ON public.message_attachments
  FOR EACH ROW EXECUTE FUNCTION private.sync_legacy_message_attachment();

CREATE OR REPLACE FUNCTION private.message_attachment_readable(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE m.id = p_message_id
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.message_hides h
          WHERE h.message_id = m.id AND h.user_id = (SELECT auth.uid())
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.conversation_participants cp
          WHERE cp.conversation_id = m.conversation_id
            AND cp.user_id = (SELECT auth.uid())
            AND cp.cleared_before IS NOT NULL
            AND m.created_at <= cp.cleared_before
       )
       AND (
         m.sender_id = (SELECT auth.uid())
         OR m.sender_id <> ALL (COALESCE((SELECT public.blocked_user_ids()), ARRAY[]::uuid[]))
       )
  );
$$;

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_attachments FROM anon, authenticated;
GRANT SELECT, INSERT ON public.message_attachments TO authenticated;

DROP POLICY IF EXISTS "message attachments: participants read active" ON public.message_attachments;
CREATE POLICY "message attachments: participants read active"
  ON public.message_attachments FOR SELECT TO authenticated
  USING (private.message_attachment_readable(message_id));

DROP POLICY IF EXISTS "message attachments: sender inserts own" ON public.message_attachments;
CREATE POLICY "message attachments: sender inserts own"
  ON public.message_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.messages m
       WHERE m.id = message_id
         AND m.sender_id = (SELECT auth.uid())
         AND public.is_conversation_participant(m.conversation_id)
    )
    AND private.chat_attachment_available_to_sender(
      storage_path,
      (SELECT m.conversation_id FROM public.messages m WHERE m.id = message_id)
    )
  );

-- Child paths are private chat objects too. Extend the deployed storage helper
-- rather than adding a parallel policy, preserving the existing block check.
CREATE OR REPLACE FUNCTION private.active_chat_attachment_readable(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE (
       m.attachment_url = p_name
       OR EXISTS (
         SELECT 1 FROM public.message_attachments ma
          WHERE ma.message_id = m.id AND ma.storage_path = p_name
       )
     )
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
       AND (
         m.sender_id = (SELECT auth.uid())
         OR m.sender_id IS NULL
         OR m.sender_id <> ALL (COALESCE((SELECT public.blocked_user_ids()), ARRAY[]::uuid[]))
       )
  );
$$;

CREATE OR REPLACE FUNCTION private.chat_attachment_available_to_sender(
  p_name text,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p_name ~ ('^' || p_conversation_id::text || '/.+')
     AND EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'chat-attachments'
          AND o.name = p_name
          AND o.owner = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.messages m WHERE m.attachment_url = p_name
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.message_attachments ma WHERE ma.storage_path = p_name
     )
     AND NOT EXISTS (
       SELECT 1 FROM private.message_attachment_cleanup_jobs j
        WHERE j.original_object_path = p_name
          AND j.state IN ('pending', 'processing', 'retry_pending', 'reconciliation_required')
     );
$$;

-- Atomic grouped-send entry point. The caller still uploads through Storage;
-- this function binds all owned paths and emits the final message payload only
-- after every normalized attachment row exists.
CREATE OR REPLACE FUNCTION public.send_message_with_attachments(
  p_conversation_id uuid,
  p_channel_id uuid,
  p_content text,
  p_message_type text,
  p_client_tag uuid,
  p_attachments jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sender_id uuid := (SELECT auth.uid());
  v_message_id uuid;
  v_count integer;
  v_first jsonb;
  v_item jsonb;
  v_kind text;
  v_first_kind text;
  v_path text;
  v_mime text;
  v_file_name text;
  v_width integer;
  v_height integer;
  v_bytes bigint;
  v_attachments jsonb;
BEGIN
  IF v_sender_id IS NULL OR NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'not_a_participant' USING ERRCODE = '42501';
  END IF;
  IF p_channel_id IS NOT NULL AND NOT public.can_post_in_channel(p_channel_id) THEN
    RAISE EXCEPTION 'channel_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'attachments_must_be_an_array' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_attachments);
  IF v_count < 1 OR v_count > 5 THEN
    RAISE EXCEPTION 'attachments_must_contain_between_1_and_5_items' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_attachments) item
     WHERE jsonb_typeof(item) <> 'object'
        OR COALESCE(btrim(item->>'path'), '') = ''
  ) THEN
    RAISE EXCEPTION 'attachment_path_required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_attachments) item
     GROUP BY item->>'path' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'attachment_paths_must_be_unique' USING ERRCODE = '23505';
  END IF;

  v_first := p_attachments->0;
  v_first_kind := v_first->>'kind';
  IF v_first_kind NOT IN ('image', 'video', 'file') THEN
    RAISE EXCEPTION 'invalid_attachment_kind' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_attachments) item
     WHERE item->>'kind' IS DISTINCT FROM v_first_kind
  ) THEN
    RAISE EXCEPTION 'grouped_attachments_must_have_one_kind' USING ERRCODE = '22023';
  END IF;
  IF v_first_kind <> 'image' AND v_count <> 1 THEN
    RAISE EXCEPTION 'video_and_file_messages_are_single_attachment' USING ERRCODE = '22023';
  END IF;
  IF p_message_type IS DISTINCT FROM v_first_kind THEN
    RAISE EXCEPTION 'message_type_must_match_attachment_kind' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments) LOOP
    v_path := btrim(v_item->>'path');
    IF NOT private.chat_attachment_available_to_sender(v_path, p_conversation_id) THEN
      RAISE EXCEPTION 'attachment_not_owned_by_sender' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(v_item->>'bytes', '') <> '' AND (v_item->>'bytes') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'attachment_bytes_must_be_non_negative' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Suppress the legacy position-0 auto-row; this transaction inserts all
  -- normalized children explicitly below.
  PERFORM set_config('weglue.message_attachments_pending', 'on', true);
  INSERT INTO public.messages (
    conversation_id, channel_id, sender_id, content, message_type,
    attachment_url, attachment_name, attachment_size, attachment_mime, client_tag
  ) VALUES (
    p_conversation_id,
    p_channel_id,
    v_sender_id,
    NULLIF(btrim(COALESCE(p_content, '')), ''),
    p_message_type,
    v_first->>'path',
    NULLIF(v_first->>'fileName', ''),
    CASE WHEN COALESCE(v_first->>'bytes', '') = '' THEN NULL ELSE (v_first->>'bytes')::bigint END,
    NULLIF(v_first->>'mime', ''),
    p_client_tag
  ) RETURNING id INTO v_message_id;

  INSERT INTO public.message_attachments (
    message_id, storage_path, kind, position, mime, width, height, byte_size, file_name
  )
  SELECT
    v_message_id,
    item->>'path',
    item->>'kind',
    ordinality - 1,
    NULLIF(item->>'mime', ''),
    CASE WHEN COALESCE(item->>'width', '') ~ '^[0-9]+$' THEN (item->>'width')::integer END,
    CASE WHEN COALESCE(item->>'height', '') ~ '^[0-9]+$' THEN (item->>'height')::integer END,
    CASE WHEN COALESCE(item->>'bytes', '') ~ '^[0-9]+$' THEN (item->>'bytes')::bigint END,
    NULLIF(item->>'fileName', '')
  FROM jsonb_array_elements(p_attachments) WITH ORDINALITY AS entries(item, ordinality);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ma.id,
      'storage_path', ma.storage_path,
      'kind', ma.kind,
      'position', ma.position,
      'mime', ma.mime,
      'width', ma.width,
      'height', ma.height,
      'byte_size', ma.byte_size,
      'file_name', ma.file_name
    ) ORDER BY ma.position
  ) INTO v_attachments
    FROM public.message_attachments ma WHERE ma.message_id = v_message_id;

  PERFORM realtime.send(
    jsonb_build_object(
      'message_id', v_message_id,
      'conversation_id', p_conversation_id,
      'channel_id', p_channel_id,
      'attachments', v_attachments
    ),
    'message',
    'sync:message:' || p_conversation_id::text,
    true
  );
  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_message_attachments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ensure_legacy_message_attachment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_legacy_message_attachment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.message_attachment_readable(uuid) FROM PUBLIC, anon;
-- authenticated keeps EXECUTE: used in the message_attachments SELECT policy
-- (TO authenticated). See 112 note.
GRANT EXECUTE ON FUNCTION private.message_attachment_readable(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.send_message_with_attachments(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message_with_attachments(uuid, uuid, text, text, uuid, jsonb) TO authenticated;

COMMIT;
