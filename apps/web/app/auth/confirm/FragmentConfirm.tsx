"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { WebContinue } from "../../../components/auth/WebContinue";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";

type State = "loading" | "confirmed" | "expired";

// Email verification is consumed HERE, in the person's own browser, on their
// real visit — never in a server GET.
//
// This page used to verify the token in an async Server Component on every
// GET. A confirmation token is single-use, and a GET is not always a human:
// mail security scanners, link-preview crawlers and the mail client's own
// prefetch all fetch the link first, which burned the token before the person
// ever tapped it — a "confirmation link expired" message on a link nobody had
// used. Verification now happens client-side, where a scanner's plain GET
// (which runs no JS) can never reach it.
//
//  - ?token_hash=…   verified explicitly with verifyOtp (detectSessionInUrl
//                    does not handle it)
//  - ?code= / #access_token=…  consumed automatically by the browser client;
//                    we wait for the resulting session
export default function FragmentConfirm(): JSX.Element {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const code = params.get("code");
  const linkType = params.get("type");
  const isEmailChange = params.get("flow") === "email_change";

  const [state, setState] = useState<State>("loading");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const supabase = getSupabaseBrowser();
    let cancelled = false;

    async function run() {
      let ok = false;

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
        if (!error) ok = true;
      }

      const hasFragment =
        typeof window !== "undefined" &&
        /(?:^|[#&])access_token=/.test(window.location.hash);

      if (!ok && (code || hasFragment)) {
        for (let i = 0; i < 16 && !cancelled; i++) {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            ok = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      if (!ok && !cancelled) {
        // The person may have already verified from an earlier tap of the
        // same link — an existing session still means "you're confirmed".
        const { data } = await supabase.auth.getSession();
        ok = !!data.session;
      }

      if (cancelled) return;

      if (ok) {
        // A signup-confirmation session exists ONLY to mark the email
        // confirmed server-side — sign it back out so the person lands here
        // signed OUT and logs in themselves (matches the native app's
        // confirmed.tsx and its notification-permission gating). An
        // email-change confirmation is meant to apply to the already
        // signed-in user, so that session is left alone.
        if (!isEmailChange) {
          try {
            await supabase.auth.signOut();
          } catch {}
        }
        setState("confirmed");
      } else {
        setState("expired");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [tokenHash, code, linkType, isEmailChange]);

  if (state === "loading") {
    return (
      <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#0FA6A6", borderTopColor: "transparent" }}
          />
          <p className="text-sm text-gray-500">Verifying your link…</p>
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
            <h1 className="font-zain text-3xl font-bold text-gray-900 mb-2">
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

            <h1 className="font-zain text-3xl font-bold text-gray-900 mb-2">
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
                  Already tapped a link before? Your email may be verified
                  already — go back to We Glue and click{" "}
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
