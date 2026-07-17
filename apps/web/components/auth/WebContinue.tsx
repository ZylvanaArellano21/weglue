"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPendingSignupEmail, isWebAuthFlow } from "../../lib/authFlow";

/**
 * Rendered on the /auth/confirm landing page AFTER a successful verification.
 * The page primarily serves links opened from the MOBILE app's emails, whose
 * copy ("go back to We Glue and tap Log in") must stay untouched — so this
 * only appears when THIS browser started the signup on the web (marker set by
 * the web signup flow), and routes the user on to the web Login.
 */
export function WebContinue(): JSX.Element | null {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!isWebAuthFlow()) return;
    const email = getPendingSignupEmail();
    setHref(
      email
        ? `/login?verified=1&prefillEmail=${encodeURIComponent(email)}`
        : "/login?verified=1"
    );
  }, []);

  if (!href) return null;

  return (
    <div className="mt-6">
      <Link
        href={href}
        className="inline-flex items-center justify-center h-[48px] px-10 rounded-full font-semibold text-base text-white"
        style={{ backgroundColor: "#0FA6A6", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}
      >
        Continue — Log In
      </Link>
    </div>
  );
}
