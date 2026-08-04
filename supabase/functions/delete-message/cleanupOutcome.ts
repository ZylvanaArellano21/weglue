export type AttachmentCleanupOutcome = {
  attachmentCleanup: "complete" | "pending";
  status: 200 | 202;
};

/**
 * Return only a client-safe cleanup state when no cleanup lease is available.
 * A claim error is never evidence that cleanup happened. The canonical
 * deletion RPC returns `deleted` only for a message without an attachment,
 * which is the sole no-lease state that proves cleanup is complete.
 */
export function attachmentCleanupOutcomeWithoutLease(
  deletionState: string,
  claimFailed: boolean,
): AttachmentCleanupOutcome {
  if (claimFailed || deletionState !== "deleted") {
    return { attachmentCleanup: "pending", status: 202 };
  }

  return { attachmentCleanup: "complete", status: 200 };
}
