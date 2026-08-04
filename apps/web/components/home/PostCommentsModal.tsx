"use client";

import { FormEvent, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { useAddComment, usePostComments } from "../../lib/hooks/usePostActions";

export function PostCommentsModal({ postId, userId, onClose }: { postId: string; userId: string; onClose: () => void }): JSX.Element {
  const { data: comments, isLoading, isError } = usePostComments(postId, true);
  const { mutate: addComment, isPending, isError: commentError, error: commentErrorDetails } = useAddComment();
  const [content, setContent] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim() || isPending) return;
    addComment({ postId, userId, content: content.trim() }, { onSuccess: () => setContent("") });
  };
  return (
    <Modal onClose={onClose} labelledBy="comments-title" maxWidth={520}>
      <div className="flex max-h-[80vh] flex-col p-5 sm:p-6">
        <h2 id="comments-title" className="pr-8 text-xl font-bold text-gray-900">Comments</h2>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? <p className="py-8 text-center text-sm text-gray-500">Loading comments…</p> :
           isError ? <p className="py-8 text-center text-sm text-gray-500">Comments could not be loaded.</p> :
           comments?.length ? <ul className="space-y-3">{comments.map((comment) => (
             <li key={comment.id} className="flex gap-2.5">
               <ClickableUserIdentity userId={comment.author.id} ariaLabel={`Open ${comment.author.username}'s profile`} className="shrink-0">
                 <Avatar uri={comment.author.avatar_url} size={34} name={comment.author.username} />
               </ClickableUserIdentity>
               <div className="min-w-0 rounded-xl bg-black/[0.04] px-3 py-2">
                 <ClickableUserIdentity userId={comment.author.id} className="block w-fit text-sm font-semibold text-gray-900">{comment.author.username}</ClickableUserIdentity>
                 <p className="break-words text-sm text-gray-700">{comment.content}</p>
               </div>
             </li>
           ))}</ul> : <p className="py-8 text-center text-sm text-gray-500">No comments yet. Start the conversation.</p>}
        </div>
        <form onSubmit={submit} className="mt-4 flex gap-2 border-t pt-3">
          <label htmlFor="new-comment" className="sr-only">Add a comment</label>
          <input id="new-comment" value={content} onChange={(e) => setContent(e.target.value)} maxLength={1000} placeholder="Add a comment…" className="min-w-0 flex-1 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-[#0FA6A6] focus:ring-2 focus:ring-[#0FA6A6]/30" />
          <button type="submit" disabled={!content.trim() || isPending} className="rounded-full bg-[#0FA6A6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Posting…" : "Post"}</button>
        </form>
        {commentError && <p role="alert" className="mt-2 text-xs text-red-600">{commentErrorDetails instanceof Error ? commentErrorDetails.message : "Could not add comment. Try again."}</p>}
      </div>
    </Modal>
  );
}
