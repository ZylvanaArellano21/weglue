import type { QueryClient } from "@tanstack/react-query";

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
