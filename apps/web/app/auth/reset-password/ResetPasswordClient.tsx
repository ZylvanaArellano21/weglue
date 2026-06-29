"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";

type View = "loading" | "form" | "success" | "expired";

function getPasswordStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pw.length === 0) return { level: 0, label: "", color: "" };
  const hasSpecial = /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw);
  if (pw.length >= 10 && hasSpecial) return { level: 3, label: "Strong", color: "#16A34A" };
  if (pw.length >= 6) return { level: 2, label: "Medium", color: "#F59E0B" };
  return { level: 1, label: "Weak", color: "#F02719" };
}

const LogoBlock = () => (
  <div className="flex flex-col items-center mb-8">
    <Image src="/logo.png" alt="We Glue" width={70} height={64} className="mb-3" priority />
    <span className="text-2xl font-bold" style={{ fontFamily: "Zain, serif", color: "#1a1a1a" }}>
      We Glue
    </span>
  </div>
);

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
              Your password has been updated.
            </p>
            <p className="text-sm leading-relaxed mt-2" style={{ color: "#4B5563" }}>
              Head back to the We Glue app and log in with your new password.
            </p>
            <p className="text-xs mt-3" style={{ color: "#9CA3AF" }}>
              You can close this tab.
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

          <div className="mt-4 max-w-[300px] mx-auto">
            <p className="text-sm leading-relaxed" style={{ color: "#4B5563" }}>
              This reset link has expired or has already been used.
            </p>
            <p className="text-sm leading-relaxed mt-2" style={{ color: "#4B5563" }}>
              Go back to the We Glue app and request a new reset link from the login screen.
            </p>
            <p className="text-xs mt-3" style={{ color: "#9CA3AF" }}>
              You can close this tab.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // view === "form"
  const strength = getPasswordStrength(password);

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

            {/* Password strength bar */}
            {password.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex gap-1 flex-1">
                  {[1, 2, 3].map((seg) => (
                    <div
                      key={seg}
                      className="h-1.5 flex-1 rounded-full transition-colors"
                      style={{
                        backgroundColor:
                          strength.level >= seg ? strength.color : "#E5E7EB",
                      }}
                    />
                  ))}
                </div>
                <span className="text-xs font-medium" style={{ color: strength.color }}>
                  {strength.label}
                </span>
              </div>
            )}
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
