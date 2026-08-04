"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { HeartIcon, CommentIcon, ImageIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { usePostDetail, useLikePost } from "../../lib/hooks/useHomePostsFeed";
import { useFollow, useUnfollow } from "../../lib/hooks/useUserProfile";
import { usePostComments, useAddComment, useUpdatePostCaption } from "../../lib/hooks/usePostActions";
import { usePostInteractionsRealtime } from "../../lib/hooks/useClubRealtime";
import { useReport, REPORT_RECEIVED_MESSAGE } from "../../lib/hooks/useReport";
import type { ClubPhoto } from "../../lib/clubs/clubProfileService";

// Dedicated Club Media overlay (spec §19) matching officer club media big post:
// a large media panel on the left and a post/user panel on the right (avatar,
// name, club attribution, Follow, caption, like/comment/share, a comment input,
// and — behind a ⋯ menu — Report + officer moderation + author caption edit).
// Prev/next (looping, via the shared Modal's arrows + ArrowLeft/Right keys) move
// through the whole club media collection in grid order. Escape / X / outside
// close and restore focus to the grid item that opened it (Modal handles this).
export function ClubMediaOverlay({
  photos,
  initialIndex,
  userId,
  clubId,
  isOfficer,
  onClose,
  onOpenAuthor,
  onHide,
  onRemovePost,
  onDeleteUpload,
}: {
  photos: ClubPhoto[];
  initialIndex: number;
  userId: string;
  clubId: string;
  isOfficer: boolean;
  onClose: () => void;
  onOpenAuthor: (userId: string) => void;
  onHide: (photoId: string) => void;
  onRemovePost: (postId: string) => void;
  onDeleteUpload: (photoId: string) => void;
}): JSX.Element {
  const [index, setIndex] = useState(initialIndex);
  const photo = photos[Math.min(index, photos.length - 1)];
  const many = photos.length > 1;
  const prev = () => setIndex((i) => (i - 1 + photos.length) % photos.length);
  const next = () => setIndex((i) => (i + 1) % photos.length);

  if (!photo) {
    // The collection emptied (e.g. last item removed) — close.
    onClose();
    return <></>;
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="club-media-title"
      maxWidth={960}
      onPrev={many ? prev : undefined}
      onNext={many ? next : undefined}
      indicator={many ? `${index + 1} of ${photos.length}` : undefined}
    >
      <div className="flex max-h-[86vh] flex-col md:flex-row">
        {/* Media panel */}
        <div className="flex items-center justify-center bg-black md:w-[58%]" style={{ minHeight: 260 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={photo.id}
            src={photo.url}
            alt={photo.caption ?? ""}
            className="max-h-[86vh] w-full object-contain"
          />
        </div>

        {/* Info panel */}
        <div className="flex max-h-[86vh] flex-1 flex-col bg-cream md:w-[42%]">
          {photo.source === "tagged_post" && photo.post_id ? (
            <PostPanel
              key={photo.post_id}
              postId={photo.post_id}
              photoId={photo.id}
              userId={userId}
              clubId={clubId}
              isOfficer={isOfficer}
              onOpenAuthor={onOpenAuthor}
              onHide={() => onHide(photo.id)}
              onRemovePost={() => onRemovePost(photo.post_id!)}
            />
          ) : (
            <UploadPanel
              caption={photo.caption}
              isOfficer={isOfficer}
              onDelete={() => onDeleteUpload(photo.id)}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Officer-uploaded photo (no post behind it) ──────────────────────────────
function UploadPanel({
  caption,
  isOfficer,
  onDelete,
}: {
  caption: string | null;
  isOfficer: boolean;
  onDelete: () => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-1 flex-col p-5">
      <p id="club-media-title" className="text-[15px] font-semibold text-gray-900">Club photo</p>
      {caption && <p className="mt-2 text-[15px] text-gray-800">{caption}</p>}
      <div className="flex-1" />
      {isOfficer && (
        <div className="flex justify-end border-t pt-3" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
          {confirming ? (
            <span className="flex items-center gap-2">
              <button type="button" onClick={onDelete} className="rounded-full bg-[#F02719] px-4 py-1.5 text-xs font-semibold text-white">
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-xs font-semibold text-gray-500 hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-full border-[1.5px] px-4 py-1.5 text-xs font-semibold text-[#F02719]"
              style={{ borderColor: "rgba(240,39,25,0.4)" }}
            >
              Delete photo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tagged post (full social) ───────────────────────────────────────────────
function PostPanel({
  postId,
  photoId,
  userId,
  clubId,
  isOfficer,
  onOpenAuthor,
  onHide,
  onRemovePost,
}: {
  postId: string;
  photoId: string;
  userId: string;
  clubId: string;
  isOfficer: boolean;
  onOpenAuthor: (userId: string) => void;
  onHide: () => void;
  onRemovePost: () => void;
}): JSX.Element {
  const show = useToast();
  usePostInteractionsRealtime(postId, userId); // live likes/comments from other users
  const { data: post } = usePostDetail(postId, userId);
  const { mutate: like } = useLikePost();
  const follow = useFollow(userId);
  const unfollow = useUnfollow(userId);
  const { data: comments } = usePostComments(postId, true);
  const addComment = useAddComment();
  const updateCaption = useUpdatePostCaption();
  const report = useReport();

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [comment, setComment] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [comments?.length]);

  if (!post) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-gray-400">
        <ImageIcon size={28} />
        <p>This post is no longer available.</p>
      </div>
    );
  }

  const isAuthor = post.author.id === userId;
  const isFollowing = post.author.is_following;

  const doShare = async () => {
    const url = `${window.location.origin}/club/${clubId}?tab=media`;
    try {
      if (navigator.share) await navigator.share({ title: "Club media", url });
      else {
        await navigator.clipboard.writeText(url);
        show("Link copied to clipboard");
      }
    } catch {
      /* cancelled */
    }
  };

  const doReport = () => {
    setMenuOpen(false);
    report.mutate(
      { entityType: "post", entityId: postId, clubId, reason: "Reported from Club Media" },
      { onSuccess: () => show(REPORT_RECEIVED_MESSAGE), onError: () => show("Could not submit report. Try again.", "error") }
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Poster + Follow (right padding clears the Modal's close X) */}
      <div className="flex items-start gap-2.5 p-4 pr-12">
        <button type="button" onClick={() => onOpenAuthor(post.author.id)} className="flex min-w-0 items-center gap-2.5 text-left">
          <Avatar uri={post.author.avatar_url} size={40} name={post.author.username} />
          <span className="min-w-0">
            <span id="club-media-title" className="block truncate text-[15px] font-semibold text-gray-900">
              {post.author.username}
            </span>
            {post.tagged_clubs.length > 0 && (
              <span className="block truncate text-xs text-teal">@{post.tagged_clubs[0]!.name}</span>
            )}
          </span>
        </button>
        <div className="flex-1" />
        {!isAuthor && (
          <button
            type="button"
            onClick={() => (isFollowing ? unfollow.mutate(post.author.id) : follow.mutate(post.author.id))}
            disabled={follow.isPending || unfollow.isPending}
            className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition"
            style={isFollowing ? { border: "1.5px solid #0FA6A6", color: "#0FA6A6" } : { background: "#0FA6A6", color: "#fff" }}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        )}
      </div>

      {/* Actions (like / comment / share) + a ⋯ menu (report + officer moderation
          + author caption edit) at the right — kept out of the Modal X's corner. */}
      <div className="flex items-center gap-5 px-4">
        <button
          type="button"
          onClick={() => like({ userId, postId: post.id, hasLiked: post.user_has_liked })}
          aria-pressed={post.user_has_liked}
          aria-label={post.user_has_liked ? "Unlike" : "Like"}
          className="flex items-center gap-1.5"
          style={{ color: post.user_has_liked ? "#EF4444" : "#0FA6A6" }}
        >
          <HeartIcon size={22} filled={post.user_has_liked} />
          {post.likes_count > 0 && <span className="text-sm text-gray-700">{post.likes_count}</span>}
        </button>
        <span className="flex items-center gap-1.5 text-teal">
          <CommentIcon size={20} />
          {post.comments_count > 0 && <span className="text-sm text-gray-700">{post.comments_count}</span>}
        </span>
        <button type="button" onClick={doShare} aria-label="Share" className="text-teal">
          <ShareGlyph />
        </button>
        <div className="flex-1" />
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="More actions" className="rounded-full p-1.5 text-gray-500 hover:bg-black/5">
            <DotsGlyph />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-xl border bg-white py-1 shadow-lg" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
              {isAuthor && (
                <MenuItem
                  label="Edit caption"
                  onClick={() => {
                    setCaptionDraft(post.caption ?? "");
                    setEditing(true);
                    setMenuOpen(false);
                  }}
                />
              )}
              <MenuItem label="Report post" onClick={doReport} danger />
              {isOfficer && <MenuItem label="Hide from this club" onClick={() => { setMenuOpen(false); onHide(); }} />}
              {isOfficer && <MenuItem label="Remove from club" onClick={() => { setMenuOpen(false); onRemovePost(); }} danger />}
            </div>
          )}
        </div>
      </div>

      {/* Caption + comments (scroll) */}
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        {editing ? (
          <div className="mb-3">
            <textarea
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="text-xs font-semibold text-gray-500 hover:underline">Cancel</button>
              <button
                type="button"
                onClick={() =>
                  updateCaption.mutate(
                    { postId, userId, caption: captionDraft },
                    { onSuccess: () => { show("Caption updated ✓"); setEditing(false); }, onError: () => show("Could not update caption.", "error") }
                  )
                }
                disabled={updateCaption.isPending}
                className="rounded-full bg-teal px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          post.caption && (
            <p className="mb-3 text-[15px] font-bold text-gray-900">
              <span className="font-bold">{post.author.username}</span> <span className="font-normal">{post.caption}</span>
            </p>
          )
        )}

        <ul className="space-y-2.5">
          {(comments ?? []).map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <Avatar uri={c.author.avatar_url} size={28} name={c.author.username} />
              <p className="text-sm text-gray-800">
                <button type="button" onClick={() => onOpenAuthor(c.author.id)} className="font-semibold">{c.author.username}</button>{" "}
                {c.content}
              </p>
            </li>
          ))}
        </ul>
        <div ref={commentsEndRef} />
      </div>

      {/* Comment input */}
      <form
        className="flex items-center gap-2 border-t p-3"
        style={{ borderColor: "rgba(0,0,0,0.08)" }}
        onSubmit={(e) => {
          e.preventDefault();
          const text = comment.trim();
          if (!text) return;
          addComment.mutate(
            { postId, userId, content: text },
            { onSuccess: () => setComment(""), onError: () => show("Could not add comment.", "error") }
          );
        }}
      >
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment..."
          aria-label="Add a comment"
          className="h-10 flex-1 rounded-full border border-gray-300 bg-white px-4 text-sm outline-none focus:ring-2"
        />
        <button
          type="submit"
          disabled={!comment.trim() || addComment.isPending}
          className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Post
        </button>
      </form>
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.04]"
      style={{ color: danger ? "#F02719" : "#374151" }}
    >
      {label}
    </button>
  );
}

function DotsGlyph(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function ShareGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
