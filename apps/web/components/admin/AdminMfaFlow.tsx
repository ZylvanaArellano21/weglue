"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

type Phase = "loading" | "enroll" | "challenge" | "verifying" | "done" | "error";

/**
 * Administrator TOTP (MFA) flow. Runs entirely against the browser Supabase
 * client because verifying a factor UPGRADES the current session to aal2 and
 * rewrites the auth cookies — server code cannot do that on the user's behalf.
 * Server enforcement (requireSecureAdmin → aal2) is what actually protects the
 * data; this UI only lets the founder step their own session up.
 *
 *   • A verified TOTP factor already exists → CHALLENGE it (enter 6-digit code).
 *   • No verified factor → ENROLL: show QR + secret, then verify to activate.
 *
 * On success the session is aal2 and we return to the intended /admin path.
 */
export function AdminMfaFlow({ next, email }: { next: string; email: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    setError(null);
    setPhase("loading");
    const { data, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) {
      setError("Could not load your authenticator status. Please refresh.");
      setPhase("error");
      return;
    }
    const verified = (data?.totp ?? []).find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setQr(null);
      setSecret(null);
      setPhase("challenge");
      return;
    }
    // No verified factor: clear any stale unverified factors, then enroll fresh.
    for (const f of (data?.all ?? []).filter((f) => f.status === "unverified")) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      } catch {
        /* best effort */
      }
    }
    const { data: en, error: enErr } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "We Glue Admin",
    });
    if (enErr || !en) {
      setError("Could not start authenticator enrollment. Please try again.");
      setPhase("error");
      return;
    }
    setFactorId(en.id);
    setQr(en.totp.qr_code);
    setSecret(en.totp.secret);
    setPhase("enroll");
  }, [supabase]);

  useEffect(() => {
    void init();
  }, [init]);

  const verify = useCallback(async () => {
    const clean = code.trim();
    if (!factorId || clean.length < 6) return;
    const wasEnroll = phase === "enroll";
    setPhase("verifying");
    setError(null);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !ch) throw new Error("challenge_failed");
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: clean,
      });
      if (vErr) throw new Error(vErr.message || "verify_failed");
      setPhase("done");
      router.replace(next);
      router.refresh();
    } catch {
      setError("That code didn't verify. Check the current 6-digit code and try again.");
      setCode("");
      setPhase(wasEnroll ? "enroll" : "challenge");
    }
  }, [code, factorId, phase, supabase, router, next]);

  const busy = phase === "verifying" || phase === "loading" || phase === "done";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-2xl">🔐</div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Admin verification</h1>
            <p className="text-xs text-gray-500">{email}</p>
          </div>
        </div>

        {phase === "loading" ? (
          <p className="mt-6 text-sm text-gray-500">Checking your authenticator…</p>
        ) : null}

        {phase === "error" ? (
          <div className="mt-6">
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            <button
              onClick={() => void init()}
              className="mt-4 rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
            >
              Retry
            </button>
          </div>
        ) : null}

        {phase === "enroll" || phase === "challenge" || phase === "verifying" ? (
          <>
            {qr ? (
              <div className="mt-6">
                <p className="text-sm text-gray-600">
                  Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy),
                  then enter the 6-digit code to activate MFA on your admin account.
                </p>
                <div className="mt-4 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qr}
                    alt="Authenticator QR code"
                    width={180}
                    height={180}
                    className="rounded-lg border border-gray-200 bg-white p-2"
                  />
                </div>
                {secret ? (
                  <p className="mt-3 text-center text-xs text-gray-500">
                    Or enter this key manually:
                    <br />
                    <code className="mt-1 inline-block break-all rounded bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-700">
                      {secret}
                    </code>
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-6 text-sm text-gray-600">
                Enter the current 6-digit code from your authenticator app to continue.
              </p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
              className="mt-5"
            >
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Authentication code
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
              {error && phase !== "verifying" ? (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}
              <button
                type="submit"
                disabled={busy || code.trim().length < 6}
                className="mt-4 w-full rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {phase === "verifying" ? "Verifying…" : qr ? "Activate & continue" : "Verify & continue"}
              </button>
            </form>
          </>
        ) : null}

        {phase === "done" ? (
          <p className="mt-6 text-sm text-gray-600">Verified. Taking you to the dashboard…</p>
        ) : null}
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        This portal is protected by mandatory multi-factor authentication.
      </p>
    </div>
  );
}
