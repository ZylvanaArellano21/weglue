"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/**
 * Handles the Supabase *default mailer* confirmation flow.
 *
 * The default mailer's link ({{ .ConfirmationURL }}) hits Supabase's
 * /auth/v1/verify endpoint, which redirects back to this page with the session
 * tokens in the URL *fragment*:
 *
 *   https://weglue.app/auth/confirm#access_token=...&refresh_token=...&type=signup
 *
 * Fragments are never sent to the server, so the server component in page.tsx
 * can't see them and renders its "expired" fallback. This client component runs
 * in the browser, reads the fragment, and overlays the success screen on top.
 *
 * It is purely additive: it renders nothing (null) unless a valid token fragment
 * is present, leaving the server-rendered token_hash / code / expired logic in
 * page.tsx completely untouched.
 */

const TEAL = "#0FA6A6";
const CREAM = "#FEFCF0";
const INK = "#1a1a1a";
const MUTED = "#5F5D5D";
const APP_DEEP_LINK_SCHEME = "weglue://auth/confirmed";
const DEEP_LINK_FALLBACK_DELAY_MS = 2000;

function buildAppDeepLink(accessToken: string, refreshToken: string): string {
  return (
    `${APP_DEEP_LINK_SCHEME}#access_token=${encodeURIComponent(accessToken)}` +
    `&refresh_token=${encodeURIComponent(refreshToken)}`
  );
}

export default function FragmentConfirm() {
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    setDeepLinkUrl(buildAppDeepLink(accessToken, refreshToken));
  }, []);

  useEffect(() => {
    if (!deepLinkUrl) return;
    // Try to open the app automatically; reveal the manual fallback if it
    // doesn't take over the page within a short window.
    window.location.replace(deepLinkUrl);
    const timer = window.setTimeout(
      () => setShowFallback(true),
      DEEP_LINK_FALLBACK_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [deepLinkUrl]);

  if (!deepLinkUrl) return null;

  return (
    <main
      style={{ backgroundColor: CREAM }}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <Image
          src="/logo.png"
          alt="We Glue"
          width={100}
          height={90}
          className="mb-6"
          priority
        />

        <h1
          className="font-zain text-3xl font-bold mb-2"
          style={{ color: INK }}
        >
          Your email has been confirmed
        </h1>
        <p className="text-sm mb-10" style={{ color: MUTED }}>
          Connection starts with you
        </p>

        <div
          className="flex items-center justify-center mb-10"
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: `3px solid ${TEAL}`,
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke={TEAL}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <a
          href={deepLinkUrl}
          className="w-full rounded-full font-semibold text-white text-base py-4 mb-4 transition-opacity hover:opacity-90 text-center block"
          style={{
            backgroundColor: TEAL,
            maxWidth: 320,
            lineHeight: "1.5rem",
            paddingTop: "1rem",
            paddingBottom: "1rem",
            textDecoration: "none",
          }}
        >
          Go back to We Glue
        </a>

        <p
          className="text-xs mt-2 text-center"
          style={{ color: MUTED, display: showFallback ? "block" : "none" }}
        >
          Open the We Glue app on your phone to continue.
        </p>
      </div>
    </main>
  );
}
