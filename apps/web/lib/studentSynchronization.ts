import type { QueryClient } from "@tanstack/react-query";
import { clearPermissionSensitiveEventState } from "./hooks/eventSync";
import { releaseAllAttachmentUrls } from "./messages/service";

// The opaque Day 10E broadcast carries no business state. It only tells a
// client to invalidate the student-facing views that can contain lifecycle
// controlled content. Active queries refetch through their ordinary RLS-backed
// loaders; inactive ones stay stale until they are opened.
export const STUDENT_CONTENT_QUERY_ROOTS = [
  "homePostsFeed",
  "postDetail",
  "postComments",
  "ownPosts",
  "userPosts",
  "clubPhotoFeed",
  "homeEventsFeed",
  "eventDetail",
  "eventForEdit",
  "eventAttendees",
  "clubEventsFeed",
  "clubCalendarEvents",
  "calendarEvents",
  "calendarMonthMarkers",
  "calendarDayEvents",
  "savedEventsUpcoming",
  "savedEventsPast",
  "ownThisWeekEvents",
  "userWeeklyEvents",
  "clubProfile",
  "ownProfile",
  "userProfile",
  "ownClubs",
  "myClubs",
  // Discovery search results carry other students and clubs, so a block, a
  // restriction or an account deletion changes who may legitimately appear.
  // Mobile already invalidates this root; without it the web copy could keep
  // showing a now-hidden person for the lifetime of its stale window.
  "discoverySearch",
  "notifications",
  "unreadSummary",
  // 074: shared-context identity, the restricted-sender signal and the club
  // member roster are all permission-derived, so a block or an unblock changes
  // what they legitimately return. Keyed under "messages" for the conversation
  // queries, matching the key the message hooks already use.
  "messages",
  "clubMemberList",
] as const;

/**
 * Canonical convergence for student content after a Day 10E invalidation.
 * This intentionally never writes cache data: duplicate or out-of-order
 * broadcasts are harmless because every visible result comes from a fresh
 * server query governed by the current database state.
 */
export function invalidateStudentContentQueries(queryClient: QueryClient): void {
  for (const root of STUDENT_CONTENT_QUERY_ROOTS) {
    void queryClient.invalidateQueries({ queryKey: [root] });
  }
}

/**
 * The opaque campus signal can mean content was deleted or an event audience
 * narrowed. Clear affected payloads first, then use normal RLS-backed loaders
 * for convergence; never adopt broadcast data as application state.
 *
 * `resetQueries`, NOT `removeQueries`. Both discard the cached payload, which
 * is the privacy requirement, but they treat a query that currently has
 * observers very differently:
 *
 *   • `removeQueries` DESTROYS the query object. An observer mounted against it
 *     keeps its subscription to a cache entry that no longer exists, and an
 *     in-flight fetch resolves onto the discarded object — so the component is
 *     left in `status: "pending" / fetchStatus: "idle"` and never refetches.
 *     That is a permanent, silent loading state, not a stale-data guard.
 *   • `resetQueries` returns the query to its initial state AND refetches every
 *     ACTIVE observer, so the surface reloads under current RLS immediately.
 *
 * This was a real, reproducible defect: entering /messages removed the
 * in-flight `messages` queries, so the conversation list stayed on its skeleton
 * and the thread pane rendered "This conversation isn't available" for a
 * conversation the viewer was a participant of.
 */
export function clearPermissionSensitiveStudentContent(queryClient: QueryClient): void {
  clearPermissionSensitiveEventState(queryClient);
  // Cached attachment blobs are not React Query state. Every fetch is
  // re-authorized by Storage, but bytes already resolved into a blob: URL would
  // still render, so they are dropped on an access change too — the same
  // contract as mobile's clearAttachmentCache().
  releaseAllAttachmentUrls();
  for (const root of [
    "homePostsFeed",
    "postDetail",
    "postComments",
    "ownPosts",
    "userPosts",
    "clubPhotoFeed",
    "clubProfile",
    "ownProfile",
    "userProfile",
    "notifications",
    "unreadSummary",
    "messages",
    "conversationHub",
    "clubChannels",
    "chatDetails",
  ]) {
    void queryClient.resetQueries({ queryKey: [root] });
  }
}

export function refreshPermissionSensitiveStudentContent(queryClient: QueryClient): void {
  clearPermissionSensitiveStudentContent(queryClient);
  invalidateStudentContentQueries(queryClient);
}

type RecoveryEventTarget = {
  addEventListener(event: string, listener: () => void): void;
  removeEventListener(event: string, listener: () => void): void;
};

export interface BrowserCanonicalRecoveryTargets {
  windowTarget: RecoveryEventTarget;
  documentTarget: RecoveryEventTarget & { visibilityState: string };
}

/**
 * Keep missed opaque broadcasts recoverable without polling. The callback is
 * supplied by the caller and always performs a canonical query invalidation or
 * access-state RPC; browser events themselves carry no state or authorization.
 */
export function subscribeBrowserCanonicalRecovery(
  recover: () => void,
  targets?: BrowserCanonicalRecoveryTargets
): () => void {
  const resolved = targets ?? {
    windowTarget: {
      addEventListener: (event: string, listener: () => void) => window.addEventListener(event, listener),
      removeEventListener: (event: string, listener: () => void) => window.removeEventListener(event, listener),
    },
    documentTarget: {
      get visibilityState() { return document.visibilityState; },
      addEventListener: (event: string, listener: () => void) => document.addEventListener(event, listener),
      removeEventListener: (event: string, listener: () => void) => document.removeEventListener(event, listener),
    },
  };
  const onVisible = () => {
    if (resolved.documentTarget.visibilityState === "visible") recover();
  };
  resolved.windowTarget.addEventListener("focus", recover);
  resolved.windowTarget.addEventListener("online", recover);
  resolved.documentTarget.addEventListener("visibilitychange", onVisible);
  return () => {
    resolved.windowTarget.removeEventListener("focus", recover);
    resolved.windowTarget.removeEventListener("online", recover);
    resolved.documentTarget.removeEventListener("visibilitychange", onVisible);
  };
}
