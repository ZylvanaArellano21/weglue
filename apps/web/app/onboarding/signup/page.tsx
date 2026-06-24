"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { useOnboardingStore } from "@weglue/shared";

function Toast({ message, type }: { message: string; type: "success" | "error" | "info" }) {
  const bg =
    type === "error" ? "bg-[#F02719]" : type === "success" ? "bg-[#0FA6A6]" : "bg-gray-800";
  return (
    <div
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 ${bg} text-white font-semibold text-sm px-5 py-3 rounded-xl shadow-lg max-w-sm text-center`}
    >
      {message}
    </div>
  );
}

export default function WebSignupPage() {
  const router = useRouter();
  const { matchCount, setPendingUsername } = useOnboardingStore();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  function showToast(message: string, type: "success" | "error" | "info" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errs.email = "Please enter a valid email.";
    if (!password) errs.password = "Password is required.";
    else if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleNext(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: username.trim().replace(/^@/, ""),
          full_name: username.trim().replace(/^@/, ""),
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setErrors({ general: error.message });
      return;
    }

    setPendingUsername(username.trim().replace(/^@/, ""));
    showToast("Account created! Check your email to verify.", "success");
    setTimeout(() => router.push("/onboarding/profile-pic"), 1200);
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-start justify-center px-4 py-8">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="w-full max-w-sm">
        {/* Back */}
        <Link
          href="/onboarding/activities"
          className="inline-flex items-center text-black mb-4 hover:opacity-70 transition-opacity"
        >
          <span className="text-3xl leading-none">‹</span>
        </Link>

        {/* Match header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-2xl">🎉</span>
            <span className="text-2xl font-bold text-[#0FA6A6]">You matched with</span>
            <span className="text-2xl">🎉</span>
          </div>
          <p className="text-[36px] font-bold text-[#0FA6A6] underline leading-tight">
            +{matchCount} clubs
          </p>
          <p className="text-base font-semibold text-black mt-3 leading-snug">
            Create an account so that you can see your matches!!!
          </p>
        </div>

        <form onSubmit={handleNext} className="flex flex-col gap-4">
          {/* Username */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${errors.username ? "border-[#F02719]" : "border-black/20"}`}
            />
            {errors.username && <p className="text-xs text-[#F02719] mt-1">{errors.username}</p>}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">Lone Star Email</label>
            <input
              type="email"
              placeholder="you@school.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${errors.email ? "border-[#F02719]" : "border-black/20"}`}
            />
            {errors.email && <p className="text-xs text-[#F02719] mt-1">{errors.email}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">Password</label>
            <input
              type="password"
              placeholder="Min.8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${errors.password ? "border-[#F02719]" : "border-black/20"}`}
            />
            {errors.password && <p className="text-xs text-[#F02719] mt-1">{errors.password}</p>}
          </div>

          {errors.general && (
            <p className="text-sm text-[#F02719] text-center">{errors.general}</p>
          )}

          {/* Microsoft SSO */}
          <button
            type="button"
            onClick={() => showToast("Coming soon!", "info")}
            className="w-full h-[52px] bg-white border border-black/20 rounded-[40px] font-semibold text-base text-black flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
          >
            <span>⊞</span>
            Continue with Microsoft
          </button>

          {/* Next */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Next"
            )}
          </button>

          <p className="text-center text-xs text-[#5F5D5D]">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-semibold text-[#0FA6A6] hover:opacity-80">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
