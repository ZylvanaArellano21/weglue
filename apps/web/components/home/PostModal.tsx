"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { HeartIcon, CommentIcon, ImageIcon } from "../shared/icons";
import { usePostDetail, useLikePost } from "../../lib/hooks/useHomePostsFeed";
import { CONTENT_UNAVAILABLE } from "../../lib/contentAvailability";

// Minimal post overlay (?post=), the destination for like/comment notifications
// and the profile posts grid. Real shared post data; like toggles the shared
// post_likes rows. Full comment threads are out of this phase's scope.
export function PostModal({
  postId,
  userId,
  onClose,
  onOpenAuthor,
  officerActions,
}: {
  postId: string;
  userId: string;
  onClose: () => void;
  onOpenAuthor: (userId: string) => void;
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
        <p className="p-10 text-center text-[15px] text-gray-500">{CONTENT_UNAVAILABLE}</p>
      ) : (
        <div>
          <div className="flex items-center gap-2.5 p-4 pr-10">
            <button type="button" onClick={() => onOpenAuthor(post.author.id)} className="flex items-center gap-2.5">
              <Avatar uri={post.author.avatar_url} size={38} name={post.author.username} />
              <span id="post-title" className="text-[15px] font-semibold text-gray-900">
                {post.author.username}
              </span>
            </button>
            {post.tagged_clubs.length > 0 && (
              <span className="truncate text-xs text-gray-400">
                · {post.tagged_clubs.map((c) => c.name).join(", ")}
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
              <span className="flex items-center gap-1.5 text-gray-700">
                <CommentIcon size={20} />
                <span className="text-sm">{post.comments_count}</span>
              </span>
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
