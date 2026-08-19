"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "../shared/Avatar";
import { SettingsIcon, ShieldIcon, BookmarkIcon, HeartIcon, BellIcon } from "../shared/icons";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { AccountCenterModal } from "./AccountCenterModal";
import { PrivacyCenterModal } from "./PrivacyCenterModal";
import { useOwnProfile } from "../../lib/hooks/useOwnProfile";
import { useSavedEventsCount } from "../../lib/hooks/useSavedEvents";
import { useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import { supportMailtoUrl, SUPPORT_EMAIL } from "../../lib/support";
import {
  redirectToPublicLanding,
  tearDownAuthenticatedSession,
} from "../../lib/sessionCleanup";

// ─── Top-navigation profile menu ─────────────────────────────────────────────
//
// Desktop equivalent of the mobile sidebar drawer
// (apps/mobile/components/sidebar/SidebarOverlay.tsx + lib/sidebarNavigation.ts).
// Same destinations, same order, same labels, same confirmations:
//
//   avatar / name / View profile → Your Profile
//   Saved Events                 → mobile's bookmark row, same badge count
//                                  (phone-only here — desktop already has this
//                                  in ProfileSidebar, so it would be a second,
//                                  redundant copy of the same destination)
//   Interests                    → /interests (phone-only, same reason)
//   Account Center               → the account modal (email, username, password,
//                                  delete) — mobile's /account-center
//   Notifications                → mobile's bell row (phone-only — desktop has
//                                  it in ProfileSidebar; phone ALSO has a
//                                  header shortcut, matching mobile which has
//                                  both a header icon AND this sidebar row)
//   Privacy Center               → the privacy modal — mobile's /privacy-center
//   Help                         → the device mail composer, with the same
//                                  address and subject as mobile
//   Terms & Conditions           → /terms, the SAME @weglue/shared document the
//                                  mobile screen renders
//   Log out                      → confirmation first, then the shared teardown
//
// Account Center and Privacy Center are modals rather than routes because the
// screenshots show them layered over the page. Only one can be open at a time,
// and Log out cannot be reached while either is open, so there is never more
// than one profile surface on screen.

type OpenModal = "account" | "privacy" | null;

export function ProfileMenu({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: profile } = useOwnProfile(userId);
  // Backs the phone-only Saved Events / Notifications rows below.
  const { data: savedEventsCount = 0 } = useSavedEventsCount(userId);
  const { data: summary } = useUnreadSummaryValue(userId);
  const notifications = summary?.unread_notifications ?? 0;

  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<OpenModal>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [helpFallback, setHelpFallback] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Outside click + Escape close the dropdown. `mousedown` (not `click`) so the
  // menu is already gone before a click lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const displayName = profile?.full_name || profile?.username || "Your Profile";

  const goProfile = () => {
    close();
    router.push("/profile");
  };

  const openModal = (which: Exclude<OpenModal, null>) => {
    close();
    setModal(which);
  };

  // Help is a real <a href="mailto:…">, so the browser hands off to whatever
  // mail client the student actually uses and middle-click / "copy link" work.
  //
  // Detecting FAILURE is the hard part on web: unlike mobile's
  // Linking.openURL, assigning or following a mailto: never throws when no mail
  // client is registered — the OS just silently drops it, and the student is
  // left with nothing. So we watch for the hand-off instead of the error: if a
  // mail app opens, this document loses focus (blur/visibilitychange fires). If
  // it is still focused a moment later, nothing opened, and we show the same
  // copyable fallback the mobile sidebar shows.
  const onHelp = () => {
    close();
    let handedOff = false;
    const markHandedOff = () => {
      handedOff = true;
    };
    window.addEventListener("blur", markHandedOff, { once: true });
    document.addEventListener("visibilitychange", markHandedOff, { once: true });

    window.setTimeout(() => {
      window.removeEventListener("blur", markHandedOff);
      document.removeEventListener("visibilitychange", markHandedOff);
      if (!handedOff && document.hasFocus()) setHelpFallback(true);
    }, 1200);
  };

  const onLogoutConfirm = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError(null);

    const { signedOut } = await tearDownAuthenticatedSession(queryClient);

    if (!signedOut) {
      // Never pretend the user is logged out. The local session was cleared as
      // a fallback, but the server was not reached — say so and stay put.
      setSigningOut(false);
      setLogoutError(
        "We couldn't reach the server to sign you out everywhere. Please check your connection and try again."
      );
      return;
    }

    // Hard replace: no authenticated React tree, no cache and no history entry
    // survives, so browser Back cannot reopen an authenticated page.
    redirectToPublicLanding();
  };

  return (
    <div ref={rootRef} className="relative ml-1 shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Your profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
      >
        <Avatar uri={profile?.avatar_url} size={38} name={displayName} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Profile menu"
          // md:right-0 anchors it under the avatar and keeps it inside the
          // viewport at every DESKTOP width, where the trigger sits at the
          // far right of the header — the max-width clamp handles narrow
          // browsers. On phone the trigger moves to the far LEFT (AppHeader
          // repositions it via order-1 to match native), so right-0 there
          // would anchor the panel's right edge to the trigger's right edge
          // and push most of its 276px width off-screen to the left —
          // confirmed on a real device, only a sliver rendered visible.
          // left-0 there extends it rightward from the trigger instead,
          // staying fully on-screen.
          className="absolute left-0 right-auto top-[calc(100%+10px)] z-[60] w-[276px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-black/5 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.16)] md:left-auto md:right-0"
        >
          {/* Identity block — the avatar, the name and View profile all open the
              full profile page (spec §2). */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <button
              type="button"
              role="menuitem"
              onClick={goProfile}
              aria-label={`View ${displayName}'s profile`}
              className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
            >
              <Avatar uri={profile?.avatar_url} size={44} name={displayName} />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                role="menuitem"
                onClick={goProfile}
                className="block max-w-full truncate text-left text-[15px] font-bold text-gray-900 hover:underline focus:outline-none focus-visible:underline"
              >
                {displayName}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={goProfile}
                className="mt-1 rounded-full px-3 py-1 text-[12px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ background: "#0FA6A6" }}
              >
                View profile
              </button>
            </div>
          </div>

          <div className="h-px bg-black/[0.07]" />

          {/* Phone-only: Saved Events + Interests. Desktop already has both
              in ProfileSidebar (hidden lg:block), so adding them here too
              would just duplicate the same destination — these exist only
              to close the gap phone had with no ProfileSidebar at all. */}
          <MenuRow
            icon={<BookmarkIcon size={19} />}
            onClick={() => {
              close();
              router.push("/home?saved=1");
            }}
            count={savedEventsCount}
            className="md:hidden"
          >
            Saved Events
          </MenuRow>
          <MenuRow
            icon={<HeartIcon size={19} />}
            onClick={() => {
              close();
              router.push("/interests");
            }}
            className="md:hidden"
          >
            Interests
          </MenuRow>

          <MenuRow icon={<SettingsIcon size={19} />} onClick={() => openModal("account")}>
            Account Center
          </MenuRow>

          {/* Phone-only: Notifications. Mobile has this row IN ADDITION to
              its header icon (both reach the same screen) — the phone
              header already carries the same shortcut, this just completes
              the match with mobile's sidebar. */}
          <MenuRow
            icon={<BellIcon size={19} />}
            onClick={() => {
              close();
              router.push("/home?notifications=1");
            }}
            count={notifications}
            className="md:hidden"
          >
            Notifications
          </MenuRow>

          <MenuRow icon={<ShieldIcon size={19} />} onClick={() => openModal("privacy")}>
            Privacy Center
          </MenuRow>

          <div className="h-px bg-black/[0.07]" />

          {/* Footer row — the compact Help / Terms / Log out strip from the
              reference. Wraps instead of overflowing at narrow widths. */}
          <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-1 px-2.5 py-2.5">
            <a
              href={supportMailtoUrl()}
              role="menuitem"
              onClick={onHelp}
              className="whitespace-nowrap rounded px-1 py-1 text-[12px] font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
            >
              Help
            </a>
            {/* A real link: middle-click / open-in-new-tab work, the session is
                preserved (same-origin client navigation) and browser Back
                returns to this page. */}
            <Link
              href="/terms"
              role="menuitem"
              onClick={close}
              className="whitespace-nowrap rounded px-1 py-1 text-[12px] font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
            >
              Terms &amp; Conditions
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                setLogoutError(null);
                setLogoutOpen(true);
              }}
              className="whitespace-nowrap rounded px-1 py-1 text-[12px] font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
            >
              Log out
            </button>
          </div>
        </div>
      )}

      {modal === "account" && (
        <AccountCenterModal userId={userId} onClose={() => setModal(null)} />
      )}
      {modal === "privacy" && (
        <PrivacyCenterModal userId={userId} onClose={() => setModal(null)} />
      )}

      {logoutOpen && (
        <ConfirmDialog
          title="Log out?"
          message={
            logoutError ?? "Are you sure you want to log out of your We Glue account?"
          }
          confirmLabel="Log Out"
          cancelLabel="Cancel"
          destructive
          loading={signingOut}
          onConfirm={() => void onLogoutConfirm()}
          onCancel={() => {
            if (!signingOut) {
              setLogoutOpen(false);
              setLogoutError(null);
            }
          }}
        />
      )}

      {helpFallback && (
        <ConfirmDialog
          title="Contact Support"
          message={`We couldn't open your email app.\n\nReach us at: ${SUPPORT_EMAIL}`}
          confirmLabel="Copy Email"
          cancelLabel="Close"
          onConfirm={() => {
            void navigator.clipboard?.writeText(SUPPORT_EMAIL).catch(() => {});
            setHelpFallback(false);
          }}
          onCancel={() => setHelpFallback(false)}
        />
      )}
    </div>
  );
}

function MenuRow({
  icon,
  onClick,
  children,
  count,
  className = "",
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
  /** Right-aligned count, matching mobile's badge on this same row. */
  count?: number;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] font-medium text-gray-800 transition-colors hover:bg-black/[0.035] focus:outline-none focus-visible:bg-black/[0.05] ${className}`}
    >
      <span className="text-gray-700" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      {typeof count === "number" && count > 0 && (
        <span className="text-[13px] font-semibold" style={{ color: "#0FA6A6" }}>
          {count}
        </span>
      )}
    </button>
  );
}
