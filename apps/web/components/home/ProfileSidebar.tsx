"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "../shared/Avatar";
import { CountBadge } from "../shared/CountBadge";
import { CloseIcon, BookmarkIcon, HeartIcon } from "../shared/icons";
import { useOwnProfile, useOwnClubs } from "../../lib/hooks/useOwnProfile";
import { useSavedEventsCount } from "../../lib/hooks/useSavedEvents";
import { ClickableClubIdentity } from "../shared/ClickableIdentity";
import { useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import {
  usePicturePromptState,
  useDismissPicturePrompt,
} from "../../lib/hooks/usePicturePrompt";

// Left column: the authenticated user's real profile card + the Home menu
// (Notifications, Saved Events, Interests, Gluemates). Values are all real —
// never the screenshot's "Josefina Ruiz" / 340.
export function ProfileSidebar({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const { data: profile } = useOwnProfile(userId);
  const { data: clubs } = useOwnClubs(userId);
  const { data: savedEventsCount = 0 } = useSavedEventsCount(userId);
  const { data: summary } = useUnreadSummaryValue(userId);
  const { data: promptState } = usePicturePromptState(userId);
  const { mutate: dismissPrompt } = useDismissPicturePrompt(userId);

  const notifications = summary?.unread_notifications ?? 0;
  const handles = (clubs ?? [])
    .filter((c) => c.role === "officer" && !!c.club_handle)
    .slice(0, 3);

  // New accounts only, and only until they act on it (mirrors mobile exactly).
  const showPicturePrompt =
    promptState?.status === "pending" && !promptState?.avatar_url;

  const openProfile = () => router.push("/profile");

  return (
    <aside className="flex flex-col gap-4" aria-label="Your profile and menu">
      {/* Profile card */}
      <div
        className="rounded-xl bg-white p-4"
        style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)" }}
      >
        <button type="button" onClick={openProfile} className="flex w-full flex-col items-start text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2">
          <Avatar
            uri={profile?.avatar_url}
            size={64}
            name={profile?.full_name ?? profile?.username}
          />
          <h1 className="mt-3 text-lg font-bold text-gray-900">
            {profile?.full_name ?? profile?.username ?? " "}
          </h1>
          {profile?.major && (
            <p className="text-sm italic text-gray-500">{profile.major}</p>
          )}
        </button>
        {handles.length > 0 && (
          <div className="mt-1 text-sm font-medium" style={{ color: "#0FA6A6" }}>
            {handles.map((club) => (
              <ClickableClubIdentity
                key={club.club_id}
                clubId={club.club_id}
                ariaLabel={`Open ${club.club_name}`}
                className="block w-fit cursor-pointer"
              >
                @{club.club_handle}
              </ClickableClubIdentity>
            ))}
          </div>
        )}

        {showPicturePrompt && (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: "#E0F7F7" }}
          >
            <button
              type="button"
              onClick={() => {
                dismissPrompt();
                router.push("/profile/edit");
              }}
              className="flex-1 text-left text-[13px] font-bold"
              style={{ color: "#0FA6A6" }}
            >
              Personalize your picture!
            </button>
            <button
              type="button"
              onClick={() => dismissPrompt()}
              aria-label="Dismiss profile picture prompt"
              className="text-gray-400 hover:text-gray-600"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Notifications */}
      <MenuCard>
        <MenuRow href="/home?notifications=1" label="Notifications" badge={notifications} bold />
      </MenuCard>

      {/* Saved Events + Interests */}
      <MenuCard>
        <MenuRow href="/home?saved=1" label="Saved Events" icon={<BookmarkIcon size={18} />} count={savedEventsCount} />
        <MenuRow href="/interests" label="Interests" icon={<HeartIcon size={18} />} />
      </MenuCard>

      {/* Gluemates */}
      <MenuCard>
        <Link
          href="/home?gluemates=1"
          className="flex items-center justify-between px-4 py-3 text-[15px] font-bold text-gray-900"
        >
          <span>Gluemates</span>
          <span style={{ color: "#0FA6A6" }}>{profile?.gluemates_count ?? 0}</span>
        </Link>
      </MenuCard>

      {/* Account. Permanent self-service deletion must be reachable from inside
          the signed-in app, not only from the public help form. */}
      <MenuCard>
        <Link
          href="/account/delete"
          className="flex items-center gap-2.5 px-4 py-3 text-[15px] font-medium text-[#F02719] hover:bg-red-50"
        >
          <span className="flex-1">Delete Account</span>
        </Link>
      </MenuCard>
    </aside>
  );
}

function MenuCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-xl bg-white"
      style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)" }}
    >
      {children}
    </div>
  );
}

function MenuRow({
  href,
  label,
  icon,
  badge = 0,
  count,
  bold,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  count?: number;
  bold?: boolean;
}): JSX.Element {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-4 py-3 text-[15px] text-gray-900 hover:bg-gray-50 ${
        bold ? "font-bold" : "font-medium"
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge > 0 && <CountBadge count={badge} label="unread notifications" />}
      {typeof count === "number" && <span style={{ color: "#0FA6A6" }}>{count}</span>}
    </Link>
  );
}
