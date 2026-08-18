"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import qrcode from "qrcode-generator";

// Same URLs as apps/web/app/invite/[token]/page.tsx (APP_STORE_URL /
// PLAY_STORE_URL there). Not imported directly: that file also imports
// next/headers + the server Supabase client, and pulling any export from it
// into this Client Component would drag server-only code into the client
// bundle. Keep these two literals in sync with that file if the store
// listing ever moves.
const APP_STORE_URL = "https://apps.apple.com/app/we-glue/id6786491344";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.weglue.app";

// Dedicated download destination. Replaces the old /get-started interstitial
// (which mixed "download the app" with "continue on the web" / login / the
// survey — all removed here on purpose). Every Download App CTA site-wide
// points here.
//
// Bucket detection is client-side because modern iPadOS Safari's
// User-Agent is indistinguishable from macOS server-side — there is no
// reliable way to tell an iPad from a laptop from the request headers alone.
// `mounted` gates the real content so the server-rendered HTML and the
// FIRST client render always match (no hydration mismatch); the real bucket
// is resolved in an effect immediately after.
type Bucket = "iphone" | "ipad" | "android-phone" | "android-tablet" | "desktop";

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

function qrSvgMarkup(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag(4, 2);
}

function QrCard({ label, url }: { label: string; url: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    setSvg(qrSvgMarkup(url));
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3 bg-[#FFFEF7] rounded-2xl shadow-[0px_8px_24px_rgba(0,0,0,0.1)] px-8 py-7">
      <div
        className="w-[176px] h-[176px] flex items-center justify-center [&_svg]:w-full [&_svg]:h-full"
        aria-label={`QR code for ${label}`}
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <p className="text-sm font-semibold text-black">{label}</p>
      <p className="text-xs text-[#5F5D5D] text-center max-w-[180px]">
        Scan with your phone camera to open the {label} listing.
      </p>
    </div>
  );
}

function StoreButton({ label, url }: { label: string; url: string }): JSX.Element {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full max-w-[332px] h-[64px] bg-[#0FA6A6] text-white font-semibold text-[18px] rounded-full flex items-center justify-center shadow-[0px_4px_6px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
    >
      {label}
    </a>
  );
}

export default function DownloadPage(): JSX.Element {
  const [mounted, setMounted] = useState(false);
  const [bucket, setBucket] = useState<Bucket>("desktop");

  useEffect(() => {
    setBucket(detectBucket());
    setMounted(true);
  }, []);

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-6 pt-[10vh] pb-16">
      <Image src="/logo.png" alt="We Glue" width={90} height={82} priority />
      <h1
        className="text-[28px] sm:text-[32px] font-bold text-black mt-6 text-center"
        style={{ fontFamily: "var(--font-zain)" }}
      >
        Get the We Glue app
      </h1>

      {!mounted ? (
        <div className="mt-12 flex h-[64px] items-center justify-center" aria-hidden>
          <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : bucket === "desktop" ? (
        <>
          <p className="text-sm text-[#5F5D5D] mt-2 mb-10 text-center max-w-md">
            Scan a code below with your phone to download We Glue.
          </p>
          <div className="flex flex-col sm:flex-row gap-6">
            <QrCard label="App Store" url={APP_STORE_URL} />
            <QrCard label="Google Play" url={PLAY_STORE_URL} />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[#5F5D5D] mt-2 mb-10 text-center max-w-md">
            Continue to the store to download We Glue.
          </p>
          {bucket === "iphone" || bucket === "ipad" ? (
            <StoreButton label="Continue to App Store" url={APP_STORE_URL} />
          ) : (
            <StoreButton label="Continue to Google Play" url={PLAY_STORE_URL} />
          )}
        </>
      )}

      <p className="mt-[8vh] text-[14px] font-semibold text-black">
        <Link
          href="/"
          className="text-[#0FA6A6] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
        >
          Back to home
        </Link>
      </p>
    </main>
  );
}
