"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

const RESEND_COOLDOWN_SECONDS = 60;

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

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailFromParams = searchParams.get("email") ?? null;

  const [email, setEmail] = useState<string | null>(emailFromParams);
  const [countdown, setCountdown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  // Try to get the email from the active session (if email confirmation is disabled)
  useEffect(() => {
    if (email) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setEmail(user.email);
    });
  }, [email]);

  // Poll for email confirmation and auto-redirect when verified.
  // Works in the same browser: after the user clicks the email link in another
  // tab, the callback sets session cookies — which this tab picks up on next poll.
  useEffect(() => {
    const supabase = createClient();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (
          (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
          session?.user?.email_confirmed_at
        ) {
          router.push("/onboarding/avatar");
        }
      }
    );

    const interval = setInterval(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email_confirmed_at) {
        clearInterval(interval);
        router.push("/onboarding/avatar");
      }
    }, 3000);

    return () => {
      authListener.subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [router]);

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleResend = useCallback(async () => {
    if (countdown > 0 || !email) return;
    setResending(true);
    setResendSuccess(false);
    try {
      const supabase = createClient();
      await supabase.auth.resend({ type: "signup", email });
      setResendSuccess(true);
      setCountdown(RESEND_COOLDOWN_SECONDS);
    } catch {
      // fail silently — no need to alarm user
    } finally {
      setResending(false);
    }
  }, [countdown, email]);

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-6 text-center">
      <Image
        src="/logo.png"
        alt="We Glue"
        width={64}
        height={64}
        className="mb-6"
      />

      <div className="w-16 h-16 bg-[#E0F7F7] rounded-full flex items-center justify-center mb-5 text-3xl">
        ✉️
      </div>

      <h1
        className="text-2xl font-bold text-black mb-2"
        style={{ fontFamily: "var(--font-zain)" }}
      >
        Check your email
      </h1>

      <p className="text-sm text-[#5F5D5D] max-w-xs leading-relaxed mb-2">
        We sent a verification link to
      </p>
      {email && (
        <p className="text-sm font-semibold text-black mb-4 break-all">{email}</p>
      )}
      <p className="text-sm text-[#5F5D5D] max-w-xs leading-relaxed mb-8">
        Click the link in that email to confirm your account. This page
        redirects automatically once you&apos;re verified.
      </p>

      {/* Resend button */}
      <button
        type="button"
        onClick={handleResend}
        disabled={countdown > 0 || resending || !email}
        className="h-[48px] px-8 bg-[#0FA6A6] text-white font-semibold text-sm rounded-[40px] shadow hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center gap-2 mb-3"
      >
        {resending && (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {countdown > 0
          ? `Resend in ${countdown}s`
          : resending
          ? "Sending…"
          : "Resend email"}
      </button>

      {resendSuccess && (
        <p className="text-xs text-[#0FA6A6] mb-3">
          Email resent! Check your inbox.
        </p>
      )}

      <Link
        href="/onboarding/signup"
        className="text-sm text-[#5F5D5D] hover:text-[#0FA6A6] transition-colors"
      >
        ← Go back
      </Link>

      <LegalFooter />
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
