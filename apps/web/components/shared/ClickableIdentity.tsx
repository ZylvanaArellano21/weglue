"use client";

import Link from "next/link";
import type { ReactNode } from "react";

const interactive =
  "rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2";

export function getUserProfileHref(profileId: string): string {
  return `/u/${profileId}`;
}

export function getClubProfileHref(clubId: string): string {
  return `/club/${clubId}`;
}

/** Canonical profile link used anywhere a user identity is actionable. */
export function ClickableUserIdentity({
  userId,
  children,
  className = "",
  ariaLabel,
}: {
  userId: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <Link
      href={getUserProfileHref(userId)}
      aria-label={ariaLabel}
      className={`${interactive} ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}

/** Canonical club route used for handles, names, and club avatars. */
export function ClickableClubIdentity({
  clubId,
  children,
  className = "",
  ariaLabel,
}: {
  clubId: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <Link
      href={getClubProfileHref(clubId)}
      aria-label={ariaLabel}
      className={`${interactive} ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}
