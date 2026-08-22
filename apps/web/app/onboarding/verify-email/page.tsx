"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  RESEND_COOLDOWN_SECONDS,
  getPendingSignupEmail,
  getResendCooldownRemaining,
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../../lib/authFlow";

const SUCCESS_MESSAGE_DURATION_MS = 8000;
const RESEND_SUCCESS_MESSAGE =
  "Verification email sent. Check your inbox, spam, and junk folders for the email.";

function VerifyEmailContent(): JSX.Element {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email");
  const expiredParam = searchParams.get("expired");

  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<"success" | "error" | null>(null);
  const [resendErrorMessage, setResendErrorMessage] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(expiredParam === "1");

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);

  // Resolve which email this screen is for: URL param first, then the
  // persisted pending-signup marker (refresh-safe).
  useEffect(() => {
    const paramEmail = emailParam?.trim().toLowerCase();
    if (paramEmail) {
      setEmail(paramEmail);
      setPendingSignupEmail(paramEmail);
      return;
    }
    const stored = getPendingSignupEmail();
    if (stored) setEmail(stored);
  }, [emailParam]);

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

  // Adopt any cooldown already running — "Verify Now" on Login just sent an
  // email and navigated here, or the page was refreshed mid-countdown. The
  // countdown continues; it never restarts at a fresh 60.
  useEffect(() => {
    if (!email) return;
    const remaining = getResendCooldownRemaining(email);
    if (remaining > 0) {
      startCooldown(remaining);
      setResendStatus("success");
    }
  }, [email, startCooldown]);

  useEffect(
    () => () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    },
    []
  );

  async function handleResend() {
    if (sendingRef.current || resending || cooldown > 0 || !email) return;
    sendingRef.current = true;
    setResending(true);
    setResendStatus(null);
    setExpiredNotice(false);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    try {
      const result = await sendVerificationEmail(email);

      if (result.ok) {
        startCooldown(RESEND_COOLDOWN_SECONDS);
        setResendStatus("success");
        feedbackTimeoutRef.current = setTimeout(() => {
          setResendStatus(null);
          feedbackTimeoutRef.current = null;
        }, SUCCESS_MESSAGE_DURATION_MS);
        return;
      }

      if ("cooldown" in result) {
        startCooldown(result.cooldown);
        return;
      }

      setResendErrorMessage(result.message);
      setResendStatus("error");
    } finally {
      sendingRef.current = false;
      setResending(false);
    }
  }

  const resendLabel =
    cooldown > 0 ? `Resend again in ${cooldown}s` : "Resend Email";
  const resendDisabled = !email || resending || cooldown > 0;

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-6 pt-[8vh]">
      <Image src="/logo.png" alt="We Glue" width={110} height={100} priority />

      <h1 className="text-[30px] font-bold text-black mt-8">Confirm your email</h1>

      <div className="w-full max-w-[406px] bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.3)] mt-10 px-8 py-14 text-center">
        <p className="text-[17px] font-semibold text-[#5F5D5D]">
          We sent a verification link to
        </p>
        <p className="text-[17px] font-bold text-[#0FA6A6] mt-1 break-all">
          {email || "your email"}
        </p>

        <p className="text-[14px] text-[#5F5D5D] leading-relaxed mt-9">
          Check your inbox, spam, and junk folders for the email. Tap the
          link in it to verify your account, then return here and tap Log In.
        </p>

        {expiredNotice && (
          <p aria-live="polite" className="text-[13px] text-[#F02719] mt-4">
            That confirmation link expired. Tap Resend Email to get a new one.
          </p>
        )}

        <button
          type="button"
          onClick={handleResend}
          disabled={resendDisabled}
          className="w-[80%] h-[46px] mx-auto mt-9 rounded-full bg-[#0FA6A6] text-[#FEFCF0] text-[17px] font-bold shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:bg-[#CCCCCC] disabled:shadow-none flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {resending ? (
            <span
              aria-hidden
              className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
            />
          ) : (
            <span aria-live="polite">{resendLabel}</span>
          )}
        </button>

        <p aria-live="polite" className="min-h-[20px] mt-4">
          {resendStatus === "success" && (
            <span className="text-[13px] text-[#0FA6A6] font-medium">
              {RESEND_SUCCESS_MESSAGE}
            </span>
          )}
          {resendStatus === "error" && (
            <span className="text-[13px] text-[#F02719] font-medium">
              {resendErrorMessage}
            </span>
          )}
        </p>

        <p className="text-[15px] font-bold text-black mt-8">
          Already verified it?{" "}
          <Link
            href={
              email
                ? `/login?prefillEmail=${encodeURIComponent(email)}`
                : "/login"
            }
            className="text-[#0FA6A6] hover:underline"
          >
            Log In
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function VerifyEmailPage(): JSX.Element | null {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center">
          <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
