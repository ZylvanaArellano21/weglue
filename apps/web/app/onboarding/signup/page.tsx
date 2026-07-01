"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOnboardingStore } from "@weglue/shared";
import { signupAction } from "../../actions/auth";

const EDU_REGEX = /^[^\s@]+@[^\s@]+\.edu$/i;

function Toast({ message, type }: { message: string; type: "success" | "error" | "info" }) {
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
    <p className="text-center text-[10px] text-[#5F5D5D] mt-6">
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

export default function SignupPage(): JSX.Element {
  const router = useRouter();
  const { matchCount, selectedInterests, selectedActivities } =
    useOnboardingStore();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isOfAge, setIsOfAge] = useState(false);
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
    setTimeout(() => setToast(null), 3500);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (!username.trim()) {
      errs.username = "Username is required.";
    } else if (username.trim().length < 3) {
      errs.username = "Username must be at least 3 characters.";
    }

    if (!email.trim()) {
      errs.email = "Email is required.";
    } else if (!EDU_REGEX.test(email.trim())) {
      errs.email = "Only .edu email addresses are allowed.";
    }

    if (!password) {
      errs.password = "Password is required.";
    } else if (password.length < 8) {
      errs.password = "Password must be at least 8 characters.";
    }

    if (!agreedToTerms) {
      errs.terms = "You must agree to the Terms of Service and Privacy Policy.";
    }

    if (!isOfAge) {
      errs.age = "You must confirm you are 13 years of age or older.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const result = await signupAction({
        username: username.trim().replace(/^@/, ""),
        email: email.trim().toLowerCase(),
        password,
        selectedInterests,
        selectedActivities,
        agreedToTerms,
        isOfAge,
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

      router.push(result.redirectTo ?? "/onboarding/verify-email");
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-start justify-center px-4 py-8">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image src="/logo.png" alt="We Glue" width={56} height={56} />
        </div>

        {/* Match count header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-1">
            <span className="text-2xl">🎉</span>
            <h1
              className="text-2xl font-bold text-[#0FA6A6]"
              style={{ fontFamily: "var(--font-zain)" }}
            >
              You matched with
            </h1>
            <span className="text-2xl">🎉</span>
          </div>
          <p
            className="text-[38px] font-bold text-[#0FA6A6] underline leading-tight"
            style={{ fontFamily: "var(--font-zain)" }}
          >
            +{matchCount} clubs
          </p>
          <p className="text-sm font-semibold text-black mt-3 leading-snug">
            Create an account so that you can see your matches!!!
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {/* Username */}
          <div>
            <label className="block text-sm font-semibold text-black mb-1.5">
              Username
            </label>
            <input
              type="text"
              placeholder="Create a username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrors((prev) => ({ ...prev, username: "" }));
              }}
              className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
                errors.username ? "border-[#F02719]" : "border-black/20"
              }`}
            />
            {errors.username && (
              <p className="text-xs text-[#F02719] mt-1">{errors.username}</p>
            )}
          </div>

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
              className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
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
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((prev) => ({ ...prev, password: "" }));
                }}
                className={`w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 pr-16 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
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

          {/* Legal checkboxes */}
          <div className="flex flex-col gap-3 mt-1">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => {
                  setAgreedToTerms(e.target.checked);
                  setErrors((prev) => ({ ...prev, terms: "" }));
                }}
                className="mt-0.5 accent-[#0FA6A6] w-4 h-4 rounded"
              />
              <span className="text-xs text-[#5F5D5D] leading-relaxed">
                I agree to the{" "}
                <Link
                  href="/terms-of-service"
                  target="_blank"
                  className="text-[#0FA6A6] hover:underline"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="/privacy-policy"
                  target="_blank"
                  className="text-[#0FA6A6] hover:underline"
                >
                  Privacy Policy
                </Link>
              </span>
            </label>
            {errors.terms && (
              <p className="text-xs text-[#F02719] -mt-2">{errors.terms}</p>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isOfAge}
                onChange={(e) => {
                  setIsOfAge(e.target.checked);
                  setErrors((prev) => ({ ...prev, age: "" }));
                }}
                className="mt-0.5 accent-[#0FA6A6] w-4 h-4 rounded"
              />
              <span className="text-xs text-[#5F5D5D] leading-relaxed">
                I confirm I am 13 years of age or older
              </span>
            </label>
            {errors.age && (
              <p className="text-xs text-[#F02719] -mt-2">{errors.age}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center mt-2"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Next"
            )}
          </button>

          {/* Step indicator */}
          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-black/12" />
            <span className="text-xs text-[#5F5D5D]">1 of 2</span>
            <div className="flex-1 h-px bg-black/12" />
          </div>

          <p className="text-center text-xs text-[#5F5D5D]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-[#0FA6A6] hover:opacity-80"
            >
              Log in
            </Link>
          </p>
        </form>

        <LegalFooter />
      </div>
    </main>
  );
}
