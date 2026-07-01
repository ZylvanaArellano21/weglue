"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const from = searchParams.get("from") ?? "";
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        if (from === "signup") {
          router.replace("/onboarding/profile-pic");
        } else {
          router.replace("/home");
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [from]);

  async function handleResend() {
    if (!email) return;
    setResending(true);
    setResendMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    setResendMsg(
      error ? "Could not resend. Try again shortly." : "Verification email sent!"
    );
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-6xl mb-6">📧</div>

        <h1
          className="text-3xl font-bold text-black mb-3"
          style={{ fontFamily: "Zain, sans-serif" }}
        >
          Check your inbox
        </h1>

        <p className="text-sm text-[#5F5D5D] mb-1">
          We sent a verification link to
        </p>
        <p className="text-sm font-bold text-[#0FA6A6] mb-5">{email}</p>

        <p className="text-xs text-[#5F5D5D] leading-relaxed mb-8">
          Tap the link in the email to verify your account. Once verified,
          you&apos;ll be taken to the next step automatically.
        </p>

        {resendMsg && (
          <p
            className={`text-xs mb-4 ${
              resendMsg.includes("sent") ? "text-[#0FA6A6]" : "text-[#F02719]"
            }`}
          >
            {resendMsg}
          </p>
        )}

        <button
          onClick={handleResend}
          disabled={resending}
          className="w-full h-12 rounded-[40px] border-2 border-[#0FA6A6] text-[#0FA6A6] font-semibold text-sm hover:bg-[#0FA6A6]/5 transition-colors disabled:opacity-50"
        >
          {resending ? "Sending…" : "Resend email"}
        </button>

        <button
          onClick={() => router.push("/auth/login")}
          className="mt-4 text-xs text-[#5F5D5D] underline"
        >
          Already verified? Log in
        </button>
      </div>
    </main>
  );
}

export default function VerifyEmailPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center">
          <div
            className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "#0FA6A6", borderTopColor: "transparent" }}
          />
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
