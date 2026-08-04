"use client";

import { useState } from "react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useHomePostsFeed, useLikePost, type FeedPost } from "../../lib/hooks/useHomePostsFeed";
import { Avatar } from "../shared/Avatar";
import { ClickableClubIdentity, ClickableUserIdentity } from "../shared/ClickableIdentity";
import { HeartIcon, CommentIcon, ImageIcon } from "../shared/icons";
import { EmptyState } from "./EmptyState";
import { UnifiedShareSheet } from "../shared/UnifiedShareSheet";
import { useToast } from "../shared/Toast";

// Desktop Home → Posts feed. Same university-scoped, newest-first picture posts
// as mobile. Full comment threads + post detail overlay land in a later phase;
// like toggling is wired here because it is part of the feed hook.
export function PostsFeed({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useHomePostsFeed(userId);
  const { mutate: like } = useLikePost();
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const show = useToast();

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
          onOpenComments={() => {
            const sp = new URLSearchParams(window.location.search);
            sp.set("comments", post.id);
            router.push(`${window.location.pathname}?${sp.toString()}`, { scroll: false });
          }}
          onShare={() => setSharePostId(post.id)}
        />
      ))}

      {sharePostId && <UnifiedShareSheet userId={userId} content={{ type: "post", id: sharePostId }} title="Share post" onClose={() => setSharePostId(null)} onToast={(message, kind) => show(message, kind === "error" ? "error" : undefined)} />}
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
  onOpenComments,
  onShare,
}: {
  post: FeedPost;
  onLike: () => void;
  onOpenComments: () => void;
  onShare: () => void;
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
        <ClickableUserIdentity userId={post.author.id} ariaLabel={`Open ${post.author.username}'s profile`} className="flex items-center gap-2.5">
          <Avatar uri={post.author.avatar_url} size={34} name={post.author.username} />
          <span className="text-[15px] font-semibold text-gray-800">
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
          <button type="button" onClick={onOpenComments} className="flex items-center gap-1.5 rounded-md text-gray-700 outline-none hover:text-[#0FA6A6] focus-visible:ring-2 focus-visible:ring-[#0FA6A6]">
            <CommentIcon size={20} />
            <span className="text-sm">{post.comments_count}</span>
          </button>
          <button type="button" onClick={onShare} aria-label="Share post" className="rounded-full p-1 text-[#0FA6A6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6]"><ShareGlyph /></button>
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

function ShareGlyph(): JSX.Element { return <svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
