/**
 * Comment threading (migration 128).
 *
 * The database stores only an *immediate* parent link (`parent_comment_id`) —
 * no depth, no materialized path. The product shows exactly one level of
 * visual nesting: a top-level comment and, under it, every reply in its
 * subtree flattened into a single list. A reply that answered another reply
 * keeps the username it answered so a flattened thread still reads correctly.
 *
 * Shared by web (PostCommentsModal) and mobile (comments/[postId]) so the two
 * surfaces group identically.
 */

export interface ThreadableComment {
  id: string;
  created_at: string;
  parent_comment_id: string | null;
  author: { username: string };
}

export interface CommentThread<C extends ThreadableComment> {
  root: C;
  /** Every descendant, flattened to one level, oldest first. `replyingTo` is
   *  the username of the comment each reply directly answered. */
  replies: Array<C & { replyingTo: string | null }>;
}

/**
 * Group a flat, chronologically-ordered comment list into one-level threads.
 * Top-level order follows the input order. A reply whose parent is missing
 * (parent deleted → `parent_comment_id` SET NULL, or simply not in this page)
 * falls back to being its own top-level comment.
 */
export function threadComments<C extends ThreadableComment>(comments: C[]): CommentThread<C>[] {
  const byId = new Map(comments.map((c) => [c.id, c]));

  const rootIdOf = (start: C): string => {
    let cur: C = start;
    const seen = new Set<string>();
    while (cur.parent_comment_id && byId.has(cur.parent_comment_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_comment_id)!;
    }
    return cur.id;
  };

  const threads = new Map<string, CommentThread<C>>();
  const order: string[] = [];

  for (const c of comments) {
    if (!c.parent_comment_id || !byId.has(c.parent_comment_id)) {
      if (!threads.has(c.id)) {
        threads.set(c.id, { root: c, replies: [] });
        order.push(c.id);
      }
    }
  }

  for (const c of comments) {
    if (!c.parent_comment_id || !byId.has(c.parent_comment_id)) continue;
    const thread = threads.get(rootIdOf(c));
    if (!thread) continue;
    const parent = byId.get(c.parent_comment_id)!;
    thread.replies.push({ ...c, replyingTo: parent.author.username });
  }

  for (const t of threads.values()) {
    t.replies.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  return order.map((id) => threads.get(id)!);
}
