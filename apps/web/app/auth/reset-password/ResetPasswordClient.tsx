"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";

type View = "loading" | "form" | "success" | "expired";

const TEAL = "#0FA6A6";
const CREAM = "#FEFCF0";
const INK = "#1a1a1a";
const MUTED = "#5F5D5D";
const RED = "#F02719";

export default function ResetPasswordClient() {
  const [view, setView] = useState<View>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function handleToken() {
      const supabase = getSupabaseBrowser();

      // FORMAT A — URL hash: #access_token=...&type=recovery
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

      // FORMAT B — Query params: ?token_hash=...&type=recovery
      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (tokenHash && type === "recovery") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        setView(error ? "expired" : "form");
        return;
      }

      // Neither format present
      setView("expired");
    }

    handleToken();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!password || !confirmPassword) {
      setErrorMessage("Please fill in both fields.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords don't match. Try again.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setErrorMessage(error.message || "Something went wrong. Please try again.");
      return;
    }

    setView("success");
  }

  if (view === "loading") {
    return (
      <main
        style={{ backgroundColor: CREAM }}
        className="min-h-screen flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: `${TEAL} transparent ${TEAL} ${TEAL}` }}
          />
          <p style={{ color: MUTED }} className="text-sm">
            Verifying your link…
          </p>
        </div>
      </main>
    );
  }

  if (view === "expired") {
    return (
      <main
        style={{ backgroundColor: CREAM }}
        className="min-h-screen flex items-center justify-center px-4"
      >
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="We Glue"
            width={80}
            height={72}
            className="mb-6"
            priority
          />
          <div
            className="flex items-center justify-center mb-6"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: `3px solid ${RED}`,
            }}
          >
            <span style={{ color: RED, fontSize: 28, fontWeight: 700 }}>✕</span>
          </div>
          <h1
            className="text-2xl font-bold mb-3"
            style={{ color: INK }}
          >
            Link expired or invalid
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
            This password reset link has expired or was already used. Request a
            new one from the We Glue app.
          </p>
        </div>
      </main>
    );
  }

  if (view === "success") {
    return (
      <main
        style={{ backgroundColor: CREAM }}
        className="min-h-screen flex items-center justify-center px-4"
      >
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="We Glue"
            width={80}
            height={72}
            className="mb-6"
            priority
          />
          <div
            className="flex items-center justify-center mb-6"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: `3px solid ${TEAL}`,
            }}
          >
            <svg
              width="28"
              height="28"
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
          <h1
            className="text-2xl font-bold mb-3"
            style={{ color: INK }}
          >
            Password updated!
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
            Your password has been changed. Go back to the We Glue app and log
            in with your new password.
          </p>
        </div>
      </main>
    );
  }

  // view === "form"
  return (
    <main
      style={{ backgroundColor: CREAM }}
      className="min-h-screen flex items-center justify-center px-4"
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/logo.png"
            alt="We Glue"
            width={70}
            height={64}
            className="mb-3"
            priority
          />
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: "inherit", color: INK }}
          >
            We Glue
          </h1>
        </div>

        <h2
          className="text-xl font-bold text-center mb-2"
          style={{ color: INK }}
        >
          Set a new password
        </h2>
        <p className="text-sm text-center mb-6" style={{ color: MUTED }}>
          Choose a strong password for your account.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Password field */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-semibold mb-1.5"
              style={{ color: INK }}
            >
              New Password
            </label>
            <div
              className="flex items-center rounded-xl border px-4 h-[53px]"
              style={{
                backgroundColor: CREAM,
                borderColor: errorMessage ? RED : "rgba(0,0,0,0.2)",
                boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
              }}
            >
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="flex-1 bg-transparent text-sm font-semibold outline-none"
                style={{ color: INK }}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage(null);
                }}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="text-xs font-medium ml-2"
                style={{ color: MUTED }}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* Confirm password field */}
          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-semibold mb-1.5"
              style={{ color: INK }}
            >
              Confirm Password
            </label>
            <div
              className="flex items-center rounded-xl border px-4 h-[53px]"
              style={{
                backgroundColor: CREAM,
                borderColor: errorMessage ? RED : "rgba(0,0,0,0.2)",
                boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
              }}
            >
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                className="flex-1 bg-transparent text-sm font-semibold outline-none"
                style={{ color: INK }}
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
                className="text-xs font-medium ml-2"
                style={{ color: MUTED }}
                onClick={() => setShowConfirmPassword((v) => !v)}
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="text-sm text-center" style={{ color: RED }}>
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-[52px] rounded-full font-semibold text-base text-white transition-opacity disabled:opacity-70 mt-2"
            style={{
              backgroundColor: TEAL,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
          >
            {loading ? "Saving…" : "Set New Password"}
          </button>
        </form>
      </div>
    </main>
  );
}
