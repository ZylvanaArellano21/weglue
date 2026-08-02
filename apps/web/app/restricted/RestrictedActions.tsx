"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "../../lib/supabase-browser";

/**
 * The two affordances a restricted student keeps: leave, or delete.
 *
 * Deletion is deliberately reachable from here. A restricted account must never
 * become one the student cannot get out of — that is an App Store 5.1.1(v)
 * obligation, and it is the reason migration 058 leaves
 * `delete_own_account_atomic()` ungated and uses no Auth `banned_until`.
 *
 * The deletion request goes to the SAME `/api/account/delete` route the ordinary
 * flow uses, so there is one deletion path in the product rather than a special
 * one for restricted users that could rot unnoticed.
 */
export function RestrictedActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await getSupabaseBrowser().auth.signOut();
    } catch {
      // Even if GoTrue's clear fails, routing away is the useful outcome.
    }
    router.replace("/login?signed_out=1");
    router.refresh();
  }

  async function handleDelete() {
    if (busy || !armed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) throw new Error("delete failed");
      await getSupabaseBrowser().auth.signOut();
      router.replace("/?deleted=1");
      router.refresh();
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="w-full rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-60"
      >
        {busy && !confirming ? "Signing out…" : "Sign out"}
      </button>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="w-full rounded-lg border border-[#F02719] px-4 py-2 text-sm font-semibold text-[#F02719] hover:bg-red-50 disabled:opacity-60"
        >
          Delete my account
        </button>
      ) : (
        <div className="rounded-xl border border-red-200 bg-white p-4 text-left">
          <p className="text-sm font-semibold text-gray-900">
            Delete your account permanently?
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            This cannot be undone. Type <strong>DELETE</strong> to confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={busy}
            placeholder="DELETE"
            className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
                setError(null);
              }}
              disabled={busy}
              className="flex-1 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy || !armed}
              className="flex-1 rounded-lg bg-[#F02719] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
