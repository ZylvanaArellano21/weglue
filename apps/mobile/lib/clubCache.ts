import type { QueryClient } from '@tanstack/react-query';

// Every query cache that embeds club data (avatar, banner, name, meeting
// schedule). After a club is edited, ALL of them must refetch so the change
// shows everywhere immediately — Club Tab, Club Profile, Home event cards,
// Discovery, Search, Calendar, Saved Events, chats — without an app restart.
// Uploads already produce unique storage paths + a ?v= cache-buster, so a
// refetched query always carries a brand-new image URL that RN's image cache
// treats as a different image.
const CLUB_DATA_QUERY_KEYS = [
  'clubProfile',
  'myClubs',
  'homeEventsFeed',
  'discoveryClubs',
  'discoverySearch',
  'allClubs',
  'ownClubs',
  'officerClubs',
  'calendarEvents',
  'calendarDayEvents',
  'calendarMonthMarkers',
  'savedEventsUpcoming',
  'savedEventsPast',
  'eventDetail',
  'userClubsList',
  'myChats',
] as const;

const CLUB_DATA_QUERY_KEY_SET = new Set<string>(CLUB_DATA_QUERY_KEYS);

export function invalidateClubDataEverywhere(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => CLUB_DATA_QUERY_KEY_SET.has(String(query.queryKey[0])),
  });
}
