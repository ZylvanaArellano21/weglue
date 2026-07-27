"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

// ─── Permanent account deletion, web (App Store Guideline 5.1.1(v)) ──────────
//
// The same two deliberate steps as the mobile screen, the same copy, and the
// same backend: POST /api/account/delete forwards the caller's own session to
// the `delete-account` Edge Function. Nothing local is cleared until the server
// confirms the account is gone.

/** Kept verbatim in step with apps/mobile/app/account-center/delete-account.tsx. */
const DELETED_CATEGORIES = [
  "Your profile, username, email and account details",
  "Your posts, photos, comments and likes",
  "Your messages and group memberships",
  "Your club memberships, officer roles and RSVPs",
  "Your saved events, interests and activities",
  "Your followers, following and Gluemate connections",
  "Your notifications, notification settings and devices",
];

const CONFIRMATION_WORD = "DELETE";

function isConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === CONFIRMATION_WORD;
}

export function DeleteAccountClient({ email }: { email: string }): JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous re-entry guard. `deleting` only blocks the SECOND click after a
  // re-render, so two clicks inside one frame would both fire the request.
  const inFlight = useRef(false);

  const confirmed = isConfirmed(confirmText);
  const canDelete = confirmed && !deleting;

  async function handleDelete() {
    if (!canDelete || inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same-origin so the browser sends Origin, which the route requires.
        credentials: "same-origin",
        body: "{}",
      });

      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!res.ok || !body?.success) {
        setError(
          body?.error ??
            "We couldn't delete your account. Your account is unchanged — please try again."
        );
        return;
      }

      // Confirmed gone. Clear this browser's client-side session state too, so
      // no stale token lingers in localStorage after the redirect.
      try {
        await createClient().auth.signOut({ scope: "local" });
      } catch {
        // Server-side cookies are already cleared; this is belt and braces.
      }

      // replace(), not push() — Back must not return to an authenticated page.
      router.replace("/login?deleted=1");
      router.refresh();
    } catch {
      setError(
        "We couldn't reach the server. Your account is unchanged — check your connection and try again."
      );
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <Link
          href="/profile"
          className="text-sm font-semibold text-[#0FA6A6] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          ← Back to your profile
        </Link>

        <div className="mt-5 bg-[#FFFEF7] px-6 py-8 shadow-[0px_18px_60px_rgba(0,0,0,0.25)]">
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900">
            Delete your account?
          </h1>

          <p className="mt-3 text-[15px] leading-relaxed text-gray-800">
            This permanently deletes your We Glue account and associated personal
            data, including your profile, posts, comments, messages, photos,
            RSVPs, memberships, connections, notifications and account
            information. This action cannot be undone.
          </p>

          <p className="mt-4 text-sm text-gray-600">
            Signed in as <span className="font-semibold text-gray-900">{email}</span>
          </p>

          <h2 className="mt-7 text-xs font-semibold uppercase tracking-wide text-gray-500">
            What gets deleted
          </h2>
          <ul className="mt-2 space-y-1.5">
            {DELETED_CATEGORIES.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-gray-800">
                <span aria-hidden className="text-gray-400">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {/* The copy must not claim more than migration 052 actually does. */}
          <p className="mt-5 text-[13px] leading-relaxed text-gray-500">
            Messages you sent in conversations that other people are still part
            of remain in those conversations, permanently disconnected from you
            and no longer linked to your name or profile. We keep the minimum
            safety records required to handle abuse reports, with your name and
            email removed from them.
          </p>

          <p className="mt-5 text-sm font-semibold leading-relaxed text-[#F02719]">
            You will be signed out immediately. You will not be able to sign in
            with this account again, and it cannot be restored.
          </p>

          {step === 1 ? (
            <div className="mt-7 flex flex-col gap-3">
              <Link
                href="/profile"
                className="flex h-[48px] w-full items-center justify-center rounded-full border border-gray-200 bg-white text-[15px] font-semibold text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                Cancel
              </Link>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="h-[48px] w-full rounded-full bg-[#0FA6A6] text-[15px] font-semibold text-[#FEFCF0] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors hover:bg-[#0d9494] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                Continue
              </button>
            </div>
          ) : (
            <div className="mt-7">
              <label
                htmlFor="delete-confirm"
                className="block text-[15px] font-semibold text-gray-900"
              >
                Type {CONFIRMATION_WORD} to confirm.
              </label>
              <input
                id="delete-confirm"
                name="delete-confirm"
                type="text"
                autoComplete="off"
                autoFocus
                value={confirmText}
                onChange={(e) => {
                  setConfirmText(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  // Enter submits only once the word is actually typed.
                  if (e.key === "Enter" && canDelete) void handleDelete();
                }}
                disabled={deleting}
                placeholder={CONFIRMATION_WORD}
                aria-describedby={error ? "delete-error" : undefined}
                className={`mt-2.5 h-[53px] w-full rounded-[10px] border bg-white px-4 text-base font-semibold tracking-[0.15em] text-gray-900 outline-none transition-colors placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-300 focus:border-[#0FA6A6] disabled:opacity-60 ${
                  confirmed ? "border-[#F02719]" : "border-gray-300"
                }`}
              />

              {error && (
                <p
                  id="delete-error"
                  role="alert"
                  aria-live="assertive"
                  className="mt-3 text-[13px] leading-relaxed text-[#F02719]"
                >
                  {error}
                </p>
              )}

              <div className="mt-5 flex flex-col gap-3">
                <Link
                  href="/profile"
                  aria-disabled={deleting}
                  className={`flex h-[48px] w-full items-center justify-center rounded-full border border-gray-200 bg-white text-[15px] font-semibold text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
                    deleting ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!canDelete}
                  aria-busy={deleting}
                  className="flex h-[48px] w-full items-center justify-center rounded-full bg-[#F02719] text-[15px] font-semibold text-white shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors hover:bg-red-700 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  {deleting ? (
                    <span
                      aria-hidden
                      className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
                    />
                  ) : (
                    "Permanently Delete Account"
                  )}
                </button>
              </div>

              {deleting && (
                <p aria-live="polite" className="mt-3.5 text-center text-[13px] text-gray-500">
                  Deleting your account…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
