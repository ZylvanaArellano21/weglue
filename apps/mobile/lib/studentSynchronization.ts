import type { QueryClient } from '@tanstack/react-query';

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

/** Mobile's foreground-only counterpart to web focus/visibility recovery. */
export function shouldRecoverOnMobileForeground(status: string): boolean {
  return status === 'active';
}
