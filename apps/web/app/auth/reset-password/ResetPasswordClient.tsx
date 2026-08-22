"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";
import {
  checkPassword,
  passwordError,
  resetPasswordRedirect,
} from "../../../lib/authFlow";

type View = "loading" | "form" | "success" | "expired";

const LogoBlock = () => (
  <div className="flex flex-col items-center mb-8">
    <Image src="/logo.png" alt="We Glue" width={70} height={64} className="mb-3" priority />
    <span className="text-2xl font-bold" style={{ fontFamily: "Zain, serif", color: "#1a1a1a" }}>
      We Glue
    </span>
  </div>
);

export default function ResetPasswordClient({
  serverExchanged,
}: {
  serverExchanged: boolean;
}): JSX.Element | null {
  const [view, setView] = useState<View>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Expired view: self-serve "send me a new link" form
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendResult, setResendResult] = useState<"sent" | "error" | null>(null);

  async function handleResendReset(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = resendEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setResendResult("error");
      return;
    }
    setResendLoading(true);
    setResendResult(null);
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: resetPasswordRedirect(),
    });
    setResendLoading(false);
    setResendResult(error ? "error" : "sent");
  }

  useEffect(() => {
    async function resolveSession() {
      const supabase = getSupabaseBrowser();

      // The server already exchanged a `code` or `token_hash` query param
      // (see page.tsx) — that set a session cookie shared with this browser
      // client via @supabase/ssr. Confirm it actually landed before trusting
      // it; getSession() reads the cookie, no network round trip.
      if (serverExchanged) {
        const { data } = await supabase.auth.getSession();
        setView(data.session ? "form" : "expired");
        return;
      }

      // Legacy implicit flow: tokens only ever exist in the URL fragment,
      // which the server can never read, so this is the one case the server
      // could not have already handled.
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

      if (hash) {
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token") ?? "";
        const type = hashParams.get("type");

        if (accessToken && type === "recovery") {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          setView(error ? "expired" : "form");
          return;
        }
      }

      setView("expired");
    }

    resolveSession();
  }, [serverExchanged]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!password || !confirmPassword) {
      setErrorMessage("Please fill in both fields.");
      return;
    }
    // Same password rules as account creation (mobile parity).
    const pwError = passwordError(password);
    if (pwError) {
      setErrorMessage(pwError);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords don't match. Try again.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      setErrorMessage(error.message || "Something went wrong. Please try again.");
      return;
    }

    // The recovery session has done its one job — end it so the user signs in
    // freshly with the new password and is never left half-authenticated on
    // this recovery route.
    await supabase.auth.signOut();
    setLoading(false);
    setView("success");
  }

  if (view === "loading") {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#FEFCF0" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#0FA6A6", borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: "#6B7280" }}>
            Verifying your link...
          </p>
        </div>
      </main>
    );
  }

  if (view === "success") {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: "#FEFCF0" }}
      >
        <div className="w-full max-w-[400px] flex flex-col items-center text-center">
          <LogoBlock />

          <div
            className="flex items-center justify-center mb-6"
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              border: "2px solid #0FA6A6",
            }}
          >
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

          <h1 className="text-3xl font-bold" style={{ fontFamily: "Zain, serif", color: "#1a1a1a" }}>
            Password updated!
          </h1>
          <p className="text-sm mt-1" style={{ color: "#9CA3AF" }}>
            Connection starts with you
          </p>

          <div className="mt-4 max-w-[300px] mx-auto">
            <p className="text-sm leading-relaxed" style={{ color: "#4B5563" }}>
              Your password has been updated. Log in with your new password.
            </p>

            <Link
              href="/login"
              className="inline-flex items-center justify-center h-[48px] px-10 mt-5 rounded-full font-semibold text-base text-white"
              style={{
                backgroundColor: "#0FA6A6",
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              }}
            >
              Go to Log In
            </Link>

            <p className="text-xs mt-4" style={{ color: "#9CA3AF" }}>
              Using the We Glue app? Head back to the app and log in there — you
              can close this tab.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (view === "expired") {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: "#FEFCF0" }}
      >
        <div className="w-full max-w-[400px] flex flex-col items-center text-center">
          <LogoBlock />

          <div
            className="flex items-center justify-center mb-6"
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              border: "2px solid #F02719",
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#F02719"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold" style={{ fontFamily: "Zain, serif", color: "#1a1a1a" }}>
            Link expired
          </h1>
          <p className="text-sm mt-1" style={{ color: "#9CA3AF" }}>
            Connection starts with you
          </p>

          <div className="mt-4 max-w-[300px] mx-auto w-full">
            <p className="text-sm leading-relaxed" style={{ color: "#4B5563" }}>
              This reset link has expired or has already been used.
            </p>
            <p className="text-sm leading-relaxed mt-2" style={{ color: "#4B5563" }}>
              Enter your email and we&apos;ll send you a fresh link:
            </p>

            <form onSubmit={handleResendReset} className="mt-4 flex flex-col gap-3">
              <input
                type="email"
                value={resendEmail}
                onChange={(e) => {
                  setResendEmail(e.target.value);
                  setResendResult(null);
                }}
                placeholder="yourname@email.com"
                className="h-[48px] rounded-xl border px-4 text-sm outline-none"
                style={{
                  backgroundColor: "#FEFCF0",
                  borderColor: resendResult === "error" ? "#F02719" : "rgba(0,0,0,0.2)",
                  color: "#1a1a1a",
                }}
              />
              <button
                type="submit"
                disabled={resendLoading || resendResult === "sent"}
                className="h-[48px] rounded-full font-semibold text-sm text-white disabled:opacity-60 flex items-center justify-center"
                style={{
                  backgroundColor: "#0FA6A6",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                }}
              >
                {resendLoading
                  ? "Sending…"
                  : resendResult === "sent"
                  ? "Email sent!"
                  : "Send New Reset Link"}
              </button>
            </form>

            {resendResult === "sent" && (
              <p className="text-sm mt-3" style={{ color: "#16A34A" }}>
                Check your inbox, spam, and junk folders for the new reset
                link.
              </p>
            )}
            {resendResult === "error" && (
              <p className="text-sm mt-3" style={{ color: "#F02719" }}>
                Couldn&apos;t send the email. Check the address and try again.
              </p>
            )}

            <p className="text-xs mt-4" style={{ color: "#9CA3AF" }}>
              Or go back to the We Glue app and request a new link from the
              login screen.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // view === "form"
  const pw = checkPassword(password);
  const hintColor = (ok: boolean) =>
    password.length === 0 ? "#9CA3AF" : ok ? "#0FA6A6" : "#F02719";

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: "#FEFCF0" }}
    >
      <div className="w-full max-w-[400px]">
        <LogoBlock />

        <h2
          className="text-3xl font-bold mb-1"
          style={{ fontFamily: "Zain, serif", color: "#1a1a1a" }}
        >
          Create a new password
        </h2>
        <p className="text-sm mb-6" style={{ color: "#6B7280" }}>
          Your new password must be different from your previous one.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* New password */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
              style={{ color: "#374151" }}
            >
              New Password
            </label>
            <div
              className="flex items-center rounded-xl border px-4 h-[53px] transition-colors"
              style={{
                backgroundColor: "#FEFCF0",
                borderColor: errorMessage ? "#F02719" : "rgba(0,0,0,0.2)",
                boxShadow: "0 4px 8px rgba(0,0,0,0.08)",
              }}
            >
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "#1a1a1a", fontFamily: "Inter, sans-serif" }}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage(null);
                }}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="text-sm font-semibold ml-2 cursor-pointer"
                style={{ color: "#0FA6A6" }}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {/* Same requirement hints as account creation (mobile parity) */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              <span className="text-xs font-medium" style={{ color: hintColor(pw.minLength) }}>
                Min. 8 characters
              </span>
              <span className="text-xs font-medium" style={{ color: hintColor(pw.hasCapital) }}>
                1 capital letter
              </span>
              <span className="text-xs font-medium" style={{ color: hintColor(pw.hasNumber) }}>
                1 number
              </span>
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium mb-1"
              style={{ color: "#374151" }}
            >
              Confirm Password
            </label>
            <div
              className="flex items-center rounded-xl border px-4 h-[53px] transition-colors"
              style={{
                backgroundColor: "#FEFCF0",
                borderColor: errorMessage ? "#F02719" : "rgba(0,0,0,0.2)",
                boxShadow: "0 4px 8px rgba(0,0,0,0.08)",
              }}
            >
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "#1a1a1a", fontFamily: "Inter, sans-serif" }}
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setErrorMessage(null);
                }}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="text-sm font-semibold ml-2 cursor-pointer"
                style={{ color: "#0FA6A6" }}
                onClick={() => setShowConfirmPassword((v) => !v)}
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="text-sm mt-3" style={{ color: "#F02719" }}>
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-[52px] rounded-full font-semibold text-base text-white transition-opacity disabled:opacity-60 mt-2 flex items-center justify-center gap-2"
            style={{
              backgroundColor: "#0FA6A6",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            }}
          >
            {loading ? (
              <div
                className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "#fff", borderTopColor: "transparent" }}
              />
            ) : (
              "Update Password"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
