"use client";

/**
 * "Get the full We Glue experience" — phone/tablet browsers only, shown
 * once the authenticated app is ready (gated on a real userId, mounted
 * alongside ForegroundNotificationBanner in providers.tsx's
 * SessionRealtimeHub, which only ever has a userId post-login).
 *
 * Never shown on desktop web, and iPad/Android-tablet browsers keep their
 * existing desktop-style layout underneath this — this prompt is the only
 * thing added for tablets, not a layout change.
 *
 * "Open We Glue": attempts the app's custom URL scheme first (reliable
 * open-if-installed signal, unlike a universal link which this page can't
 * observe interception of) and falls back to the correct store after a
 * short delay ONLY if the tab is still visible then — if the OS actually
 * opened the app, the browser tab backgrounds, so the fallback never fires.
 */
import Image from "next/image";
import { useEffect, useState } from "react";

type Bucket = "iphone" | "ipad" | "android-phone" | "android-tablet" | "desktop";

// Same detection as apps/web/app/download/page.tsx — duplicated per that
// file's own documented convention (each client surface keeps its own copy
// rather than share across bundles).
function detectBucket(): Bucket {
  const ua = navigator.userAgent;
  const isIPhone = /iPhone/i.test(ua);
  const isIPadUserAgent = /iPad/i.test(ua);
  // iPadOS 13+ Safari reports a Mac User-Agent by default; a Mac with a
  // touchscreen does not exist, so touch points > 1 on a "Macintosh" UA
  // means iPad.
  const isIPadOsAsMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  const isAndroid = /Android/i.test(ua);
  // Android tablets omit the "Mobile" token that Android phones include.
  const isAndroidTablet = isAndroid && !/Mobile/i.test(ua);

  if (isIPhone) return "iphone";
  if (isIPadUserAgent || isIPadOsAsMac) return "ipad";
  if (isAndroidTablet) return "android-tablet";
  if (isAndroid) return "android-phone";
  return "desktop";
}

// Same two literals as apps/web/app/download/page.tsx / apps/web/app/invite/
// [token]/page.tsx.
const APP_STORE_URL = "https://apps.apple.com/app/we-glue/id6786491344";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.weglue.app";
const APP_SCHEME_URL = "weglue://";
const DISMISSED_KEY = "weglue-get-app-prompt-dismissed";
const FALLBACK_DELAY_MS = 1500;

export function GetTheAppPrompt({ userId }: { userId: string | undefined }): JSX.Element | null {
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    setBucket(detectBucket());
    try {
      setDismissed(sessionStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, [userId]);

  if (!userId || dismissed || bucket === null || bucket === "desktop") return null;

  const storeUrl = bucket === "iphone" || bucket === "ipad" ? APP_STORE_URL : PLAY_STORE_URL;

  const handleOpen = () => {
    let fallbackFired = false;
    const fallback = () => {
      if (fallbackFired) return;
      fallbackFired = true;
      // The tab only backgrounds if the OS actually switched to the app —
      // a bare failed custom-scheme navigation leaves this tab visible.
      if (document.visibilityState === "hidden") return;
      window.location.href = storeUrl;
    };
    window.location.href = APP_SCHEME_URL;
    setTimeout(fallback, FALLBACK_DELAY_MS);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Best-effort — worst case it can show once more this same tab.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/50 px-4 pb-6 sm:pb-4"
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-[#FEFCF0] px-6 py-7 text-center shadow-2xl">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-[#9CA3AF] hover:text-[#5F5D5D]"
        >
          ×
        </button>
        <Image src="/logo.png" alt="We Glue" width={56} height={56} className="mx-auto" priority />
        <h2 className="mt-4 text-lg font-bold text-black">Get the full We Glue experience</h2>
        <button
          type="button"
          onClick={handleOpen}
          className="mt-5 w-full rounded-full bg-[#0FA6A6] py-3 text-sm font-semibold text-white hover:bg-[#0d9494] transition-colors"
        >
          Open We Glue
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="mt-3 text-sm font-medium text-[#5F5D5D] hover:underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
