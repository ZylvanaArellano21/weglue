"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

function Toast({ message, type }: { message: string; type: "success" | "error" | "info" }) {
  const bg = type === "error" ? "bg-[#F02719]" : type === "success" ? "bg-[#0FA6A6]" : "bg-gray-800";
  return (
    <div
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 ${bg} text-white font-semibold text-sm px-5 py-3 rounded-xl shadow-lg animate-fade-in max-w-sm text-center`}
    >
      {message}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  function showToast(message: string, type: "success" | "error" | "info" = "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      showToast("Please fill in all fields.", "error");
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
      if (error.message.toLowerCase().includes("email not confirmed")) {
        showToast("Please verify your email before logging in.", "error");
      } else {
        showToast("Invalid email or password.", "error");
      }
      return;
    }
    router.push("/home");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-4">
      {toast && <Toast message={toast.message} type={toast.type} />}
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
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-[#FEFCF0] border border-black/20 rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#FEFCF0] border border-black/20 rounded-[10px] h-[53px] px-4 pr-16 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-[#5F5D5D] hover:text-black transition-colors"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

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
            onClick={() => showToast("Coming soon!", "info")}
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
