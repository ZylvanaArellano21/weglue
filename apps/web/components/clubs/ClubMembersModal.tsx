"use client";

import { useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { SearchIcon, CloseIcon, ChatBubbleOutlineIcon } from "../shared/icons";
import { useClubMembers, useRefreshClubMembers } from "../../lib/hooks/useClubMembers";
import { useFollow, useUnfollow } from "../../lib/hooks/useUserProfile";
import { CLUB_MEMBERS_PAGE_SIZE, type ClubMember } from "../../lib/clubs/clubMembersService";

// Web equivalent of apps/mobile/app/club/[clubId]/members.tsx — the same list,
// the same search, the same paging, and the same per-row actions:
//   • avatar / name  → that person's profile
//   • message icon   → the existing direct-message route
//   • Follow · Following · Gluemate, from the shared follow relationship
// Officers and regular members get the identical list; nothing here is gated on
// club role. `filter="gluemates"` renders the Gluemates variant of the same
// screen, exactly as the mobile route's `?filter=gluemates` does.
export function ClubMembersModal({
  clubId,
  viewerId,
  filter,
  onClose,
  onOpenProfile,
  onMessage,
}: {
  clubId: string;
  viewerId: string;
  filter: "members" | "gluemates";
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
  onMessage: (userId: string) => void;
}): JSX.Element {
  const gluematesOnly = filter === "gluemates";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const { data, isLoading, isFetching } = useClubMembers(clubId, viewerId, search, page, gluematesOnly);
  const refresh = useRefreshClubMembers(clubId);

  const members = data?.members ?? [];
  const total = data?.total ?? 0;
  const title = gluematesOnly ? "Gluemates" : "Members";
  const noun = gluematesOnly ? "gluemate" : "member";
  // Pages REPLACE the list (the same contract as the mobile screen), so "more"
  // is measured from this page's offset, not from its length.
  const hasMore = page * CLUB_MEMBERS_PAGE_SIZE + members.length < total;

  const onSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  return (
    <Modal onClose={onClose} labelledBy="club-members-title" maxWidth={520}>
      <div className="flex max-h-[80vh] flex-col">
        <div className="border-b px-5 pb-3 pr-12 pt-5" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
          <h2 id="club-members-title" className="text-lg font-bold text-gray-900">
            {title}
          </h2>
          {total > 0 && (
            <p className="text-[13px] text-gray-400">
              {total} {noun}
              {total === 1 ? "" : "s"}
            </p>
          )}

          <div className="relative mt-3">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <SearchIcon size={16} />
            </span>
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={`Search ${noun}s...`}
              aria-label={`Search ${noun}s`}
              className="h-10 w-full rounded-xl border bg-white pl-9 pr-9 text-sm outline-none focus:ring-2"
              style={{ borderColor: "#E5E7EB" }}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <CloseIcon size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <ul className="p-5">
              {[0, 1, 2, 3, 4].map((k) => (
                <li key={k} className="flex items-center gap-3 py-3">
                  <div className="h-[46px] w-[46px] animate-pulse rounded-full bg-black/5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-32 animate-pulse rounded bg-black/5" />
                    <div className="h-3 w-20 animate-pulse rounded bg-black/5" />
                  </div>
                  <div className="h-8 w-[72px] animate-pulse rounded-full bg-black/5" />
                </li>
              ))}
            </ul>
          ) : members.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-gray-400">
              {search
                ? `No ${noun}s found for that search.`
                : gluematesOnly
                  ? "No gluemates in this club yet."
                  : "No members yet."}
            </p>
          ) : (
            <ul>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  viewerId={viewerId}
                  onOpenProfile={onOpenProfile}
                  onMessage={onMessage}
                  onFollowChange={refresh}
                />
              ))}
            </ul>
          )}

          {hasMore && (
            <div className="flex justify-center py-4">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={isFetching}
                className="text-sm font-medium text-teal hover:underline disabled:opacity-60"
              >
                {isFetching ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MemberRow({
  member,
  viewerId,
  onOpenProfile,
  onMessage,
  onFollowChange,
}: {
  member: ClubMember;
  viewerId: string;
  onOpenProfile: (userId: string) => void;
  onMessage: (userId: string) => void;
  onFollowChange: () => void;
}): JSX.Element {
  const isSelf = member.id === viewerId;
  const follow = useFollow(viewerId);
  const unfollow = useUnfollow(viewerId);
  const pending = follow.isPending || unfollow.isPending;

  // Gluemate and Following are both "already connected" states, so both toggle
  // OFF — identical to the mobile FollowButton.
  const connected = member.is_gluemate || member.is_following;
  const label = member.is_gluemate ? "Gluemate" : member.is_following ? "Following" : "Follow";

  return (
    <li className="flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: "#F3F4F6" }}>
      <button
        type="button"
        onClick={() => onOpenProfile(member.id)}
        aria-label={`Open ${member.full_name || member.username}'s profile`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Avatar uri={member.avatar_url} size={46} name={member.full_name || member.username} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-gray-900">
            {member.full_name || member.username}
          </span>
          {member.full_name && member.username !== member.full_name && (
            <span className="block truncate text-xs text-gray-400">@{member.username}</span>
          )}
        </span>
      </button>

      {!isSelf && (
        <button
          type="button"
          onClick={() => onMessage(member.id)}
          aria-label={`Message ${member.full_name || member.username}`}
          title="Message"
          className="shrink-0 rounded-full p-1.5 text-gray-400 transition hover:bg-black/5 hover:text-gray-600"
        >
          <ChatBubbleOutlineIcon size={18} strokeWidth={1.9} />
        </button>
      )}

      {!isSelf && (
        <button
          type="button"
          onClick={() =>
            (connected ? unfollow : follow).mutate(member.id, { onSuccess: onFollowChange })
          }
          disabled={pending}
          aria-pressed={connected}
          className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition disabled:opacity-60"
          style={
            connected
              ? { border: "1.5px solid #0FA6A6", color: "#0FA6A6", background: "#fff" }
              : { background: "#0FA6A6", color: "#fff" }
          }
        >
          {label}
        </button>
      )}
    </li>
  );
}
