import type { QueryClient } from '@tanstack/react-query';
import { clearAttachmentCache } from './chatAttachments';

// The Day 10E private broadcast is deliberately opaque. These are the only
// student cache roots it can invalidate; it never writes received data into a
// cache, so the next result is always the canonical RLS-governed query result.
export const STUDENT_CONTENT_QUERY_ROOTS = [
  'homePostsFeed',
  'postDetail',
  'postComments',
  'ownPosts',
  'userPosts',
  'userPostsFeed',
  'clubPhotoFeed',
  'homeEventsFeed',
  'eventDetail',
  'eventForEdit',
  'eventAttendees',
  'clubEventsFeed',
  'calendarEvents',
  'calendarMonthMarkers',
  'calendarDayEvents',
  'savedEventsUpcoming',
  'savedEventsPast',
  'ownThisWeekEvents',
  'userWeeklyEvents',
  'clubProfile',
  'clubDetail',
  'myClubs',
  'joinedClubs',
  'ownClubs',
  'ownProfile',
  'userProfile',
  'discoveryEvents',
  'discoverySearch',
  'notifications',
  'unreadSummary',
] as const;

/** See the web twin for the idempotence and canonical-state rationale. */
export function invalidateStudentContentQueries(queryClient: QueryClient): void {
  for (const root of STUDENT_CONTENT_QUERY_ROOTS) {
    void queryClient.invalidateQueries({ queryKey: [root] });
  }
}

// A narrowed audience or removal is privacy-sensitive: React Query must not
// keep the previous successful payload visible while a replacement query waits.
export function clearPermissionSensitiveStudentContent(queryClient: QueryClient): void {
  // Locally cached attachment bytes are not React Query state. Every fetch is
  // re-authorized by Storage, but a file already written to the app cache would
  // still render, so the cache is dropped too.
  void clearAttachmentCache();
  for (const root of [
    'homeEventsFeed',
    'eventDetail',
    'eventForEdit',
    'eventAttendees',
    'clubEventsFeed',
    'calendarEvents',
    'calendarMonthMarkers',
    'calendarDayEvents',
    'savedEventsUpcoming',
    'savedEventsPast',
    'ownThisWeekEvents',
    'userWeeklyEvents',
    'clubProfile',
    'clubDetail',
    'homePostsFeed',
    'postDetail',
    'postComments',
    'ownPosts',
    'userPosts',
    'userPostsFeed',
    'clubPhotoFeed',
    'notifications',
    'unreadSummary',
    'myChats',
    'conversationHub',
    'clubChannels',
    'chatDetails',
    // 074: shared-context identity and the restricted-sender signal are both
    // permission-derived and must be re-resolved after an access change.
    'messages',
    'clubMembers',
  ]) {
    // `resetQueries`, NOT `removeQueries` — parity with the web client, which
    // already had this corrected.
    //
    // Both discard the cached payload, which is the privacy requirement. They
    // differ for a query that currently has OBSERVERS: `removeQueries` destroys
    // the query object, so a mounted screen keeps a subscription to a cache
    // entry that no longer exists and an in-flight fetch resolves onto the
    // discarded object — leaving it in `status: "pending" / fetchStatus: "idle"`
    // with nothing to retry it. That is a permanent, silent loading state, and
    // it is a plausible cause of the app occasionally never becoming usable.
    // `resetQueries` clears the data AND refetches every active observer, so the
    // screen reloads under current RLS instead of hanging.
    queryClient.resetQueries({ queryKey: [root] });
  }
}

export function refreshPermissionSensitiveStudentContent(queryClient: QueryClient): void {
  clearPermissionSensitiveStudentContent(queryClient);
  invalidateStudentContentQueries(queryClient);
}

/** Mobile's foreground-only counterpart to web focus/visibility recovery. */
export function shouldRecoverOnMobileForeground(status: string): boolean {
  return status === 'active';
}
