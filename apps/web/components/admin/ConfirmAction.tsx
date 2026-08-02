"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import type { ActionResult } from "../../lib/admin/actions";

/**
 * A destructive/confirming action button: opens a modal, runs the server action,
 * shows loading + success/error, and refreshes server data on success. If
 * `disabled` is set the button renders greyed with `disabledReason` as a tooltip
 * and no dialog opens (used for last-officer / demote-first guards).
 *
 * REASON COLLECTION (Day 10A). Pass `requireReason` for any action the audit
 * catalog marks `requires_reason`. The dialog then:
 *   • names the exact target (`targetSummary`) so there is no doubt what is
 *     about to change,
 *   • requires a reason of MIN_REASON..MAX_REASON characters before the confirm
 *     button enables,
 *   • passes the trimmed reason to `run(reason)`.
 *
 * This is a convenience, NOT the enforcement. The server validates the reason
 * before any mutation, and the database refuses the audit row (rolling the
 * mutation back) if it is missing — so calling the action directly, bypassing
 * this dialog entirely, cannot produce an unaudited change.
 *
 * Cancelling closes the dialog without invoking `run` at all: no mutation, no
 * audit event of any kind.
 *
 * TYPED CONFIRMATION (Day 10C). Pass `confirmPhrase` for an IRREVERSIBLE action
 * — a permanent purge. The operator must type that exact word, case-sensitively,
 * before confirm enables. It is a second, deliberate act on top of the reason:
 * a reason can be typed on autopilot, a phrase cannot be clicked by accident.
 * Like the reason, this is a convenience and not the enforcement — the server
 * action re-checks the phrase, and the database refuses an illegal transition
 * regardless of what any dialog did.
 *
 * DUPLICATE-SUBMISSION GUARD. `pending` drives the visible loading state, but a
 * React state flag cannot stop a SECOND call that happens in the same tick as
 * the first — `setPending(true)` has not committed yet, so the button is not
 * disabled and the handler re-enters. A native double-click is slow enough that
 * React commits in between, but a programmatic or synthetic double-invoke is
 * not. `inFlight` is a ref, so it is set SYNCHRONOUSLY and closes that window.
 * The ref is the correctness guarantee; `pending` remains purely the visuals.
 */
export const MIN_REASON = 3;
export const MAX_REASON = 500;
export function ConfirmAction({
  label,
  title,
  body,
  confirmLabel = "Confirm",
  run,
  tone = "default",
  disabled = false,
  disabledReason,
  size = "sm",
  requireReason = false,
  targetSummary,
  confirmPhrase,
}: {
  label: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  run: (reason: string) => Promise<ActionResult>;
  tone?: "default" | "danger";
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "xs";
  /** Require a typed reason, recorded in the durable audit trail. */
  requireReason?: boolean;
  /** Exactly what is being changed, e.g. "Ann One — Chess Club". */
  targetSummary?: string;
  /** Exact word the operator must type for an irreversible action, e.g. "PURGE". */
  confirmPhrase?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  /** Synchronous re-entrancy latch — see the note above. Never rendered. */
  const inFlight = useRef(false);

  const trimmedReason = reason.trim();
  const reasonValid =
    !requireReason || (trimmedReason.length >= MIN_REASON && trimmedReason.length <= MAX_REASON);
  // Case-sensitive and exact: "purge" does not authorize a purge.
  const phraseValid = !confirmPhrase || phrase === confirmPhrase;
  const canConfirm = reasonValid && phraseValid;

  function close() {
    setOpen(false);
    setReason("");
    setPhrase("");
    setError(null);
    // Reopening must start clean even if a previous attempt threw before the
    // finally block could run.
    inFlight.current = false;
  }

  const pad = size === "xs" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm";
  const base =
    tone === "danger"
      ? "border-red-200 text-red-700 hover:bg-red-50"
      : "border-gray-200 text-gray-700 hover:bg-gray-50";

  async function onConfirm() {
    // Belt-and-braces: the button is disabled without a valid reason, but never
    // rely on a disabled button to enforce a rule.
    if (!reasonValid) {
      setError(`Enter a reason of at least ${MIN_REASON} characters.`);
      return;
    }
    if (!phraseValid) {
      setError(`Type ${confirmPhrase} exactly to confirm this irreversible action.`);
      return;
    }
    // Synchronous latch, BEFORE any await. A second invocation in the same tick
    // returns here without calling the server action.
    if (inFlight.current) return;
    inFlight.current = true;

    setError(null);
    setPending(true);
    try {
      const res = await run(trimmedReason);
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      // Released on success AND failure, so a failed attempt can be retried.
      inFlight.current = false;
      setPending(false);
    }
  }

  if (disabled) {
    return (
      <button
        disabled
        title={disabledReason}
        className={`cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 font-medium text-gray-400 ${pad}`}
      >
        {label}
      </button>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={`rounded-md border font-medium ${base} ${pad}`}>
        {label}
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : close())} maxWidth={440}>
          <div className="p-5">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <div className="mt-2 text-sm text-gray-600">{body}</div>

            {targetSummary ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Target</p>
                <p className="mt-0.5 break-words text-sm font-medium text-gray-900">{targetSummary}</p>
              </div>
            ) : null}

            {requireReason ? (
              <div className="mt-3">
                <label htmlFor="admin-action-reason" className="block text-xs font-medium text-gray-700">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="admin-action-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending}
                  rows={3}
                  maxLength={MAX_REASON}
                  autoFocus
                  placeholder="Why is this change being made? Recorded permanently in the audit trail."
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-teal-400 disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  {trimmedReason.length}/{MAX_REASON} · recorded permanently and cannot be edited or deleted. Never
                  include passwords, codes, links containing tokens, or private message text.
                </p>
              </div>
            ) : null}

            {confirmPhrase ? (
              <div className="mt-3">
                <label htmlFor="admin-action-phrase" className="block text-xs font-medium text-gray-700">
                  Type <span className="font-mono font-semibold text-red-600">{confirmPhrase}</span> to confirm{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="admin-action-phrase"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={confirmPhrase}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-red-400 disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  This action is permanent and cannot be undone or reversed by anyone.
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={close}
                disabled={pending}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={pending || !canConfirm}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
                  tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-teal-500 hover:bg-teal-600"
                }`}
              >
                {pending ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
