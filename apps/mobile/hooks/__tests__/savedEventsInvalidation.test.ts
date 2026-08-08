import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';

import { invalidateSaveQueries, invalidateRsvpQueries } from '../useEventRsvp';

function recordingClient() {
  const invalidateQueries = vi.fn();
  return {
    client: { invalidateQueries } as unknown as QueryClient,
    keys: () =>
      invalidateQueries.mock.calls.map(([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]),
  };
}

describe('saving an event refreshes the Saved Events screen', () => {
  // The reported bug: two events were bookmarked, the rows reached the
  // database, and Saved Events still showed "No upcoming saved events".
  // savedEventsUpcoming has a 2-minute staleTime, so an already-cached empty
  // list was served from cache because saving only invalidated the Home feed.
  it('invalidates both Saved Events queries', () => {
    const { client, keys } = recordingClient();

    invalidateSaveQueries(client);

    expect(keys()).toContain('savedEventsUpcoming');
    expect(keys()).toContain('savedEventsPast');
  });

  it('invalidates every surface that renders a bookmark icon', () => {
    const { client, keys } = recordingClient();

    invalidateSaveQueries(client);

    for (const key of [
      'homeEventsFeed',
      'eventDetail',
      'calendarEvents',
      'calendarDayEvents',
      'ownThisWeekEvents',
      'userWeeklyEvents',
      'discoveryEvents',
      'discoverySearch',
    ]) {
      expect(keys()).toContain(key);
    }
  });

  it('leaves the RSVP invalidation set alone — saving is not attendance', () => {
    const { client, keys } = recordingClient();

    invalidateRsvpQueries(client);

    // A bookmark must never be confused with going/attendance state.
    expect(keys()).not.toContain('savedEventsUpcoming');
    expect(keys()).not.toContain('savedEventsPast');
    expect(keys()).toContain('eventAttendees');
  });
});
