"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { validateEducationEmail } from "@weglue/shared";

function mapSignInError(error: { message: string; status?: number; code?: string }): string {
  const msg = error.message.toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (msg.includes("email not confirmed") || code === "email_not_confirmed") {
    return "You haven't confirmed your email yet. Check your inbox for the confirmation link we sent you.";
  }
  if (code === "user_not_found" || msg.includes("user not found")) {
    return "No account found with this email. Did you mean to sign up?";
  }
  if (code === "invalid_credentials" || msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
    return "Incorrect password. Try again or use 'Forgot Password' to reset it.";
  }
  if (msg.includes("disabled") || code === "user_banned") {
    return "This account has been disabled. Contact support for help.";
  }
  if (error.status === 429 || msg.includes("too many") || msg.includes("rate limit")) {
    return "Too many failed login attempts. Please wait a few minutes and try again.";
  }
  if (!navigator.onLine || msg.includes("network") || msg.includes("fetch") || msg.includes("connect")) {
    return "No internet connection. Please check your network and try again.";
  }
  if (error.status && error.status >= 500) {
    return "Our servers hit an issue. Wait a moment and try again.";
  }
  return `Something unexpected happened (Error: ${error.message}). Please try again or contact support.`;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function clearError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateEmailField(value: string) {
    if (!value.trim()) return;
    const result = validateEducationEmail(value.trim());
    if (!result.valid) {
      setErrors((prev) => ({ ...prev, email: result.reason! }));
    } else {
      clearError("email");
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!email.trim()) {
      newErrors.email = "Email is required.";
    } else {
      const emailCheck = validateEducationEmail(email.trim());
      if (!emailCheck.valid) newErrors.email = emailCheck.reason!;
    }
    if (!password) {
      newErrors.password = "Password is required.";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);

    if (error) {
      setErrors({ general: mapSignInError(error) });
      return;
    }

    router.push("/home");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Back arrow */}
        <Link href="/" className="inline-flex items-center text-black mb-6 hover:opacity-70 transition-opacity">
          <span className="text-3xl leading-none">‹</span>
        </Link>

        {/* Logo + Brand */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 relative mb-2">
            <Image src="/logo.png" alt="We Glue" fill style={{ objectFit: "contain" }} />
          </div>
          <h1 className="text-[30px] font-bold text-black" style={{ fontFamily: "var(--font-zain)" }}>
            We Glue
          </h1>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {/* School Email */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">School Email</label>
            <input
              type="email"
              placeholder="you@school.edu"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError("email"); clearError("general"); }}
              onBlur={(e) => validateEmailField(e.target.value)}
              className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${errors.email ? "border-[#F02719]" : "border-black/20"}`}
            />
            {errors.email && (
              <p className="text-xs mt-1 ml-1" style={{ color: "#F02719" }}>{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearError("password"); clearError("general"); }}
                className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 pr-16 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${errors.password ? "border-[#F02719]" : "border-black/20"}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-[#5F5D5D] hover:text-black transition-colors"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs mt-1 ml-1" style={{ color: "#F02719" }}>{errors.password}</p>
            )}
          </div>

          {/* General error */}
          {errors.general && (
            <p className="text-sm text-center" style={{ color: "#F02719" }}>{errors.general}</p>
          )}

          {/* Log in button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center mt-2"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Log in"
            )}
          </button>

          {/* Forgot password */}
          <button type="button" className="self-center text-sm font-semibold text-[#0FA6A6] hover:opacity-80 transition-opacity">
            Forgot Password?
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-black/12" />
            <span className="text-xs text-[#5F5D5D]">or</span>
            <div className="flex-1 h-px bg-black/12" />
          </div>

          {/* Microsoft SSO */}
          <button
            type="button"
            onClick={() => setErrors({ general: "Microsoft SSO coming soon!" })}
            className="w-full h-[52px] bg-white border border-black/20 rounded-[40px] font-semibold text-base text-black flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
          >
            <span className="grid grid-cols-2 gap-0.5 w-4 h-4 mr-1">
              <span className="bg-[#F25022]" /><span className="bg-[#7FBA00]" />
              <span className="bg-[#00A4EF]" /><span className="bg-[#FFB900]" />
            </span>
            Continue with Microsoft
          </button>

          {/* Create account */}
          <p className="text-center text-xs text-[#5F5D5D]">
            New here?{" "}
            <Link href="/" className="font-semibold text-[#0FA6A6] hover:opacity-80 transition-opacity">
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
