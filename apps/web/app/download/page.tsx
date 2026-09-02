"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import qrcode from "qrcode-generator";
import {
  APP_STORE_URL,
  DOWNLOAD_APP_URL,
  PLAY_STORE_URL,
  downloadTargetFromClient,
} from "../../lib/deviceRouting";

// The /download page is the single permanent QR destination (see
// lib/deviceRouting.ts). Middleware already bounced unambiguous phones to
// their store; this component handles everything it passed through:
//   - modern iPadOS Safari ("Macintosh" UA + touch) -> App Store, client-side
//   - Mac / Windows / Linux / unknown desktop       -> render this page
//
// `resolved` gates the real content so the server-rendered HTML and the first
// client render always match (no hydration mismatch); the device check runs in
// an effect immediately after mount. Desktop / unknown visitors stay here -
// they are never forwarded to the marketing landing page.

function qrSvgMarkup(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag(4, 2);
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
  const [resolved, setResolved] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  useEffect(() => {
    const target = downloadTargetFromClient(navigator);
    if (target === "app-store") {
      window.location.replace(APP_STORE_URL);
      return;
    }
    if (target === "play-store") {
      window.location.replace(PLAY_STORE_URL);
      return;
    }
    setQrSvg(qrSvgMarkup(DOWNLOAD_APP_URL));
    setResolved(true);
  }, []);

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-6 pt-[10vh] pb-16">
      <Image src="/logo.png" alt="We Glue" width={90} height={82} priority />
      <h1
        className="text-[28px] sm:text-[32px] font-bold text-black mt-6 text-center"
        style={{ fontFamily: "var(--font-zain)" }}
      >
        Download We Glue
      </h1>

      {!resolved ? (
        <div className="mt-12 flex h-[64px] items-center justify-center" aria-hidden>
          <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-sm text-[#5F5D5D] mt-2 mb-10 text-center max-w-md">
            Scan the code with your phone camera, or use a button below.
          </p>

          <div
            className="w-[240px] h-[240px] bg-[#FFFEF7] rounded-2xl shadow-[0px_8px_24px_rgba(0,0,0,0.1)] p-4 flex items-center justify-center [&_svg]:w-full [&_svg]:h-full"
            role="img"
            aria-label="QR code to download We Glue"
            dangerouslySetInnerHTML={qrSvg ? { __html: qrSvg } : undefined}
          />

          <div className="mt-10 flex flex-col items-center gap-4 w-full">
            <StoreButton label="Download on the App Store" url={APP_STORE_URL} />
            <StoreButton label="Get it on Google Play" url={PLAY_STORE_URL} />
          </div>

          <p className="mt-[8vh] text-[14px] font-semibold text-black">
            <Link
              href="/"
              className="text-[#0FA6A6] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
            >
              Back to home
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
