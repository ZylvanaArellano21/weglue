"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ClickableClubIdentity, ClickableUserIdentity } from "../shared/ClickableIdentity";
import { HeartIcon, CommentIcon, ImageIcon } from "../shared/icons";
import { usePostDetail, useLikePost } from "../../lib/hooks/useHomePostsFeed";

// Minimal post overlay (?post=), the destination for like/comment notifications
// and the profile posts grid. Real shared post data; like toggles the shared
// post_likes rows. Full comment threads are out of this phase's scope.
export function PostModal({
  postId,
  userId,
  onClose,
  onOpenAuthor,
  onOpenComments,
  officerActions,
}: {
  postId: string;
  userId: string;
  onClose: () => void;
  onOpenAuthor: (userId: string) => void;
  onOpenComments?: (postId: string) => void;
  /** Optional officer moderation controls (Club Media overlay). */
  officerActions?: React.ReactNode;
}): JSX.Element {
  const { data: post, isLoading } = usePostDetail(postId, userId);
  const { mutate: like } = useLikePost();

  return (
    <Modal onClose={onClose} labelledBy="post-title" maxWidth={520}>
      {isLoading ? (
        <div className="space-y-3 p-6">
          <div className="h-12 w-1/2 animate-pulse rounded bg-black/5" />
          <div className="aspect-square w-full animate-pulse rounded-xl bg-black/5" />
        </div>
      ) : !post ? (
        <p className="p-10 text-center text-[15px] text-gray-500">This post is no longer available.</p>
      ) : (
        <div>
          <div className="flex items-center gap-2.5 p-4 pr-10">
            <ClickableUserIdentity userId={post.author.id} ariaLabel={`Open ${post.author.username}'s profile`} className="flex items-center gap-2.5">
              <Avatar uri={post.author.avatar_url} size={38} name={post.author.username} />
              <span id="post-title" className="text-[15px] font-semibold text-gray-900">
                {post.author.username}
              </span>
            </ClickableUserIdentity>
            {post.tagged_clubs.length > 0 && (
              <span className="flex min-w-0 flex-wrap gap-1 text-xs" style={{ color: "#0FA6A6" }}>
                <span className="text-gray-400">·</span>
                {post.tagged_clubs.map((club) => <ClickableClubIdentity key={club.id} clubId={club.id} className="truncate">@{club.name}</ClickableClubIdentity>)}
              </span>
            )}
          </div>

          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.image_url} alt={post.caption ?? "post"} className="w-full object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center" style={{ background: "#E5E7EB", color: "#9CA3AF" }}>
              <ImageIcon size={44} />
            </div>
          )}

          <div className="p-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => like({ userId, postId: post.id, hasLiked: post.user_has_liked })}
                aria-pressed={post.user_has_liked}
                aria-label={post.user_has_liked ? "Unlike" : "Like"}
                className="flex items-center gap-1.5"
                style={{ color: post.user_has_liked ? "#EF4444" : "#374151" }}
              >
                <HeartIcon size={22} filled={post.user_has_liked} />
                <span className="text-sm">{post.likes_count}</span>
              </button>
              <button type="button" onClick={() => onOpenComments?.(post.id)} className="flex items-center gap-1.5 rounded-md text-gray-700 outline-none hover:text-[#0FA6A6] focus-visible:ring-2 focus-visible:ring-[#0FA6A6]">
                <CommentIcon size={20} />
                <span className="text-sm">{post.comments_count}</span>
              </button>
            </div>
            {post.caption && (
              <p className="mt-2 text-sm text-gray-800">
                <span className="font-semibold">{post.author.username}</span> {post.caption}
              </p>
            )}
            {officerActions && (
              <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
                {officerActions}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
