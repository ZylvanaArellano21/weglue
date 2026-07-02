"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { validateEducationEmail } from "@weglue/shared";

function mapSignUpError(error: { message: string; status?: number; code?: string }): string {
  const msg = error.message.toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (code === "user_already_exists" || msg.includes("user already registered") || msg.includes("already registered")) {
    return "An account with this email already exists. Try logging in instead.";
  }
  if (code === "weak_password" || (msg.includes("password") && msg.includes("characters"))) {
    return "Password must be at least 8 characters long.";
  }
  if (msg.includes("university") || msg.includes("educational") || msg.includes("school email")) {
    return "Only university or college email addresses (.edu) are accepted. Please use your school email.";
  }
  if (msg.includes("confirmation") || msg.includes("confirm") || (msg.includes("send") && msg.includes("email"))) {
    return "We couldn't send a confirmation email. Check your email address and try again.";
  }
  if (!navigator.onLine || msg.includes("network") || msg.includes("fetch") || msg.includes("connect")) {
    return "No internet connection. Please check your network and try again.";
  }
  if (error.status && error.status >= 500) {
    return "Our servers hit an issue. Wait a moment and try again. If this keeps happening, contact support.";
  }
  return `Something unexpected happened (Error: ${error.message}). Please try again or contact support.`;
}

export default function SignupPage(): JSX.Element | null {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

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

  function validate() {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = "Full name is required.";
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) {
      errs.email = "Email is required.";
    } else {
      const emailCheck = validateEducationEmail(email.trim());
      if (!emailCheck.valid) errs.email = emailCheck.reason!;
    }
    if (!password) {
      errs.password = "Password is required.";
    } else if (password.length < 8) {
      errs.password = "Password must be at least 8 characters long.";
    }
    if (password !== confirmPassword)
      errs.confirmPassword = "Passwords do not match.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          username: username.trim().replace(/^@/, ""),
        },
      },
    });
    setLoading(false);
    if (error) {
      setErrors({ general: mapSignUpError(error) });
      return;
    }
    router.push("/auth/avatar");
  }

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-block mb-6 text-2xl text-teal">
          ‹
        </Link>

        <h1 className="text-4xl font-zain font-bold text-gray-900 mb-8">
          Create Account
        </h1>

        <form onSubmit={handleSignup} className="flex flex-col gap-4">
          {/* Full Name */}
          <div>
            <input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); clearError("fullName"); }}
              className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors"
            />
            {errors.fullName && (
              <p className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>{errors.fullName}</p>
            )}
          </div>

          {/* Username */}
          <div>
            <input
              type="text"
              placeholder="@username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); clearError("username"); }}
              className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors"
            />
            {errors.username && (
              <p className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>{errors.username}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <input
              type="email"
              placeholder="Email (.edu required)"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError("email"); }}
              onBlur={(e) => validateEmailField(e.target.value)}
              className={`w-full bg-white border rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors ${errors.email ? "border-[#F02719]" : "border-gray-200"}`}
            />
            {errors.email && (
              <p className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearError("password"); }}
                className={`w-full bg-white border rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors pr-16 ${errors.password ? "border-[#F02719]" : "border-gray-200"}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>{errors.password}</p>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); clearError("confirmPassword"); }}
                className={`w-full bg-white border rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors pr-16 ${errors.confirmPassword ? "border-[#F02719]" : "border-gray-200"}`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
              >
                {showConfirm ? "Hide" : "Show"}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>{errors.confirmPassword}</p>
            )}
          </div>

          {errors.general && (
            <p className="text-sm text-center" style={{ color: "#F02719" }}>{errors.general}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal text-white font-zain font-bold text-lg rounded-full py-4 hover:bg-teal/90 transition-colors disabled:opacity-60 flex items-center justify-center mt-2"
          >
            {loading ? (
              <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Sign Up"
            )}
          </button>

          <p className="text-center text-gray-500 text-sm">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-teal font-semibold">
              Log In
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
