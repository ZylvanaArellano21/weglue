"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  suspendUser,
  unsuspendUser,
  platformBlockUser,
  unblockUser,
  adjustSuspensionExpiry,
} from "../../lib/admin/restrictionActions";
import { MIN_REASON, MAX_REASON, type RestrictionResult } from "../../lib/admin/restrictionTypes";

// ============================================================================
// Administrator restriction controls (Day 10B2)
// ============================================================================
//
// A dedicated dialog rather than the shared ConfirmAction, for two reasons the
// generic component cannot serve:
//
//   • Suspend and Adjust need an EXPIRATION input alongside the reason.
//   • The result is four-valued, not boolean. "Restriction applied but session
//     revocation failed" is a real, reportable outcome and must not be flattened
//     into a green tick — the founder has to know the old token is alive until
//     it expires, even though the database is already refusing it.
//
// Opening the dialog, typing, or picking a date mutates NOTHING. The server
// action is only invoked on explicit confirm, and it re-validates everything.
// ============================================================================

type Kind = "suspend" | "unsuspend" | "block" | "unblock" | "adjust";

interface Props {
  userId: string;
  /** e.g. "Ann One (@annone)" — restated in the dialog so the target is exact. */
  targetSummary: string;
  accessState: "active" | "suspended" | "platform_blocked";
  writesEnabled: boolean;
}

const COPY: Record<
  Kind,
  { label: string; title: string; consequences: ReactNode; confirm: string; danger: boolean; needsDate: boolean }
> = {
  suspend: {
    label: "Suspend user",
    title: "Suspend this account",
    confirm: "Suspend",
    danger: true,
    needsDate: true,
    consequences: (
      <>
        The student is signed out everywhere and can no longer use We Glue on iOS,
        Android or the web. <strong>Nothing is deleted</strong> — posts, messages,
        clubs, memberships, officer roles and RSVPs are all preserved. They can
        still sign in far enough to see a generic restriction notice and to{" "}
        <strong>delete their account</strong>. They are never shown your reason.
      </>
    ),
  },
  unsuspend: {
    label: "Unsuspend user",
    title: "Lift this suspension",
    confirm: "Unsuspend",
    danger: false,
    needsDate: false,
    consequences: (
      <>
        Normal access resumes on their next check. This does <strong>not</strong>{" "}
        sign them in — they sign in again themselves. Nothing they blocked or
        posted is changed.
      </>
    ),
  },
  block: {
    label: "Block from We Glue",
    title: "Block this account from We Glue",
    confirm: "Block",
    danger: true,
    needsDate: false,
    consequences: (
      <>
        Indefinite until you explicitly unblock. The student is signed out
        everywhere and kept out of the app. <strong>This is not account
        deletion</strong> — their content is preserved and can still be reviewed
        and moderated. They can still delete their own account. Any active
        suspension is superseded in the same transaction.
      </>
    ),
  },
  unblock: {
    label: "Unblock user",
    title: "Lift this platform block",
    confirm: "Unblock",
    danger: false,
    needsDate: false,
    consequences: (
      <>
        Access is restored on their next check. Relationships removed by other
        actions are <strong>not</strong> recreated. To suspend instead, unblock
        first and then suspend — that is deliberately two audited steps.
      </>
    ),
  },
  adjust: {
    label: "Adjust suspension expiry",
    title: "Change when this suspension ends",
    confirm: "Update expiry",
    danger: false,
    needsDate: true,
    consequences: (
      <>
        Recorded as its own audited action with its own reason, rather than a
        silent edit. Sessions are not re-revoked; they were already revoked when
        the suspension was applied.
      </>
    ),
  },
};

export function RestrictionControls({ userId, targetSummary, accessState, writesEnabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RestrictionResult | null>(null);
  // Synchronous latch: React state updates are async, so a fast double-click
  // could otherwise fire the action twice before `pending` re-renders.
  const inFlight = useRef(false);

  const available: Kind[] =
    accessState === "active"
      ? ["suspend", "block"]
      : accessState === "suspended"
      ? ["unsuspend", "adjust", "block"]
      : ["unblock"];

  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;

  function reset() {
    setOpen(null);
    setReason("");
    setUntil("");
    setResult(null);
    setPending(false);
    inFlight.current = false;
  }

  async function run(kind: Kind) {
    if (inFlight.current || !reasonOk) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      const iso = until ? new Date(until).toISOString() : null;
      const res =
        kind === "suspend"
          ? await suspendUser(userId, trimmed, iso)
          : kind === "unsuspend"
          ? await unsuspendUser(userId, trimmed)
          : kind === "block"
          ? await platformBlockUser(userId, trimmed)
          : kind === "unblock"
          ? await unblockUser(userId, trimmed)
          : await adjustSuspensionExpiry(userId, trimmed, iso);
      setResult(res);
      if (res.ok) router.refresh();
    } catch (e) {
      setResult({
        ok: false,
        outcome: "rejected",
        message: e instanceof Error ? e.message : "Could not complete this action.",
        correlationId: "",
        sessionsRevoked: false,
      });
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {available.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => {
            setOpen(kind);
            setResult(null);
          }}
          disabled={!writesEnabled}
          title={writesEnabled ? undefined : "Admin write operations are currently disabled."}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            COPY[kind].danger
              ? "bg-red-50 text-red-700 hover:bg-red-100"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {COPY[kind].label}
        </button>
      ))}
      {!writesEnabled && (
        <p className="w-full text-xs text-gray-400">
          Writes are disabled (<code>ADMIN_WRITES_ENABLED</code>). These controls are inert.
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">{COPY[open].title}</h3>

            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-gray-400">Target</p>
              <p className="text-sm font-medium text-gray-900">{targetSummary}</p>
              <p className="mt-0.5 font-mono text-[11px] text-gray-400">{userId}</p>
            </div>

            <div className="mt-3 text-sm leading-6 text-gray-600">{COPY[open].consequences}</div>

            {COPY[open].needsDate && (
              <label className="mt-4 block">
                <span className="text-xs font-medium text-gray-700">
                  Expires (optional — leave empty for indefinite)
                </span>
                <input
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  disabled={pending}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            )}

            <label className="mt-4 block">
              <span className="text-xs font-medium text-gray-700">
                Reason ({MIN_REASON}–{MAX_REASON} characters, internal only — never shown to the student)
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Why is this action being taken?"
              />
              <span className="text-[11px] text-gray-400">
                {trimmed.length}/{MAX_REASON}
              </span>
            </label>

            {result && (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  !result.ok
                    ? "bg-red-50 text-red-700"
                    : result.outcome === "applied"
                    ? "bg-green-50 text-green-800"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                <p className="font-medium">
                  {!result.ok
                    ? "Not applied"
                    : result.outcome === "applied"
                    ? "Applied"
                    : result.outcome === "sessionsFailed"
                    ? "Applied — session revocation failed"
                    : "Applied — reconciliation required"}
                </p>
                <p className="mt-0.5">{result.message}</p>
                {result.correlationId && (
                  <p className="mt-1 font-mono text-[11px] opacity-70">
                    correlation {result.correlationId}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                {result?.ok ? "Close" : "Cancel"}
              </button>
              {!result?.ok && (
                <button
                  type="button"
                  onClick={() => run(open)}
                  disabled={pending || !reasonOk}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                    COPY[open].danger ? "bg-red-600 hover:bg-red-700" : "bg-teal-600 hover:bg-teal-700"
                  }`}
                >
                  {pending ? "Working…" : COPY[open].confirm}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
