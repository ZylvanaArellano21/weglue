"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { REPORT_REASONS, REPORT_RECEIVED_MESSAGE, useReport, type ReportEntityType } from "../../lib/hooks/useReport";

const ENTITY_LABEL: Record<ReportEntityType, string> = {
  club: "club",
  event: "event",
  post: "post",
  user: "user",
  message: "message",
  chat: "chat",
  comment: "comment",
};

/**
 * The single web report flow — every entity (club, event, post, user,
 * message, chat) opens this same modal: pick a reason → Submit. Replaces the
 * ad-hoc `window.prompt(...)` that used to sit at each call site (which
 * silently did nothing if what you typed didn't exactly match a reason
 * string).
 */
export function ReportModal({
  entityType,
  entityId,
  entityName,
  clubId,
  onClose,
  onSubmitted,
  onBlock,
  onSubmit,
}: {
  entityType: ReportEntityType;
  entityId: string;
  entityName?: string | null;
  clubId?: string | null;
  onClose: () => void;
  /** Called with a user-facing message once the report is saved. */
  onSubmitted: (message: string) => void;
  /**
   * Supplied ONLY when reporting a `user`, to offer "Report and block" in the
   * same step — mirrors the mobile flow. Blocking runs independently of the
   * report submission: if the report fails, the block still takes effect.
   */
  onBlock?: () => void;
  /**
   * Override the default `reports`-table insert (used by club/event/post/user/
   * chat) — messages go through the `report_message` RPC instead, so its
   * caller passes that here rather than this component knowing about it.
   */
  onSubmit?: (reason: string) => Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const report = useReport();

  const submit = async (alsoBlock: boolean) => {
    if (!reason) return;
    if (alsoBlock) onBlock?.();
    if (onSubmit) {
      setPending(true);
      try {
        await onSubmit(reason);
        onClose();
        onSubmitted(REPORT_RECEIVED_MESSAGE);
      } catch {
        onClose();
        onSubmitted("Couldn't send that report. Try again.");
      } finally {
        setPending(false);
      }
      return;
    }
    report.mutate(
      { entityType, entityId, entityName, clubId, reason },
      {
        onSuccess: (result) => {
          onClose();
          onSubmitted(result.emailed ? "Report sent. " + REPORT_RECEIVED_MESSAGE : REPORT_RECEIVED_MESSAGE);
        },
        onError: () => {
          onClose();
          onSubmitted("Couldn't send that report. Try again.");
        },
      }
    );
  };
  const isPending = pending || report.isPending;

  return (
    <Modal onClose={onClose} labelledBy="report-title" maxWidth={420}>
      <div className="p-5 sm:p-6">
        <h2 id="report-title" className="mb-1 text-center text-lg font-bold text-gray-900">
          Report this {ENTITY_LABEL[entityType]}
        </h2>
        <p className="mb-4 text-center text-sm text-gray-500">What's the issue?</p>

        <div className="space-y-1.5">
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-black/5"
            >
              <input
                type="radio"
                name="report-reason"
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-[#0FA6A6]"
              />
              <span className="text-sm text-gray-800">{r}</span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {onBlock && (
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={!reason || isPending}
              className="h-11 rounded-full bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              Report and block
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={!reason || isPending}
            className={`h-11 rounded-full text-sm font-semibold transition-colors disabled:opacity-50 ${
              onBlock ? "border border-gray-300 text-gray-800 hover:bg-black/5" : "bg-red-600 text-white hover:bg-red-700"
            }`}
          >
            Report
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-11 rounded-full text-sm font-semibold text-gray-500 hover:bg-black/5 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
