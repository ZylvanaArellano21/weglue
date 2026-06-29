"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const TEAL = "#0FA6A6";
const CREAM = "#FEFCF0";
const INK = "#1a1a1a";
const MUTED = "#5F5D5D";

export default function FragmentConfirm() {
  const [hasTokens, setHasTokens] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get("access_token")) setHasTokens(true);
  }, []);

  if (!hasTokens) return null;

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

        <h1 className="font-zain text-3xl font-bold mb-2" style={{ color: INK }}>
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

        <p className="text-sm leading-relaxed max-w-[260px]" style={{ color: MUTED }}>
          You can go back to We Glue now and click the{" "}
          <span style={{ color: TEAL, fontWeight: 600 }}>Next</span> button.
        </p>
      </div>
    </main>
  );
}
