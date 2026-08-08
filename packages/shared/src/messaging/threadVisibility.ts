/**
 * Canonical thread-visibility contract, shared by mobile and web.
 *
 * WHY THIS EXISTS
 * Message visibility is decided in three places, and only the first of them is
 * enforced by the database:
 *
 *   1. Unsend-for-everyone  → RLS. Migration 067's SELECT policy already hides
 *      any row that is not (deleted_at IS NULL AND deletion_kind = 'active'),
 *      so neither client can ever observe an unsent message. Nothing to do
 *      client-side beyond not fighting it.
 *   2. Delete-for-me        → `message_hides`. There is NO RLS filter for this
 *      (a restrictive policy here would break moderation and the sender's own
 *      reads), so each client MUST subtract these ids itself.
 *   3. Conversation delete  → `conversation_participants.cleared_before`. Rows
 *      at or before that watermark stay hidden for that one viewer.
 *
 * Rules 2 and 3 previously lived only inside the mobile service. The web thread
 * query implemented neither, which is why a message deleted-for-me on a phone
 * stayed visible in the browser, and why "Delete for me" in the browser looked
 * like it did nothing at all. Keeping the rules here means a future change to
 * message privacy is made once and cannot silently diverge per platform again.
 *
 * These helpers take the Supabase client as an argument rather than importing
 * one, because mobile and web construct different clients (AsyncStorage-backed
 * session vs. browser cookies) and neither may import the other's.
 */

/** The minimum shape a message row must have to be filtered. */
export interface VisibilityCandidate {
  id: string;
  created_at: string;
}

/** Everything needed to decide visibility for one viewer in one conversation. */
export interface ThreadVisibility {
  /** Message ids this viewer chose "Delete for me" on. */
  hiddenIds: Set<string>;
  /** Messages at or before this instant are hidden for this viewer. */
  clearedBefore: string | null;
}

/**
 * Minimal structural type for the Supabase client, so this module compiles in
 * both apps without either of them agreeing on a generated Database type.
 */
interface QueryClientLike {
  from: (table: string) => any;
}

/** Ids of the messages this viewer deleted-for-me inside one conversation. */
export async function getHiddenMessageIds(
  client: QueryClientLike,
  conversationId: string
): Promise<Set<string>> {
  // RLS on message_hides already restricts rows to `user_id = auth.uid()`, so
  // this is scoped to the viewer without an explicit user filter. The inner
  // join to messages narrows it to the open conversation.
  const { data } = await client
    .from("message_hides")
    .select("message_id, messages!inner(conversation_id)")
    .eq("messages.conversation_id", conversationId);
  return new Set(((data ?? []) as Array<{ message_id: string }>).map((row) => row.message_id));
}

/**
 * Every message id this viewer has deleted-for-me, across all conversations.
 *
 * The conversation LIST needs this: its preview is "the newest message still
 * visible to me", and resolving that per conversation would mean one query per
 * row. RLS on `message_hides` already restricts the result to `auth.uid()`, so
 * this returns only the caller's own hides and nothing about anyone else's.
 *
 * Without it, deleting the newest message for yourself left the conversation
 * list still advertising it — "📷 Photo" for a photo you had just removed.
 */
export async function getMyHiddenMessageIds(client: QueryClientLike): Promise<Set<string>> {
  const { data } = await client.from("message_hides").select("message_id");
  return new Set(((data ?? []) as Array<{ message_id: string }>).map((row) => row.message_id));
}

/** This viewer's conversation-delete watermark, or null if they never cleared. */
export async function getClearedBefore(
  client: QueryClientLike,
  conversationId: string,
  userId: string
): Promise<string | null> {
  const { data } = await client
    .from("conversation_participants")
    .select("cleared_before")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { cleared_before?: string | null } | null)?.cleared_before ?? null;
}

/** Loads both visibility inputs in parallel. */
export async function loadThreadVisibility(
  client: QueryClientLike,
  conversationId: string,
  userId: string
): Promise<ThreadVisibility> {
  const [hiddenIds, clearedBefore] = await Promise.all([
    getHiddenMessageIds(client, conversationId),
    getClearedBefore(client, conversationId, userId),
  ]);
  return { hiddenIds, clearedBefore };
}

/**
 * Applies rules 2 and 3 to already-fetched rows.
 *
 * Pagination note: this filters a page AFTER it is fetched, so a page can come
 * back shorter than the requested size. The cursor must therefore keep being
 * derived from the RAW row set, never from the filtered one — otherwise a page
 * whose rows were all hidden would report "no more messages" and truncate the
 * history. Both callers do this.
 */
export function applyThreadVisibility<T extends VisibilityCandidate>(
  rows: T[],
  visibility: ThreadVisibility
): T[] {
  return rows.filter((row) => isMessageVisible(row, visibility));
}

/** The same rule for ONE row, for callers that reach a message through a join
 *  (a poll's parent message, for example) rather than through a list. */
export function isMessageVisible(row: VisibilityCandidate, visibility: ThreadVisibility): boolean {
  if (visibility.hiddenIds.has(row.id)) return false;
  if (visibility.clearedBefore && new Date(row.created_at).getTime() <= new Date(visibility.clearedBefore).getTime()) return false;
  return true;
}
