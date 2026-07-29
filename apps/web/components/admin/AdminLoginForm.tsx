"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

/**
 * Administrator sign-in form (email + password).
 *
 * Signing in here establishes a Supabase session and NOTHING else. Authorization
 * is decided entirely server-side, afterwards, by requireSecureAdmin(): the
 * portal kill switch, the immutable UUID allowlist, the optional email
 * consistency check, and aal2 MFA. A successful sign-in by a non-allowlisted
 * account lands on the layout's "access restricted" card with zero data.
 *
 * Errors are deliberately single-message: never reveal whether an email exists
 * or whether it is an administrator account. An admin portal must not double as
 * an account-enumeration oracle.
 */
export function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError("Sign-in failed. Check your credentials and try again.");
      setBusy(false);
      return;
    }

    // Middleware takes it from here: aal1 → /admin/mfa, aal2 → `next`,
    // not allowlisted → the access-restricted card.
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-2xl">
          🛡️
        </div>
        <h1 className="mt-5 text-center text-lg font-semibold text-gray-900">
          We Glue Admin
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Authorized administrators only. Multi-factor verification is required.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="admin-email"
              className="block text-xs font-medium text-gray-600"
            >
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-teal-500"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-medium text-gray-600"
            >
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-teal-500"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
