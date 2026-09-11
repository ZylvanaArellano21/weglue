"use client";

import { useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { WebContinue } from "../../../components/auth/WebContinue";

type State = "prompt" | "verifying" | "confirmed" | "expired";

function readFragmentTokens(): { access_token: string; refresh_token: string } | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const access_token = p.get("access_token");
  if (!access_token) return null;
  return { access_token, refresh_token: p.get("refresh_token") ?? "" };
}

// The one-time confirmation token is NEVER consumed on page load — not by a
// mail scanner, a link-preview crawler, the mail client's prefetch, or the
// email provider's click-tracking redirector. This page shows a "Confirm my
// email" button and only calls verifyOtp when the person deliberately presses
// it. A plain GET (even one that runs JS) never reaches the token.
//
// The native app is unaffected: an Android App Link / iOS Universal Link only
// fires on a real user tap and cannot be triggered by a crawler, so
// useAuthDeepLink verifies on open there as before.
export default function FragmentConfirm(): JSX.Element {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const code = params.get("code");
  const linkType = params.get("type");
  const isEmailChange = params.get("flow") === "email_change";

  const [fragment] = useState(readFragmentTokens);
  const hasCredential = Boolean(tokenHash || code || fragment);

  const [state, setState] = useState<State>(hasCredential ? "prompt" : "expired");

  // Dedicated client with detectSessionInUrl OFF — nothing auto-consumes a
  // code / fragment just because this component mounted. Created once.
  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } }
    )
  );

  async function confirmEmail() {
    if (state === "verifying") return;
    setState("verifying");

    const hadSessionBefore = !!(await supabase.auth.getSession()).data.session;
    let consumed = false;

    if (tokenHash) {
      const otpType = (linkType ??
        (isEmailChange ? "email_change" : "signup")) as
        | "signup"
        | "email"
        | "email_change"
        | "recovery";
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (!error) consumed = true;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) consumed = true;
    } else if (fragment) {
      const { error } = await supabase.auth.setSession({
        access_token: fragment.access_token,
        refresh_token: fragment.refresh_token,
      });
      if (!error) consumed = true;
    }

    const hasSessionNow = !!(await supabase.auth.getSession()).data.session;
    if (!consumed && !hasSessionNow) {
      setState("expired");
      return;
    }

    // A signup confirmation session exists ONLY to mark the email confirmed
    // server-side — sign it back out so the person lands here signed OUT and
    // logs in themselves (matches the native app's confirmed.tsx). Never sign
    // out a pre-existing session, and never for an email-change (meant to
    // apply to the signed-in user).
    if (consumed && !hadSessionBefore && !isEmailChange) {
      // Local scope only (task 7): this is a throwaway verification session in
      // THIS browser. The default (no scope = 'global') signOut revokes the
      // refresh token for every OTHER signed-in device/browser on this
      // account too — a plain signup-confirmation click would silently log
      // the user out of a session they already had open elsewhere.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {}
    }
    setState("confirmed");
  }

  if (state === "prompt" || state === "verifying") {
    return (
      <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-6">
        <div className="max-w-[400px] mx-auto text-center">
          <Image
            src="/logo.png"
            alt="We Glue"
            width={100}
            height={90}
            className="mb-6 mx-auto"
            priority
          />
          <h1 className="text-3xl font-bold text-gray-900 mb-2" style={{ fontFamily: "Zain, serif" }}>
            {isEmailChange ? "Confirm your new email" : "Confirm your email"}
          </h1>
          <p className="text-sm text-gray-400 mb-8">Connection starts with you</p>
          <p className="text-sm text-gray-600 leading-relaxed mb-8">
            {isEmailChange
              ? "Tap the button below to confirm your new email address."
              : "Tap the button below to verify your email address and finish setting up your We Glue account."}
          </p>
          <button
            type="button"
            onClick={() => void confirmEmail()}
            disabled={state === "verifying"}
            className="inline-flex items-center justify-center h-[48px] px-10 rounded-full font-semibold text-base text-white disabled:opacity-60"
            style={{ backgroundColor: "#0FA6A6", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}
          >
            {state === "verifying" ? "Confirming…" : "Confirm my email"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-6">
      <div className="max-w-[400px] mx-auto text-center">
        <Image
          src="/logo.png"
          alt="We Glue"
          width={100}
          height={90}
          className="mb-6 mx-auto"
          priority
        />

        {state === "confirmed" ? (
          <>
            <h1 className="text-3xl font-bold text-gray-900 mb-2" style={{ fontFamily: "Zain, serif" }}>
              Your email has been confirmed
            </h1>
            <p className="text-sm text-gray-400 mb-8">Connection starts with you</p>

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

            {isEmailChange ? (
              <p className="text-sm text-gray-600 leading-relaxed">
                You can go back to We Glue now.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-600 leading-relaxed">
                  You can go back to We Glue now and click{" "}
                  <span className="text-[#0FA6A6] font-semibold">Login</span>.
                </p>
                {/* Only appears when this browser started a WEB signup —
                    routes on to the web Login, not an app-store prompt. */}
                <WebContinue />
              </>
            )}
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-full border-2 border-[#F02719] bg-red-50 flex items-center justify-center mx-auto mb-6">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#F02719"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>

            <h1 className="text-3xl font-bold text-gray-900 mb-2" style={{ fontFamily: "Zain, serif" }}>
              Confirmation link expired
            </h1>
            <p className="text-sm text-gray-400 mb-6">
              Please request a new confirmation email
            </p>

            {isEmailChange ? (
              <p className="text-sm text-gray-600 leading-relaxed">
                Go back to We Glue and try changing your email again from
                Account Center.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Return to We Glue and tap{" "}
                  <span className="font-semibold">&ldquo;Resend email&rdquo;</span>{" "}
                  to get a new link.
                </p>
                <p className="text-xs text-gray-400 leading-relaxed mt-4">
                  Already confirmed before? Your email may be verified already —
                  go back to We Glue and click{" "}
                  <span className="font-semibold">Login</span>.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
