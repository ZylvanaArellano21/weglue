"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "../shared/Avatar";
import { CountBadge } from "../shared/CountBadge";
import { CloseIcon, BookmarkIcon, HeartIcon } from "../shared/icons";
import { useOwnProfile, useOwnClubs } from "../../lib/hooks/useOwnProfile";
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
  const { data: summary } = useUnreadSummaryValue(userId);
  const { data: promptState } = usePicturePromptState(userId);
  const { mutate: dismissPrompt } = useDismissPicturePrompt(userId);

  const notifications = summary?.unread_notifications ?? 0;
  const handles = (clubs ?? [])
    .map((c) => c.club_handle)
    .filter((h): h is string => !!h)
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
        <button type="button" onClick={openProfile} className="flex w-full flex-col items-start text-left">
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
          {handles.length > 0 && (
            <p className="mt-1 text-sm font-medium" style={{ color: "#0FA6A6" }}>
              {handles.map((h) => (
                <span key={h} className="block">
                  @{h}
                </span>
              ))}
            </p>
          )}
        </button>

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
        <MenuRow href="/notifications" label="Notifications" badge={notifications} bold />
      </MenuCard>

      {/* Saved Events + Interests */}
      <MenuCard>
        <MenuRow href="/home?saved=1" label="Saved Events" icon={<BookmarkIcon size={18} />} />
        <MenuRow href="/interests" label="Interests" icon={<HeartIcon size={18} />} />
      </MenuCard>

      {/* Gluemates */}
      <MenuCard>
        <Link
          href="/gluemates"
          className="flex items-center justify-between px-4 py-3 text-[15px] font-bold text-gray-900"
        >
          <span>Gluemates</span>
          <span style={{ color: "#0FA6A6" }}>{profile?.gluemates_count ?? 0}</span>
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
  bold,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
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
    </Link>
  );
}
