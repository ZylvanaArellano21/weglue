"use client";

import { Modal } from "../shared/Modal";
import { useState } from "react";
import { Avatar } from "../shared/Avatar";
import { ClickableClubIdentity, ClickableUserIdentity } from "../shared/ClickableIdentity";
import { HeartIcon, CommentIcon, ImageIcon } from "../shared/icons";
import { usePostDetail, useLikePost } from "../../lib/hooks/useHomePostsFeed";
import { PhotoCarousel } from "../shared/PhotoCarousel";
import { UnifiedShareSheet } from "../shared/UnifiedShareSheet";
import { ReportModal } from "../shared/ReportModal";
import { useToast } from "../shared/Toast";

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
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const show = useToast();

  return (
    <>
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
            {post.author_kind === "club" ? (
              <ClickableClubIdentity clubId={post.author.id} ariaLabel={`Open ${post.author.username}`} className="flex items-center gap-2.5">
                <Avatar uri={post.author.avatar_url} size={38} name={post.author.username} />
                <span id="post-title" className="text-[15px] font-semibold text-gray-900">{post.author.username}</span>
              </ClickableClubIdentity>
            ) : (
              <ClickableUserIdentity userId={post.author.id} ariaLabel={`Open ${post.author.username}'s profile`} className="flex items-center gap-2.5">
                <Avatar uri={post.author.avatar_url} size={38} name={post.author.username} />
                <span id="post-title" className="text-[15px] font-semibold text-gray-900">{post.author.username}</span>
              </ClickableUserIdentity>
            )}
            {post.tagged_clubs.length > 0 && (
              <span className="flex min-w-0 flex-wrap gap-1 text-xs" style={{ color: "#0FA6A6" }}>
                <span className="text-gray-400">·</span>
                {post.tagged_clubs.map((club) => <ClickableClubIdentity key={club.id} clubId={club.id} className="truncate">@{club.name}</ClickableClubIdentity>)}
              </span>
            )}
            {post.author.id !== userId && (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                aria-label="Report this post"
                className="ml-auto rounded p-1.5 text-gray-400 hover:bg-black/5 hover:text-gray-600"
              >
                •••
              </button>
            )}
          </div>

          {post.images && post.images.length > 0 ? (
            <PhotoCarousel
              images={post.images.map((im) => ({
                uri: im.path,
                width: im.width ?? null,
                height: im.height ?? null,
              }))}
              aspectRatio={4 / 5}
              naturalRatio
            />
          ) : post.image_url ? (
            <PhotoCarousel images={[{ uri: post.image_url }]} aspectRatio={4 / 5} naturalRatio />
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
              <button type="button" onClick={() => setShareOpen(true)} aria-label="Share post" className="rounded-full p-2 text-[#0FA6A6]"><ShareGlyph /></button>
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
    {shareOpen && <UnifiedShareSheet userId={userId} content={{ type: "post", id: postId }} title="Share post" onClose={() => setShareOpen(false)} onToast={(message, kind) => show(message, kind === "error" ? "error" : undefined)} />}
    {reportOpen && post && (
      <ReportModal
        entityType="post"
        entityId={post.id}
        entityName={post.caption}
        clubId={post.tagged_clubs[0]?.id ?? null}
        onClose={() => setReportOpen(false)}
        onSubmitted={show}
      />
    )}
    </>
  );
}

function ShareGlyph(): JSX.Element { return <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
