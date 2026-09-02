"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";
import {
  checkPassword,
  passwordError,
  sendPasswordResetEmail,
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
  tokenHash,
  linkType,
  code,
}: {
  tokenHash: string | null;
  linkType: string | null;
  code: string | null;
}): JSX.Element | null {
  const [view, setView] = useState<View>("loading");
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

  // The verification runs exactly once. React can mount an effect twice (Strict
  // Mode in dev) and a recovery token is single-use, so a ref guards it.
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const supabase = getSupabaseBrowser();
    let cancelled = false;

    const hasFragmentToken =
      typeof window !== "undefined" &&
      /(?:^|[#&])access_token=/.test(window.location.hash);
    // Nothing to work with — the link was malformed, or a proxy stripped the
    // token. Straight to the self-serve resend; never let a pre-existing
    // unrelated session on this browser stand in for a recovery link.
    const hasCredential = Boolean(tokenHash || code || hasFragmentToken);

    async function resolve() {
      if (!hasCredential) {
        setView("expired");
        return;
      }

      // 1. token_hash link (?token_hash=…&type=recovery). detectSessionInUrl
      //    does NOT touch token_hash, so we verify it explicitly — and only
      //    now, in the real browser, on the real visit.
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (cancelled) return;
        if (!error) {
          setView("form");
          return;
        }
        // A used/expired token, or one this same person already spent by
        // opening the link twice — fall through to the session check: a live
        // recovery session from the first open still means "let them in".
      }

      // 2. ?code= (PKCE) or #access_token=… (implicit, e.g. after GoTrue's
      //    /verify redirect). The browser client consumes either automatically
      //    via detectSessionInUrl; that is async on init, so poll briefly for
      //    the resulting session.
      for (let i = 0; i < 16 && !cancelled; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setView("form");
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (cancelled) return;
      const { data } = await supabase.auth.getSession();
      setView(data.session ? "form" : "expired");
    }

    // PASSWORD_RECOVERY fires when detectSessionInUrl finishes consuming a
    // code / fragment — the specific recovery signal, caught directly instead
    // of only relying on the poll above.
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (cancelled || !session || !hasCredential) return;
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          setView("form");
        }
      }
    );

    void resolve();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [tokenHash, linkType, code]);

  // Live countdown for the resend cooldown.
  useEffect(() => {
    if (resend.state !== "cooldown") return;
    if (resend.seconds <= 0) {
      setResend({ state: "idle" });
      return;
    }
    const id = setTimeout(
      () => setResend({ state: "cooldown", seconds: resend.seconds - 1 }),
      1000
    );
    return () => clearTimeout(id);
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
      // The recovery session can lapse while the form sits open. Send the
      // person to the self-serve resend instead of a raw Supabase string.
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
