import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * A message-attachment cleanup job carries the position-0 path — the value that
 * was in `messages.attachment_url` (the legacy / compatibility projection). A
 * grouped-media message also has positions 1..4 rows in `message_attachments`.
 *
 * Given the anchor (position-0) path, resolve the owning message and return
 * EVERY sibling `storage_path` so cleanup and reconciliation remove all photos
 * of the message, never only the first.
 *
 * Guarantees:
 *  - A message with no normalized rows (a legacy single attachment, or a row
 *    inserted before migration 113's backfill) returns just `[anchorPath]`, so
 *    existing single-photo deletion behavior is byte-for-byte unchanged.
 *  - The sibling lookup is filtered by the resolved `message_id`, so it can
 *    never return an attachment that belongs to a different message.
 *  - `anchorPath` is always included and the result is de-duplicated.
 *
 * The caller must pass a service-role client: `message_attachments` rows for a
 * deleted/redacted message are retained (RLS hides them from clients) precisely
 * so this mapping still works when the scheduled reconciler runs later.
 */
export async function messageAttachmentPaths(
  admin: SupabaseClient,
  anchorPath: string,
): Promise<string[]> {
  const { data: anchors, error: anchorError } = await admin
    .from("message_attachments")
    .select("message_id")
    .eq("storage_path", anchorPath)
    .limit(1);
  if (anchorError) throw anchorError;

  const messageId = anchors?.[0]?.message_id as string | undefined;
  if (!messageId) return [anchorPath];

  const { data: rows, error } = await admin
    .from("message_attachments")
    .select("storage_path")
    .eq("message_id", messageId);
  if (error) throw error;

  return Array.from(
    new Set([
      anchorPath,
      ...((rows ?? []) as Array<{ storage_path: string }>).map((row) => row.storage_path),
    ]),
  );
}
