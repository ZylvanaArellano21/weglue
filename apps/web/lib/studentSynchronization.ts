import type { QueryClient } from "@tanstack/react-query";
import { clearPermissionSensitiveEventState } from "./hooks/eventSync";

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
 */
export function clearPermissionSensitiveStudentContent(queryClient: QueryClient): void {
  clearPermissionSensitiveEventState(queryClient);
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
    queryClient.removeQueries({ queryKey: [root] });
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
