"use client";

import { ConfirmAction } from "./ConfirmAction";
import { Badge } from "./primitives";
import {
  removePost,
  restorePost,
  removeComment,
  restoreComment,
  removeEvent,
  restoreEvent,
} from "../../lib/admin/contentLifecycleActions";
import type { LifecycleDisplayStatus, LifecycleEntityType, LifecycleState } from "../../lib/admin/lifecycleData";

const TONE: Record<LifecycleDisplayStatus, "green" | "teal" | "red" | "amber" | "blue" | "gray"> = {
  active: "green",
  restored: "teal",
  removed: "red",
  creator_deleted: "gray",
  purge_pending: "amber",
  purge_failed: "amber",
  purged: "gray",
};

const LABEL: Record<LifecycleDisplayStatus, string> = {
  active: "Active",
  restored: "Restored",
  removed: "Removed by admin",
  creator_deleted: "Deleted by creator",
  purge_pending: "Purge pending",
  purge_failed: "Purge needs review",
  purged: "Permanently purged",
};

export function LifecycleBadge({ status }: { status: LifecycleDisplayStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}

function inaccessibleCopy(entityType: LifecycleEntityType) {
  if (entityType === "comment") {
    return (
      <>
        This comment will be hidden from all student-facing comment threads and counts. Students will not see a
        public tombstone. The comment remains available only to this private dashboard while it is removed.
      </>
    );
  }
  if (entityType === "event") {
    return (
      <>
        This event will be unavailable in We Glue event lists, discovery, detail pages, RSVP and saved-event
        surfaces. Existing RSVP records are preserved. No new event reminder or last-chance notification will be
        generated while it is removed.
      </>
    );
  }
  return (
    <>
      This post will be unavailable in We Glue student-facing feeds, profiles, club surfaces, detail pages,
      comments and new likes. Existing media is not deleted by this action; public or cached copies outside We Glue
      may still be reachable.
    </>
  );
}

function restorationCopy(entityType: LifecycleEntityType) {
  if (entityType === "comment") {
    return "This comment will return to student comment threads only if its parent post remains active. No public tombstone is created.";
  }
  if (entityType === "event") {
    return "This event will return to the We Glue surfaces allowed by its existing visibility settings. Existing RSVP records remain unchanged.";
  }
  return "This post will return to the We Glue surfaces that its existing privacy, block and club-access rules permit. Its removal and restoration history remain in the private audit trail.";
}

function operation(entityType: LifecycleEntityType, type: "remove" | "restore", id: string, reason: string) {
  if (entityType === "post") return type === "remove" ? removePost(id, reason) : restorePost(id, reason);
  if (entityType === "comment") return type === "remove" ? removeComment(id, reason) : restoreComment(id, reason);
  return type === "remove" ? removeEvent(id, reason) : restoreEvent(id, reason);
}

export function ContentLifecycleControls({
  entityType,
  entityId,
  state,
  displayStatus,
  available,
}: {
  entityType: LifecycleEntityType;
  entityId: string;
  state: LifecycleState;
  displayStatus: LifecycleDisplayStatus;
  available: boolean;
}) {
  const targetSummary = `${entityType === "post" ? "Post" : entityType === "comment" ? "Comment" : "Event"} ${entityId}`;
  if (!available) {
    return (
      <button disabled className="cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-400">
        Lifecycle unavailable
      </button>
    );
  }
  if (state === "active") {
    return (
      <ConfirmAction
        label="Remove from We Glue"
        title={`Remove this ${entityType}?`}
        body={inaccessibleCopy(entityType)}
        confirmLabel="Remove content"
        tone="danger"
        requireReason
        reasonLabel="Internal removal reason"
        targetSummary={targetSummary}
        run={(reason) => operation(entityType, "remove", entityId, reason)}
      />
    );
  }
  if (state === "removed") {
    return (
      <ConfirmAction
        label="Restore content"
        title={`Restore this ${entityType}?`}
        body={restorationCopy(entityType)}
        confirmLabel="Restore content"
        requireReason
        reasonLabel="Internal restoration reason"
        targetSummary={targetSummary}
        run={(reason) => operation(entityType, "restore", entityId, reason)}
      />
    );
  }
  return (
    <button
      disabled
      title={LABEL[displayStatus]}
      className="cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-400"
    >
      No lifecycle action
    </button>
  );
}
