"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHomePostsFeed, useLikePost, type FeedPost } from "../../lib/hooks/useHomePostsFeed";
import { Avatar } from "../shared/Avatar";
import { HeartIcon, CommentIcon, ImageIcon } from "../shared/icons";
import { EmptyState } from "./EmptyState";

// Desktop Home → Posts feed. Same university-scoped, newest-first picture posts
// as mobile. Full comment threads + post detail overlay land in a later phase;
// like toggling is wired here because it is part of the feed hook.
export function PostsFeed({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useHomePostsFeed(userId);
  const { mutate: like } = useLikePost();

  const posts = useMemo(() => (data ? data.pages.flat() : []), [data]);

  if (isLoading) {
    return (
      <div className="mt-4 space-y-4">
        {[0, 1].map((k) => (
          <div key={k} className="h-96 animate-pulse rounded-xl bg-black/5" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-12 text-center text-[15px] text-gray-500">
        Something went wrong loading posts.
      </p>
    );
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        emoji="📷"
        title="No posts yet."
        subtitle="Share a Glue to start the conversation!"
      />
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onLike={() =>
            like({ userId, postId: post.id, hasLiked: post.user_has_liked })
          }
          onOpenAuthor={() => router.push(`/u/${post.author.username}`)}
        />
      ))}

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mx-auto block rounded-full border px-6 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
        >
          {isFetchingNextPage ? "Loading…" : "Show more posts"}
        </button>
      )}
    </div>
  );
}

function PostCard({
  post,
  onLike,
  onOpenAuthor,
}: {
  post: FeedPost;
  onLike: () => void;
  onOpenAuthor: () => void;
}): JSX.Element {
  return (
    <article
      className="overflow-hidden rounded-xl"
      style={{
        background: "#FEFFF8",
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        border: "1px solid rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <button type="button" onClick={onOpenAuthor} className="flex items-center gap-2.5">
          <Avatar uri={post.author.avatar_url} size={34} name={post.author.username} />
          <span className="text-[15px] font-semibold text-gray-800">
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
        <div
          className="flex aspect-square w-full items-center justify-center"
          style={{ background: "#E5E7EB", color: "#9CA3AF" }}
        >
          <ImageIcon size={40} />
        </div>
      )}

      <div className="px-3.5 py-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onLike}
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
      </div>
    </article>
  );
}
