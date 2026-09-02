"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import {
  checkPassword,
  passwordError,
  sendPasswordResetEmail,
} from "../../../lib/authFlow";

type View = "form" | "success" | "expired";

const LogoBlock = () => (
  <div className="flex flex-col items-center mb-8">
    <Image src="/logo.png" alt="We Glue" width={70} height={64} className="mb-3" priority />
    <span className="text-2xl font-bold" style={{ fontFamily: "Zain, serif", color: "#1a1a1a" }}>
      We Glue
    </span>
  </div>
);

function readFragmentTokens(): { access_token: string; refresh_token: string } | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const access_token = p.get("access_token");
  if (!access_token || p.get("type") !== "recovery") return null;
  return { access_token, refresh_token: p.get("refresh_token") ?? "" };
}

export default function ResetPasswordClient({
  tokenHash,
  linkType: _linkType,
  code,
}: {
  tokenHash: string | null;
  linkType: string | null;
  code: string | null;
}): JSX.Element | null {
  // Is there any recovery credential attached to this visit? If not, there is
  // nothing to reset — go straight to the self-serve resend.
  const fragment = useMemo(readFragmentTokens, []);
  const hasCredential = Boolean(tokenHash || code || fragment);

  const [view, setView] = useState<View>(hasCredential ? "form" : "expired");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Expired view: self-serve "send me a new link" form. It goes through the
  // shared authFlow helper (claim-first 60s cooldown + real Supabase error
  // mapping) — never a bare resetPasswordForEmail that collapses every failure,
  // including a server cooldown, into "check the address".
  const [resendEmail, setResendEmail] = useState("");
  const [resend, setResend] = useState<
    | { state: "idle" | "sending" | "sent" }
    | { state: "cooldown"; seconds: number }
    | { state: "error"; message: string }
  >({ state: "idle" });

  // A dedicated Supabase client with detectSessionInUrl DISABLED. The one-time
  // recovery token must never be consumed just because this page loaded — not
  // by a mail scanner, a link preview, or the app's own auto-detection. Nothing
  // here touches the token until the person deliberately submits a new password
  // below. (The app-wide client in providers.tsx keeps its normal behaviour;
  // this page does its own thing.)
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { detectSessionInUrl: false } }
      ),
    []
  );

  // Live countdown for the resend cooldown.
  useEffect(() => {
    if (resend.state !== "cooldown") return;
    if (resend.seconds <= 0) {
      setResend({ state: "idle" });
      return;
    }
    const id = window.setTimeout(
      () => setResend({ state: "cooldown", seconds: resend.seconds - 1 }),
      1000
    );
    return () => window.clearTimeout(id);
  }, [resend]);

  async function handleResendReset(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = resendEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setResend({
        state: "error",
        message: "Enter the email address you used to sign up.",
      });
      return;
    }
    setResend({ state: "sending" });
    const result = await sendPasswordResetEmail(trimmed);
    if (result.ok) {
      setResend({ state: "sent" });
      return;
    }
    if ("cooldown" in result) {
      setResend({ state: "cooldown", seconds: result.cooldown });
      return;
    }
    setResend({ state: "error", message: result.message });
  }

  /** Consume the recovery credential — ONLY called from handleSubmit, i.e. only
   *  after the person has deliberately entered a new password and pressed the
   *  button. Returns true once a valid recovery session is established. */
  async function establishRecoverySession(): Promise<boolean> {
    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });
      if (!error) return true;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return true;
    } else if (fragment) {
      const { error } = await supabase.auth.setSession({
        access_token: fragment.access_token,
        refresh_token: fragment.refresh_token,
      });
      if (!error) return true;
    }
    // The explicit consumption above failed (token used / expired, or a PKCE
    // code opened in a browser without its verifier). If the app-wide client
    // already turned a fragment/code into a session on this same browser, that
    // still counts.
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  }

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
    setErrorMessage(null);

    const ok = await establishRecoverySession();
    if (!ok) {
      setLoading(false);
      // The link is spent or expired. Send them to the self-serve resend
      // rather than a raw Supabase string.
      setView("expired");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setLoading(false);
      const msg = (error.message ?? "").toLowerCase();
      if (
        msg.includes("session") ||
        msg.includes("jwt") ||
        msg.includes("token") ||
        error.status === 401
      ) {
        setView("expired");
        return;
      }
      if (msg.includes("same") && msg.includes("password")) {
        setErrorMessage("Your new password must be different from your old one.");
        return;
      }
      setErrorMessage(error.message || "Something went wrong. Please try again.");
      return;
    }

    // The recovery session has done its one job — end it so the person signs
    // in freshly with the new password and is never left half-authenticated on
    // this recovery route.
    await supabase.auth.signOut();
    setLoading(false);
    setView("success");
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
    const disabled = resend.state === "sending" || resend.state === "sent";
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
                  if (resend.state === "error") setResend({ state: "idle" });
                }}
                placeholder="yourname@email.com"
                className="h-[48px] rounded-xl border px-4 text-sm outline-none"
                style={{
                  backgroundColor: "#FEFCF0",
                  borderColor: resend.state === "error" ? "#F02719" : "rgba(0,0,0,0.2)",
                  color: "#1a1a1a",
                }}
              />
              <button
                type="submit"
                disabled={disabled || resend.state === "cooldown"}
                className="h-[48px] rounded-full font-semibold text-sm text-white disabled:opacity-60 flex items-center justify-center"
                style={{
                  backgroundColor: "#0FA6A6",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                }}
              >
                {resend.state === "sending"
                  ? "Sending…"
                  : resend.state === "sent"
                  ? "Email sent!"
                  : resend.state === "cooldown"
                  ? `Resend in ${resend.seconds}s`
                  : "Send New Reset Link"}
              </button>
            </form>

            {resend.state === "sent" && (
              <p className="text-sm mt-3" style={{ color: "#16A34A" }}>
                Check your inbox, spam, and junk folders for the new reset
                link.
              </p>
            )}
            {resend.state === "cooldown" && (
              <p className="text-sm mt-3" style={{ color: "#4B5563" }}>
                You just requested one. You can send another in {resend.seconds}{" "}
                second{resend.seconds === 1 ? "" : "s"}.
              </p>
            )}
            {resend.state === "error" && (
              <p className="text-sm mt-3" style={{ color: "#F02719" }}>
                {resend.message}
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
