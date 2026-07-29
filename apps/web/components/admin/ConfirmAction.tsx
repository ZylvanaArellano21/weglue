"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import type { ActionResult } from "../../lib/admin/actions";

/**
 * A destructive/confirming action button: opens a modal, runs the server action,
 * shows loading + success/error, and refreshes server data on success. If
 * `disabled` is set the button renders greyed with `disabledReason` as a tooltip
 * and no dialog opens (used for last-officer / demote-first guards).
 */
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
}: {
  label: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  run: () => Promise<ActionResult>;
  tone?: "default" | "danger";
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "xs";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pad = size === "xs" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm";
  const base =
    tone === "danger"
      ? "border-red-200 text-red-700 hover:bg-red-50"
      : "border-gray-200 text-gray-700 hover:bg-gray-50";

  async function onConfirm() {
    setError(null);
    setPending(true);
    try {
      const res = await run();
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Something went wrong.");
    } finally {
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
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={440}>
          <div className="p-5">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <div className="mt-2 text-sm text-gray-600">{body}</div>
            {error ? (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={pending}
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
