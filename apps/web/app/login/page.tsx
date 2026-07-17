"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { validateEducationEmail } from "@weglue/shared";
import { createClient } from "../../lib/supabase/client";
import {
  clearPendingSignup,
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";
import { startMicrosoftSignIn } from "../../lib/microsoftAuth";
import { resetOnboardingState } from "../../lib/onboardingState";
import { MicrosoftButton } from "../../components/auth/MicrosoftButton";

type LoginError =
  | null
  // Credentials are VALID; the email is simply not verified yet. Only ever set
  // from GoTrue's email_not_confirmed, which is issued after the password has
  // already been checked — so this state can never leak account existence.
  | "unverified"
  | "invalid"
  | "generic";

const inputClass = (invalid: boolean) =>
  `w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
    invalid ? "border-[#F02719]" : "border-black/20"
  }`;

function LoginContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get("prefillEmail") ?? "";
  const showVerifiedBanner = searchParams.get("verified") === "1";
  const oauthError = searchParams.get("oauthError");

  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loginError, setLoginError] = useState<LoginError>(null);
  const [msLoading, setMsLoading] = useState(false);
  const [msError, setMsError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (oauthError) setMsError(oauthError);
  }, [oauthError]);

  function clearAllErrors() {
    setFieldErrors({});
    setLoginError(null);
    setMsError(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading || msLoading) return;

    const newFieldErrors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      newFieldErrors.email = "Email is required.";
    } else {
      const emailCheck = validateEducationEmail(email.trim());
      if (!emailCheck.valid) newFieldErrors.email = emailCheck.reason!;
    }
    if (!password) newFieldErrors.password = "Password is required.";

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      return;
    }

    setLoading(true);
    clearAllErrors();
    const normalizedEmail = email.trim().toLowerCase();
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      const code = (error.code ?? "").toLowerCase();
      setLoading(false);

      if (msg.includes("email not confirmed") || code === "email_not_confirmed") {
        // GoTrue validates the password BEFORE issuing this error, so the
        // account exists, the password is right, and verification is the only
        // blocker. That is exactly — and only — when we may say so.
        setLoginError("unverified");
        return;
      }
      if (
        code === "invalid_credentials" ||
        code === "user_not_found" ||
        msg.includes("invalid login credentials") ||
        msg.includes("invalid credentials") ||
        msg.includes("user not found")
      ) {
        // Deliberately one message for wrong password AND unknown email so
        // login responses never reveal whether an account exists.
        setLoginError("invalid");
        return;
      }
      setLoginError("generic");
      return;
    }

    setLoading(false);
    if (data?.user) {
      // Wipe any stale signup-in-progress state so it can never leak into
      // this account.
      resetOnboardingState();
      clearPendingSignup();
      router.push("/dashboard");
      router.refresh();
    }
  }

  /**
   * "Verify Now" — sends exactly ONE verification email, opens the shared 60s
   * cooldown, then opens Confirm Email, which adopts that same cooldown.
   */
  async function handleVerifyNow() {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await sendVerificationEmail(normalizedEmail);
      if (!result.ok && "message" in result) {
        setMsError(null);
        setLoginError(null);
        setFieldErrors({ email: result.message });
        return;
      }
      // Sent, or a cooldown from a very recent send is already running —
      // Confirm Email shows the remaining countdown either way.
      setPendingSignupEmail(normalizedEmail);
      router.push(
        `/onboarding/verify-email?email=${encodeURIComponent(normalizedEmail)}`
      );
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }

  async function handleMicrosoftLogin() {
    if (msLoading || loading) return;
    clearAllErrors();
    setMsLoading(true);
    const result = await startMicrosoftSignIn();
    if (!result.ok) {
      if (result.message) setMsError(result.message);
      setMsLoading(false);
      return;
    }
    // Page navigates away to Microsoft.
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-4 pt-[5vh] pb-10">
      <Image src="/logo.png" alt="We Glue" width={100} height={90} priority />

      <div className="w-full max-w-[406px]">
        <h1 className="text-[30px] font-bold text-black mt-8">Welcome back</h1>
        <p className="text-[19px] text-[#5F5D5D] mt-1 mb-6">
          Sign in to your We Glue account
        </p>

        <div className="bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.25)] px-6 py-7">
          <form onSubmit={handleLogin} className="flex flex-col" noValidate>
            <label htmlFor="email" className="text-sm font-bold text-black mb-2">
              School Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@school.edu"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearAllErrors();
              }}
              className={inputClass(!!fieldErrors.email)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-xs text-[#F02719] mt-1.5">
                {fieldErrors.email}
              </p>
            )}

            <label
              htmlFor="password"
              className="text-sm font-bold text-black mb-2 mt-5"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearAllErrors();
                }}
                className={`${inputClass(!!fieldErrors.password)} pr-16`}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? "password-error" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-black hover:opacity-70"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {fieldErrors.password && (
              <p id="password-error" className="text-xs text-[#F02719] mt-1.5">
                {fieldErrors.password}
              </p>
            )}

            <div aria-live="polite" className="mt-3">
              {showVerifiedBanner && !loginError && (
                <p className="text-[13px] font-semibold text-[#0FA6A6]">
                  Your email is verified. Log in to continue.
                </p>
              )}
              {loginError === "invalid" && (
                <p className="text-[13px] text-[#F02719]">
                  The email or password is incorrect.
                </p>
              )}
              {loginError === "generic" && (
                <p className="text-[13px] text-[#F02719]">
                  Something went wrong. Please try again.
                </p>
              )}
              {loginError === "unverified" && (
                <p className="text-[13px] text-[#F02719]">
                  Your email has not been verified. Verify it before logging in.{" "}
                  {verifying ? (
                    <span className="font-semibold text-[#0FA6A6]">Sending…</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleVerifyNow}
                      className="font-semibold text-[#0FA6A6] underline"
                    >
                      Verify Now
                    </button>
                  )}
                </p>
              )}
              {msError && <p className="text-[13px] text-[#F02719]">{msError}</p>}
            </div>

            <div className="mt-6">
              <MicrosoftButton
                onClick={handleMicrosoftLogin}
                loading={msLoading}
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading || msLoading}
              className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center mt-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              {loading ? (
                <span
                  aria-hidden
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
                />
              ) : (
                "Log in"
              )}
            </button>

            <p className="text-center text-xs font-semibold text-black mt-5">
              New here?{" "}
              <Link href="/onboarding/interests" className="text-[#0FA6A6] hover:underline">
                Create an account
              </Link>
            </p>
            <p className="text-center mt-2">
              <Link
                href={
                  email.trim()
                    ? `/forgot-password?prefillEmail=${encodeURIComponent(email.trim().toLowerCase())}`
                    : "/forgot-password"
                }
                className="text-xs font-semibold text-[#0FA6A6] hover:underline"
              >
                Forgot password?
              </Link>
            </p>

            <p className="text-center text-xs font-semibold text-black mt-6">
              Go back to{" "}
              <Link href="/" className="text-[#0FA6A6] hover:underline">
                Home page
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage(): JSX.Element | null {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center">
          <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
