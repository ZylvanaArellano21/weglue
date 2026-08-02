"use client";

// ============================================================================
// Admin Dashboard — Day 10C content lifecycle controls
// ============================================================================
//
// One component per transition, each rendering only when it is ACTUALLY legal
// from the content's current state. An illegal transition is not offered as a
// greyed-out button with a tooltip guess — the state drives the controls, and
// the database re-checks the transition anyway, so the UI and the truth cannot
// diverge into a button that lies.
//
// WHAT THE OPERATOR IS TOLD, EVERY TIME:
//   • exactly which entity is affected (targetSummary),
//   • exactly what will change and what will NOT (the body copy),
//   • whether it can be undone.
// Purge additionally requires the word PURGE to be typed. Restore and remove
// require a reason; so does purge.
//
// WHAT IS NEVER SHOWN HERE: the internal reason of a PREVIOUS action, the
// administrator who took it, or anything about report status. Those live in the
// audit trail, which has its own page and its own access rules.
// ============================================================================

import { ConfirmAction } from "./ConfirmAction";
import {
  removePost,
  restorePost,
  requestPostPurge,
  removeComment,
  restoreComment,
  requestCommentPurge,
  removeEvent,
  restoreEvent,
  requestEventPurge,
  retryContentPurge,
} from "../../lib/admin/contentLifecycleActions";

export type LifecycleState = "active" | "removed" | "purge_pending" | "purge_failed" | "purged";
export type LifecycleEntity = "post" | "comment" | "event";

const NOUN: Record<LifecycleEntity, string> = {
  post: "post",
  comment: "comment",
  event: "event",
};

const REMOVE = { post: removePost, comment: removeComment, event: removeEvent } as const;
const RESTORE = { post: restorePost, comment: restoreComment, event: restoreEvent } as const;
const PURGE = {
  post: requestPostPurge,
  comment: requestCommentPurge,
  event: requestEventPurge,
} as const;

/** Small state pill so the operator always sees the truth before acting. */
export function LifecycleBadge({ state }: { state: LifecycleState }) {
  const style: Record<LifecycleState, string> = {
    active: "border-green-200 bg-green-50 text-green-700",
    removed: "border-amber-200 bg-amber-50 text-amber-800",
    purge_pending: "border-orange-200 bg-orange-50 text-orange-800",
    purge_failed: "border-red-200 bg-red-50 text-red-700",
    purged: "border-gray-300 bg-gray-100 text-gray-700",
  };
  const label: Record<LifecycleState, string> = {
    active: "Visible to students",
    removed: "Removed (restorable)",
    purge_pending: "Purge in progress",
    purge_failed: "Purge failed",
    purged: "Permanently purged",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style[state]}`}>
      {label[state]}
    </span>
  );
}

export function ContentLifecycleActions({
  entity,
  entityId,
  state,
  summary,
}: {
  entity: LifecycleEntity;
  entityId: string;
  state: LifecycleState;
  /** Human-readable identification of the exact record, shown in every dialog. */
  summary: string;
}) {
  const noun = NOUN[entity];

  // Terminal. There is nothing left to do and nothing to undo, so no control is
  // offered — an enabled button here could only mislead.
  if (state === "purged") {
    return (
      <p className="text-sm text-gray-500">
        This {noun} has been permanently purged. This cannot be undone.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "active" ? (
        <ConfirmAction
          label={`Remove ${noun}`}
          title={`Remove this ${noun} from students?`}
          body={
            <>
              It stops appearing anywhere in the student apps and on the web, for everyone including
              its author. Likes, comments and RSVPs are <span className="font-medium">preserved</span>,
              nothing is deleted, and no one is notified that it was removed. You can restore it
              later, exactly as it was.
            </>
          }
          confirmLabel={`Remove ${noun}`}
          tone="danger"
          requireReason
          targetSummary={summary}
          run={(reason) => REMOVE[entity](entityId, reason)}
        />
      ) : null}

      {state === "removed" ? (
        <>
          <ConfirmAction
            label={`Restore ${noun}`}
            title={`Restore this ${noun}?`}
            body={
              <>
                It becomes visible again to exactly the audience it had before, with its original
                text, its original timestamps and its existing likes, comments and RSVPs.{" "}
                <span className="font-medium">No notifications are re-sent</span> and nothing appears
                as new.
              </>
            }
            confirmLabel={`Restore ${noun}`}
            requireReason
            targetSummary={summary}
            run={(reason) => RESTORE[entity](entityId, reason)}
          />
          <ConfirmAction
            label="Permanently purge"
            title={`Permanently purge this ${noun}?`}
            body={
              <>
                This is <span className="font-medium">irreversible</span>. The content is destroyed,
                media it uniquely owns is deleted from storage, and it can never be restored by
                anyone — including you. Only a sanitized audit record remains.
                <br />
                <br />
                If this {noun} is attached to an open report it is kept as evidence and the purge
                will be refused.
              </>
            }
            confirmLabel="Purge permanently"
            tone="danger"
            requireReason
            confirmPhrase="PURGE"
            targetSummary={summary}
            run={(reason) => PURGE[entity](entityId, reason, "PURGE")}
          />
        </>
      ) : null}

      {state === "purge_pending" ? (
        <p className="text-sm text-gray-500">
          A permanent purge is in progress. The {noun} is already hidden from students and can no
          longer be restored.
        </p>
      ) : null}

      {state === "purge_failed" ? (
        <>
          <p className="w-full text-sm text-gray-600">
            The purge did not complete. The {noun} is still hidden from students and nothing has been
            reported as purged.
          </p>
          <ConfirmAction
            label="Retry purge"
            title="Retry this permanent purge?"
            body={
              <>
                The purge resumes from where it stopped. Work that already succeeded is not repeated.
                This remains <span className="font-medium">irreversible</span>.
              </>
            }
            confirmLabel="Retry purge"
            tone="danger"
            requireReason
            targetSummary={summary}
            run={(reason) => retryContentPurge(entity, entityId, reason)}
          />
        </>
      ) : null}
    </div>
  );
}
