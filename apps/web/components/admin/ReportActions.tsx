"use client";

import { ConfirmAction } from "./ConfirmAction";
import { DisabledAction } from "./DisabledAction";
import { setReportStatus } from "../../lib/admin/reportsActions";

/** Human copy for each canonical transition target. */
const TRANSITION: Record<
  string,
  { label: string; title: string; body: string; confirmLabel: string; tone: "default" | "danger"; final: boolean }
> = {
  reviewing: {
    label: "Mark under review",
    title: "Mark this report under review?",
    body: "The report moves to the reviewing queue so it is clear a moderator has picked it up. This is reversible.",
    confirmLabel: "Mark under review",
    tone: "default",
    final: false,
  },
  resolved: {
    label: "Resolve",
    title: "Resolve this report?",
    body: "Marks the report resolved — the moderator has acted on it. You can reopen it later if needed. No sanction is applied automatically.",
    confirmLabel: "Resolve report",
    tone: "default",
    final: true,
  },
  dismissed: {
    label: "Dismiss",
    title: "Dismiss this report?",
    body: "Marks the report dismissed — no action needed. You can reopen it later if new information appears. No sanction is applied.",
    confirmLabel: "Dismiss report",
    tone: "danger",
    final: true,
  },
  pending: {
    label: "Reopen",
    title: "Reopen this report?",
    body: "Sends the report back to the open queue (pending) for another look.",
    confirmLabel: "Reopen report",
    tone: "default",
    final: false,
  },
};

/**
 * Moderation controls for one report. Only the canonical transitions valid from
 * the current status are rendered; each runs setReportStatus() (write-gated,
 * validated, read-back + audited). Final transitions (resolve/dismiss) confirm.
 */
export function ReportActions({
  reportId,
  status,
  allowedTransitions,
}: {
  reportId: string;
  status: string;
  allowedTransitions: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {allowedTransitions.length === 0 ? (
          <span className="text-sm text-gray-400">No transitions available from “{status}”.</span>
        ) : (
          allowedTransitions.map((next) => {
            const t = TRANSITION[next];
            if (!t) return null;
            return (
              <ConfirmAction
                key={next}
                label={t.label}
                title={t.title}
                body={t.body}
                confirmLabel={t.confirmLabel}
                tone={t.tone}
                run={() => setReportStatus(reportId, next)}
              />
            );
          })
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DisabledAction
          label="Add moderation note"
          reason="No notes/reviewer column in the reports schema — deferred until audit-table migration is sequenced"
        />
        <DisabledAction
          label="Apply a restriction / sanction"
          reason="No canonical restriction system exists — see Restrictions. Nothing is auto-sanctioned."
        />
      </div>
    </div>
  );
}
