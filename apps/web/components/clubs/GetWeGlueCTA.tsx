"use client";

import { useEffect, useState } from "react";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  DOWNLOAD_APP_URL,
  downloadTargetFromClient,
} from "../../lib/deviceRouting";

// The single conversion affordance on the public club twin. Every app-required
// action a logged-out visitor cannot perform (Join, RSVP, Chat, React, Comment,
// open an event, open a photo) routes here instead — the visitor is taken to
// the right place to get We Glue:
//
//   iPhone / iPad browser  → Apple App Store   (native listing)
//   Android browser        → Google Play
//   desktop / unknown      → weglue.app/download  (logo + QR + both buttons)
//
// Detection is the same navigator.maxTouchPoints logic the /download page uses
// (downloadTargetFromClient). Until it runs (SSR / first paint) the href is the
// device-agnostic /download page, so the control is always a valid link.

function useStoreHref(): string {
  const [href, setHref] = useState<string>(DOWNLOAD_APP_URL);
  useEffect(() => {
    const target = downloadTargetFromClient({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    });
    setHref(
      target === "app-store"
        ? APP_STORE_URL
        : target === "play-store"
          ? PLAY_STORE_URL
          : DOWNLOAD_APP_URL
    );
  }, []);
  return href;
}

type Variant = "primary" | "outline" | "chip" | "link";

const BASE: Record<Variant, string> = {
  // Matches the real Club Profile "Join" button (ClubProfileHeader).
  primary:
    "inline-flex items-center justify-center rounded-full bg-teal px-8 py-2.5 text-[15px] font-semibold text-white transition hover:opacity-90",
  // Matches the real "Joined" / chat pills (1.5px teal outline).
  outline:
    "inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-teal bg-transparent px-5 py-1.5 text-[14px] font-semibold text-teal transition hover:bg-teal/5",
  // Matches the compact right-rail RSVP button.
  chip: "inline-flex shrink-0 items-center justify-center rounded-full bg-teal px-4 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-90",
  link: "text-sm font-semibold text-teal hover:underline",
};

export function GetWeGlueCTA({
  label = "Get We Glue",
  variant = "primary",
  className = "",
  block = false,
}: {
  label?: string;
  variant?: Variant;
  className?: string;
  block?: boolean;
}): JSX.Element {
  const href = useStoreHref();
  return (
    <a
      href={href}
      className={`${BASE[variant]} ${block ? "w-full" : ""} ${className}`.trim()}
    >
      {label}
    </a>
  );
}
