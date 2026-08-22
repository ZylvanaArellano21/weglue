"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RESEND_COOLDOWN_SECONDS,
  checkSignupStatus,
  getResetCooldownRemaining,
  sendPasswordResetEmail,
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";
import { writeOnboardingState } from "../../lib/onboardingState";

type EmailState = "idle" | "not_found" | "unverified" | "verified";

const inputClass = (invalid: boolean) =>
  `w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
    invalid ? "border-[#F02719]" : "border-black/20"
  }`;

function ForgotPasswordContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get("prefillEmail") ?? "";

  const [email, setEmail] = useState(prefillEmail);
  const [loading, setLoading] = useState(false);
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resendFeedback, setResendFeedback] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const submittingRef = useRef(false);
  const verifyingRef = useRef(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    },
    []
  );

  // Adopt a cooldown already running for this email (refresh-safe).
  useEffect(() => {
    if (!sentTo) return;
    const remaining = getResetCooldownRemaining(sentTo);
    if (remaining > 0) startCooldown(remaining);
  }, [sentTo, startCooldown]);

  function handleEmailChange(v: string) {
    setEmail(v);
    setEmailState("idle");
    setSubmitError(null);
  }

  /** Sends an unfinished signup back into onboarding with the same email. */
  function continueCreatingAccount() {
    writeOnboardingState({ pendingEmail: email.trim().toLowerCase() });
    router.push("/onboarding/interests");
  }

  /**
   * "Verify now" for an unverified account — an unverified account must
   * never continue into password reset, so this reuses the exact same
   * verification flow Login's "Verify Now" already uses (never a second
   * implementation): send exactly one verification email, then hand off to
   * Confirm Email, which adopts that same 60s cooldown.
   */
  async function handleVerifyNow() {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await sendVerificationEmail(normalizedEmail);
      if (!result.ok && "message" in result) {
        setSubmitError(result.message);
        return;
      }
      setPendingSignupEmail(normalizedEmail);
      router.push(
        `/onboarding/verify-email?email=${encodeURIComponent(normalizedEmail)}`
      );
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || loading) return;

    const trimmed = email.trim().toLowerCase();
    setSubmitError(null);

    if (!trimmed || !trimmed.includes("@")) {
      setEmailState("not_found");
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      // Safe backend probe (rate-limited RPC) — no fake-password login attempts.
      const status = await checkSignupStatus(trimmed);

      if (status.kind === "rate_limited") {
        setSubmitError("Too many attempts. Wait a few minutes and try again.");
        return;
      }
      if (status.kind === "error") {
        setSubmitError("Something went wrong. Please try again.");
        return;
      }
      if (status.emailStatus === "available") {
        setEmailState("not_found");
        return;
      }
      if (status.emailStatus === "exists_unverified") {
        // Not a finished account — a password reset would go nowhere useful.
        setEmailState("unverified");
        return;
      }

      setEmailState("verified");
      const result = await sendPasswordResetEmail(trimmed);
      if (!result.ok) {
        if ("cooldown" in result) {
          // A very recent send is still cooling down — show the sent view
          // with the remaining countdown instead of sending twice.
          setSentTo(trimmed);
          startCooldown(result.cooldown);
          return;
        }
        setSubmitError(result.message);
        setEmailState("idle");
        return;
      }

      setSentTo(trimmed);
      startCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!sentTo || loading || cooldown > 0) return;
    setLoading(true);
    setResendFeedback(null);
    try {
      const result = await sendPasswordResetEmail(sentTo);
      if (result.ok) {
        startCooldown(RESEND_COOLDOWN_SECONDS);
        setResendFeedback(
          "Email resent! Check your inbox, spam, and junk folders for the email."
        );
      } else if ("cooldown" in result) {
        startCooldown(result.cooldown);
      } else {
        setResendFeedback(result.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Sent view ──────────────────────────────────────────────────────────────
  if (sentTo) {
    return (
      <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-6 pt-[8vh]">
        <Image src="/logo.png" alt="We Glue" width={110} height={100} priority />
        <h1 className="text-[30px] font-bold text-black mt-8">Check your email</h1>

        <div className="w-full max-w-[406px] bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.3)] mt-10 px-8 py-12 text-center">
          <div
            aria-hidden
            className="w-[72px] h-[72px] mx-auto rounded-full border-2 border-[#0FA6A6] flex items-center justify-center"
          >
            <svg
              width="34"
              height="34"
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

          <p className="text-[15px] text-[#4B5563] mt-8">
            We sent a password reset link to
          </p>
          <p className="text-[16px] font-bold text-[#0FA6A6] mt-1 break-all">{sentTo}</p>
          <p className="text-[14px] text-[#4B5563] leading-relaxed mt-4">
            Check your inbox, spam, and junk folders for the email. Open the
            link to set a new password, then come back and log in.
          </p>

          <p aria-live="polite" className="mt-7 text-[13px]">
            {cooldown > 0 ? (
              <span className="text-[#9CA3AF]">Resend again in {cooldown}s</span>
            ) : loading ? (
              <span className="text-[#9CA3AF]">Sending…</span>
            ) : (
              <span className="text-[#6B7280]">
                Didn&apos;t get it?{" "}
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-[#0FA6A6] font-semibold underline"
                >
                  Resend
                </button>
              </span>
            )}
          </p>
          {resendFeedback && (
            <p aria-live="polite" className="text-[13px] text-[#0FA6A6] mt-2">
              {resendFeedback}
            </p>
          )}

          <p className="text-[15px] font-bold text-black mt-8">
            Back to{" "}
            <Link
              href={`/login?prefillEmail=${encodeURIComponent(sentTo)}`}
              className="text-[#0FA6A6] hover:underline"
            >
              Log In
            </Link>
          </p>
        </div>
      </main>
    );
  }

  // ── Request view ───────────────────────────────────────────────────────────
  const showEmailError = emailState === "not_found" || emailState === "unverified";
  const isButtonDisabled = loading || showEmailError;

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-4 pt-[5vh] pb-10">
      <Image src="/logo.png" alt="We Glue" width={100} height={90} priority />

      <div className="w-full max-w-[406px]">
        <h1 className="text-[30px] font-bold text-black mt-8">Reset your password</h1>
        <p className="text-[16px] text-[#5F5D5D] mt-1 mb-6 leading-relaxed">
          We&apos;ll send a reset link to your email. Check your inbox, spam,
          and junk folders for the email after clicking send.
        </p>

        <div className="bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.25)] px-6 py-7">
          <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
            <label htmlFor="email" className="text-sm font-bold text-black mb-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="yourname@email.com"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              className={inputClass(showEmailError)}
              aria-invalid={showEmailError}
              aria-describedby="reset-feedback"
            />

            <div id="reset-feedback" aria-live="polite" className="mt-2">
              {emailState === "not_found" && (
                <p className="text-[13px] text-[#F02719]">
                  No account under that email.{" "}
                  <button
                    type="button"
                    onClick={continueCreatingAccount}
                    className="text-[#0FA6A6] font-semibold underline"
                  >
                    Create one.
                  </button>
                </p>
              )}
              {emailState === "unverified" && (
                <p className="text-[13px] text-[#F02719]">
                  This email hasn&apos;t been verified.{" "}
                  {verifying ? (
                    <span className="text-[#0FA6A6] font-semibold">Sending…</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleVerifyNow}
                      className="text-[#0FA6A6] font-semibold underline"
                    >
                      Verify now
                    </button>
                  )}
                </p>
              )}
              {submitError && (
                <p className="text-[13px] text-[#F02719]">{submitError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isButtonDisabled}
              className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-50 flex items-center justify-center mt-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              {loading ? (
                <span
                  aria-hidden
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
                />
              ) : (
                "Send Reset Link"
              )}
            </button>

            <p className="text-center text-xs font-semibold text-black mt-6">
              Back to{" "}
              <Link href="/login" className="text-[#0FA6A6] hover:underline">
                Log In
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function ForgotPasswordPage(): JSX.Element | null {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center">
          <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
        </main>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
