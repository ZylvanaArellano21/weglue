"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "../../lib/supabase-browser";

const interactive =
  "rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2";

/** Public profile route for another user. */
export function getUserProfileHref(profileId: string): string {
  return `/u/${profileId}`;
}

export function getClubProfileHref(clubId: string): string {
  return `/club/${clubId}`;
}

/** The signed-in user's id, resolved client-side (undefined until known). */
function useCurrentUserId(): string | undefined {
  const [id, setId] = useState<string | undefined>(undefined);
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    void supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => setId(data.session?.user.id));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => setId(session?.user.id),
    );
    return () => subscription.unsubscribe();
  }, []);
  return id;
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
  const meId = useCurrentUserId();
  // Tapping your own identity anywhere opens canonical Your Profile.
  const href = meId && meId === userId ? "/profile" : getUserProfileHref(userId);
  return (
    <Link
      href={href}
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
