"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { threadComments } from "@weglue/shared";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { useAddComment, usePostComments, reportComment } from "../../lib/hooks/usePostActions";
import { ReportModal } from "../shared/ReportModal";
import { useToast } from "../shared/Toast";

type ReplyTarget = { id: string; username: string };

export function PostCommentsModal({
  postId,
  userId,
  onClose,
  focusCommentId,
}: {
  postId: string;
  userId: string;
  onClose: () => void;
  /** From a comment_reply notification — scroll to + highlight this reply. */
  focusCommentId?: string;
}): JSX.Element {
  const { data: comments, isLoading, isError } = usePostComments(postId, true);
  const { mutate: addComment, isPending, isError: commentError, error: commentErrorDetails } = useAddComment();
  const [content, setContent] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; content: string } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const show = useToast();

  // Flatten one-level threads into a single render list.
  const rows = useMemo(() => {
    const out: Array<{
      comment: NonNullable<typeof comments>[number];
      isReply: boolean;
      replyingTo: string | null;
    }> = [];
    for (const thread of threadComments(comments ?? [])) {
      out.push({ comment: thread.root, isReply: false, replyingTo: null });
      for (const reply of thread.replies) {
        out.push({ comment: reply, isReply: true, replyingTo: reply.replyingTo });
      }
    }
    return out;
  }, [comments]);

  const didFocusRef = useRef(false);
  useEffect(() => {
    if (didFocusRef.current || !focusCommentId || rows.length === 0) return;
    const el = rowRefs.current.get(focusCommentId);
    if (!el) return;
    didFocusRef.current = true;
    el.scrollIntoView({ block: "center" });
    setHighlightId(focusCommentId);
    const t = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(t);
  }, [focusCommentId, rows]);

  const startReply = (comment: { id: string; author: { username: string } }) => {
    setReplyTarget({ id: comment.id, username: comment.author.username });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim() || isPending) return;
    addComment(
      { postId, userId, content: content.trim(), parentCommentId: replyTarget?.id ?? null },
      {
        onSuccess: () => {
          setContent("");
          setReplyTarget(null);
        },
      },
    );
  };

  return (
    <>
      <Modal onClose={onClose} labelledBy="comments-title" maxWidth={520}>
        <div className="flex max-h-[80vh] flex-col p-5 sm:p-6">
          <h2 id="comments-title" className="pr-8 text-xl font-bold text-gray-900">Comments</h2>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {isLoading ? <p className="py-8 text-center text-sm text-gray-500">Loading comments…</p> :
             isError ? <p className="py-8 text-center text-sm text-gray-500">Comments could not be loaded.</p> :
             rows.length ? <ul className="space-y-3">{rows.map(({ comment, isReply, replyingTo }) => (
               <li
                 key={comment.id}
                 ref={(el) => { if (el) rowRefs.current.set(comment.id, el); else rowRefs.current.delete(comment.id); }}
                 className={`flex items-start gap-2.5 rounded-xl transition-colors ${isReply ? "ml-10" : ""} ${highlightId === comment.id ? "bg-[#0FA6A6]/10 p-2 -m-2" : ""}`}
               >
                 <ClickableUserIdentity userId={comment.author.id} ariaLabel={`Open ${comment.author.username}'s profile`} className="shrink-0">
                   <Avatar uri={comment.author.avatar_url} size={isReply ? 28 : 34} name={comment.author.username} />
                 </ClickableUserIdentity>
                 <div className="min-w-0 flex-1">
                   <div className="rounded-xl bg-black/[0.04] px-3 py-2">
                     <ClickableUserIdentity userId={comment.author.id} className="block w-fit text-sm font-semibold text-gray-900">{comment.author.username}</ClickableUserIdentity>
                     <p className="break-words text-sm text-gray-700">
                       {isReply && replyingTo && replyingTo !== comment.author.username ? (
                         <span className="font-medium text-[#0B7C7C]">↩ @{replyingTo} </span>
                       ) : null}
                       {comment.content}
                     </p>
                   </div>
                   <button
                     type="button"
                     onClick={() => startReply(comment)}
                     className="mt-1 pl-1 text-xs font-semibold text-gray-500 hover:text-gray-700"
                   >
                     Reply
                   </button>
                 </div>
                 {comment.author.id !== userId && (
                   <button
                     type="button"
                     onClick={() => setReportTarget({ id: comment.id, content: comment.content })}
                     aria-label="Report this comment"
                     className="shrink-0 rounded p-1 text-gray-400 hover:bg-black/5 hover:text-gray-600"
                   >
                     •••
                   </button>
                 )}
               </li>
             ))}</ul> : <p className="py-8 text-center text-sm text-gray-500">No comments yet. Be the first!</p>}
          </div>
          <form onSubmit={submit} className="mt-4 border-t pt-3">
            {replyTarget && (
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>Replying to <span className="font-semibold text-[#0B7C7C]">@{replyTarget.username}</span></span>
                <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply" className="rounded p-0.5 text-gray-400 hover:text-gray-600">✕</button>
              </div>
            )}
            <div className="flex gap-2">
              <label htmlFor="new-comment" className="sr-only">{replyTarget ? `Reply to @${replyTarget.username}` : "Add a comment"}</label>
              <input ref={inputRef} id="new-comment" value={content} onChange={(e) => setContent(e.target.value)} maxLength={1000} placeholder={replyTarget ? `Reply to @${replyTarget.username}…` : "Add a comment…"} className="min-w-0 flex-1 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-[#0FA6A6] focus:ring-2 focus:ring-[#0FA6A6]/30" />
              <button type="submit" disabled={!content.trim() || isPending} className="rounded-full bg-[#0FA6A6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Posting…" : replyTarget ? "Reply" : "Post"}</button>
            </div>
          </form>
          {commentError && <p role="alert" className="mt-2 text-xs text-red-600">{commentErrorDetails instanceof Error ? commentErrorDetails.message : "Could not add comment. Try again."}</p>}
        </div>
      </Modal>
      {reportTarget && (
        <ReportModal
          entityType="comment"
          entityId={reportTarget.id}
          entityName={reportTarget.content}
          onClose={() => setReportTarget(null)}
          onSubmitted={show}
          onSubmit={(reason) => reportComment(reportTarget.id, reason)}
        />
      )}
    </>
  );
}
