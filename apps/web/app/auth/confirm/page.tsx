"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type PageState = "loading" | "success" | "error";

export default function AuthConfirmPage() {
  const [state, setState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [deepLinkUrl, setDeepLinkUrl] = useState("");
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    async function confirm() {
      const supabase = createClient();

      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const queryParams = new URLSearchParams(window.location.search);

      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");
      const token_hash =
        queryParams.get("token_hash") ?? hashParams.get("token_hash");
      const type =
        queryParams.get("type") ?? hashParams.get("type") ?? "signup";
      const code = queryParams.get("code");

      try {
        let sessionTokens: {
          access_token: string;
          refresh_token: string;
        } | null = null;

        if (token_hash) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash,
            type: type as "signup" | "email",
          });
          if (error) throw error;
          if (data.session) {
            sessionTokens = {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            };
          }
        } else if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) throw error;
          if (data.session) {
            sessionTokens = {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            };
          }
        } else if (code) {
          const { data, error } =
            await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (data.session) {
            sessionTokens = {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            };
          }
        } else {
          throw new Error("No valid auth token found in the confirmation URL.");
        }

        let deepLink = "weglue://auth/confirmed";
        if (sessionTokens) {
          deepLink += `#access_token=${encodeURIComponent(sessionTokens.access_token)}&refresh_token=${encodeURIComponent(sessionTokens.refresh_token)}`;
        }

        setDeepLinkUrl(deepLink);
        setState("success");

        // Auto-open the app
        window.location.href = deepLink;

        // Show fallback message if deep link didn't open
        setTimeout(() => setShowFallback(true), 2000);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Email verification failed.";
        setErrorMsg(message);
        setState("error");
      }
    }

    confirm();
  }, []);

  function handleOpenApp() {
    if (deepLinkUrl) {
      window.location.href = deepLinkUrl;
      setTimeout(() => setShowFallback(true), 1500);
    }
  }

  async function handleResend() {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) {
      await supabase.auth.resend({ type: "signup", email: data.user.email });
    }
    window.location.href = "/auth/verify-email";
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zain:wght@700&display=swap');
        .font-zain { font-family: 'Zain', serif; }
      `}</style>

      <main
        style={{ backgroundColor: "#FEFCF0" }}
        className="min-h-screen flex items-center justify-center px-4"
      >
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          {/* Logo */}
          <Image
            src="/logo.png"
            alt="We Glue"
            width={100}
            height={90}
            className="mb-6"
            priority
          />

          {state === "loading" && (
            <>
              <div
                className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin mb-6"
                style={{ borderColor: "#0FA6A6", borderTopColor: "transparent" }}
              />
              <p className="text-sm" style={{ color: "#5F5D5D" }}>
                Verifying your email…
              </p>
            </>
          )}

          {state === "success" && (
            <>
              {/* Teal checkmark circle */}
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
                style={{ backgroundColor: "#0FA6A6" }}
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <h1
                className="font-zain text-3xl font-bold mb-2"
                style={{ color: "#111" }}
              >
                Your email has been confirmed
              </h1>
              <p className="text-sm mb-8" style={{ color: "#5F5D5D" }}>
                Connection starts with you
              </p>

              {/* Open app button */}
              <button
                onClick={handleOpenApp}
                className="w-full h-13 rounded-full font-semibold text-white text-base py-4 mb-4 transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#0FA6A6" }}
              >
                Go back to We Glue
              </button>

              {showFallback && (
                <p className="text-xs mt-2" style={{ color: "#5F5D5D" }}>
                  Open the We Glue app on your phone to continue.
                </p>
              )}
            </>
          )}

          {state === "error" && (
            <>
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center mb-6 bg-red-100"
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#EF4444"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>

              <h1
                className="font-zain text-2xl font-bold mb-2"
                style={{ color: "#111" }}
              >
                Verification failed
              </h1>
              <p className="text-sm mb-8" style={{ color: "#5F5D5D" }}>
                {errorMsg || "This link may have expired or already been used."}
              </p>

              <button
                onClick={handleResend}
                className="w-full h-12 rounded-full font-semibold border-2 text-sm transition-colors hover:bg-teal-50"
                style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
              >
                Resend verification email
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
