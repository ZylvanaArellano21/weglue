"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginAction } from "../actions/auth";

const EDU_REGEX = /^[^\s@]+@[^\s@]+\.edu$/i;

function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error" | "info";
}) {
  const bg =
    type === "error"
      ? "bg-[#F02719]"
      : type === "success"
      ? "bg-[#0FA6A6]"
      : "bg-gray-800";
  return (
    <div
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 ${bg} text-white font-semibold text-sm px-5 py-3 rounded-xl shadow-lg max-w-sm text-center`}
    >
      {message}
    </div>
  );
}

function LegalFooter() {
  return (
    <p className="text-center text-[10px] text-[#5F5D5D] mt-8">
      <Link href="/privacy-policy" className="hover:text-[#0FA6A6] underline">
        Privacy Policy
      </Link>
      {" · "}
      <Link href="/terms-of-service" className="hover:text-[#0FA6A6] underline">
        Terms of Service
      </Link>
    </p>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  function showToast(
    message: string,
    type: "success" | "error" | "info" = "error"
  ) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!email.trim()) {
      errs.email = "Email is required.";
    } else if (!EDU_REGEX.test(email.trim())) {
      errs.email = "Please enter a valid .edu email address.";
    }
    if (!password) {
      errs.password = "Password is required.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const result = await loginAction({
        email: email.trim().toLowerCase(),
        password,
      });

      if (!result.success && result.error) {
        const { field, message } = result.error;
        if (field && field !== "general") {
          setErrors({ [field]: message });
        } else {
          showToast(message, "error");
        }
        return;
      }

      if (result.redirectTo) {
        router.push(result.redirectTo);
        router.refresh();
      }
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-4 py-12">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="We Glue" width={64} height={64} className="mb-3" />
          <h1
            className="text-3xl font-bold text-black"
            style={{ fontFamily: "var(--font-zain)" }}
          >
            Welcome back
          </h1>
          <p className="text-sm text-[#5F5D5D] mt-1">
            Sign in to your We Glue account
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-6">
          <form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate>
            {/* School Email */}
            <div>
              <label className="block text-sm font-semibold text-black mb-1.5">
                School Email
              </label>
              <input
                type="email"
                placeholder="you@school.edu"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: "" }));
                }}
                className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[50px] px-4 text-sm text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] transition-colors ${
                  errors.email ? "border-[#F02719]" : "border-black/20"
                }`}
              />
              {errors.email && (
                <p className="text-xs text-[#F02719] mt-1">{errors.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-black mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrors((prev) => ({ ...prev, password: "" }));
                  }}
                  className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[50px] px-4 pr-16 text-sm text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] transition-colors ${
                    errors.password ? "border-[#F02719]" : "border-black/20"
                  }`}
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
                <p className="text-xs text-[#F02719] mt-1">{errors.password}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-[52px] bg-[#0FA6A6] text-white font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center mt-2"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                "Log in"
              )}
            </button>

            {/* Links */}
            <div className="flex flex-col items-center gap-2 mt-1">
              <p className="text-xs text-[#5F5D5D]">
                New here?{" "}
                <Link
                  href="/get-started"
                  className="font-semibold text-[#0FA6A6] hover:opacity-80"
                >
                  Create an account
                </Link>
              </p>
              <button
                type="button"
                className="text-xs text-[#0FA6A6] hover:opacity-80 transition-opacity"
              >
                Forgot password?
              </button>
              <a
                href="https://weglue.app"
                className="text-xs text-[#5F5D5D] hover:text-[#0FA6A6] transition-colors"
              >
                Go back to{" "}
                <span className="text-[#0FA6A6]">Home page</span>
              </a>
            </div>
          </form>
        </div>

        <LegalFooter />
      </div>
    </main>
  );
}
