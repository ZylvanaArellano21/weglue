"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { WebContinue } from "../../../components/auth/WebContinue";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";

export default function FragmentConfirm(): JSX.Element | null {
  const [hasTokens, setHasTokens] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (!params.get("access_token")) return;
    setHasTokens(true);
    // The Supabase client auto-detects and establishes a session from this
    // fragment (detectSessionInUrl). That session exists only to consume the
    // verification token — sign it back out immediately so the user lands
    // here signed OUT and chooses to Log In themselves, same as the
    // server-side /auth/confirm path and the native app's confirmed.tsx.
    void getSupabaseBrowser().auth.signOut();
  }, []);

  if (!hasTokens) return null;

  return (
    <main className="fixed inset-0 z-50 bg-[#FEFCF0] flex items-center justify-center px-6">
      <div className="max-w-[400px] mx-auto text-center">
        <Image
          src="/logo.png"
          alt="We Glue"
          width={100}
          height={90}
          className="mb-6 mx-auto"
          priority
        />

        <h1 className="font-zain text-3xl font-bold text-gray-900 mb-2">
          Your email has been confirmed
        </h1>
        <p className="text-sm text-gray-400 mb-8">
          Connection starts with you
        </p>

        <div className="w-20 h-20 rounded-full border-2 border-[#0FA6A6] flex items-center justify-center mx-auto mb-8">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0FA6A6"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">
          You can go back to We Glue now and click{" "}
          <span className="text-[#0FA6A6] font-semibold">Login</span>.
        </p>

        {/* Only appears when this browser started a WEB signup. */}
        <WebContinue />
      </div>
    </main>
  );
}
