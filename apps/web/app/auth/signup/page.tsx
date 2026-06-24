"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

export default function SignupPage() {
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

  function validate() {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = "Full name is required.";
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) errs.email = "Email is required.";
    else if (!email.toLowerCase().endsWith(".edu"))
      errs.email = "Must use a .edu email address.";
    if (!password) errs.password = "Password is required.";
    else if (password.length < 8)
      errs.password = "Password must be at least 8 characters.";
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
      setErrors({ general: error.message });
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
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors"
            />
            {errors.fullName && (
              <p className="text-red-500 text-xs mt-1 ml-4">{errors.fullName}</p>
            )}
          </div>

          {/* Username */}
          <div>
            <input
              type="text"
              placeholder="@username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors"
            />
            {errors.username && (
              <p className="text-red-500 text-xs mt-1 ml-4">{errors.username}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <input
              type="email"
              placeholder="Email (.edu required)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors"
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1 ml-4">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors pr-16"
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
              <p className="text-red-500 text-xs mt-1 ml-4">{errors.password}</p>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900 outline-none focus:border-teal transition-colors pr-16"
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
              <p className="text-red-500 text-xs mt-1 ml-4">{errors.confirmPassword}</p>
            )}
          </div>

          {errors.general && (
            <p className="text-red-500 text-sm text-center">{errors.general}</p>
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
