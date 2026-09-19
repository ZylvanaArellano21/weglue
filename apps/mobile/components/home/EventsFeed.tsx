import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, ListRenderItem } from 'react-native';
import { useAuthStore } from '@weglue/shared';
import { useHomeTabStore } from '../../store/homeTabStore';
import {
  useHomeEventsFeed,
  useRsvpToEvent,
  useToggleSaveEvent,
  mergeEventFeedPages,
} from '../../hooks/useHomeEventsFeed';
import { useJoinClubMutation } from '../../hooks/useClubMembership';
import { useClubRecommendations } from '../../hooks/useClubRecommendations';
import { ClubMatchesSection } from './ClubMatchesSection';
import { EventCard } from './EventCard';
import { EventCardToday } from './EventCardToday';
import { EventCardSkeleton } from '../shared/SkeletonLoader';
import { useToast } from '../Toast';
import { requestLeaveClub } from '../../store/leaveClubStore';
import type { HomeFeedEvent } from '../../services/eventService';
import type { DesiredRsvp } from '../../hooks/useEventRsvp';

type FeedItem =
  | { type: 'section_header'; id: string; label: string }
  | { type: 'event'; id: string; event: HomeFeedEvent };

export function EventsFeed() {
  // Selector, not `useAuthStore()`: the store's default subscription is to the
  // WHOLE object, so a bare destructure re-renders this feed on every
  // unrelated store field change (e.g. every `setLoading` toggle during a
  // profile-sync pass in app/_layout.tsx), not just when the session changes.
  const userId = useAuthStore((s) => s.session?.user.id);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useHomeEventsFeed(userId);

  // null once the batch is dismissed, completed by a join, or never created.
  const { data: batch } = useClubRecommendations(userId);

  // Pull-to-refresh state kept separate from background refetches (RSVPs,
  // invalidations) so the spinner only shows for a real pull.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const sections = useMemo(
    () => (data ? mergeEventFeedPages(data.pages) : undefined),
    [data],
  );

  // ── Scroll to a freshly created event ─────────────────────────────────────
  // After posting an event, new-event.tsx switches Home to the Events tab and
  // sets pendingScrollEventId. As soon as the refreshed feed data contains
  // that event, scroll the feed so its small card is at the top — the user
  // lands exactly where their new event appears (sorted position included).
  const listRef = useRef<FlatList<FeedItem>>(null);
  const pendingScrollEventId = useHomeTabStore((s) => s.pendingScrollEventId);

  const flatItems = useMemo(() => {
    const items: FeedItem[] = [];
    for (const section of sections ?? []) {
      items.push({ type: 'section_header', id: `header-${section.label}`, label: section.label });
      for (const event of section.data) {
        items.push({ type: 'event', id: event.id, event });
      }
    }
    return items;
  }, [sections]);

  useEffect(() => {
    if (!pendingScrollEventId) return;
    const index = flatItems.findIndex(
      (i) => i.type === 'event' && i.id === pendingScrollEventId,
    );
    if (index < 0) return; // feed still refetching — try again on next data change
    useHomeTabStore.getState().setPendingScrollEventId(null);
    // Give the list one frame to lay out before scrolling.
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    });
  }, [pendingScrollEventId, flatItems]);

  // Drop a stale pending scroll if the event never appears so it can't hijack
  // a scroll position minutes later.
  useEffect(() => {
    if (!pendingScrollEventId) return;
    const timer = setTimeout(() => {
      if (useHomeTabStore.getState().pendingScrollEventId === pendingScrollEventId) {
        useHomeTabStore.getState().setPendingScrollEventId(null);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [pendingScrollEventId]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // Estimated jump, then retry once items around the target are rendered.
      listRef.current?.scrollToOffset({
        offset: info.index * (info.averageItemLength || 300),
        animated: false,
      });
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 });
      }, 120);
    },
    [],
  );
  const { mutate: rsvp } = useRsvpToEvent();
  const { mutate: toggleSave } = useToggleSaveEvent();
  const { mutate: joinClubMutate } = useJoinClubMutation(userId);
  const { show, ToastComponent } = useToast();

  const handleRsvp = useCallback(
    (eventId: string, desired: DesiredRsvp) => {
      if (!userId) return;
      rsvp(
        { userId, eventId, desired },
        {
          onSuccess: () =>
            show(desired === null ? 'RSVP removed' : 'RSVP confirmed! 🎉'),
          onError: () => show('Failed to RSVP. Try again.', 'error'),
        },
      );
    },
    [userId, rsvp, show],
  );

  const handleToggleSave = useCallback(
    (eventId: string, desired: boolean) => {
      if (!userId) return;
      toggleSave(
        { userId, eventId, desired },
        {
          onSuccess: () => show(desired ? 'Event saved!' : 'Event removed from saved'),
          onError: () => show('Failed to save event.', 'error'),
        },
      );
    },
    [userId, toggleSave, show],
  );

  const handleJoinClub = useCallback(
    (clubId: string) => {
      if (!userId) return;
      joinClubMutate(clubId, {
        onSuccess: () => show('Joined club! 🎉'),
        onError: () => show('Failed to join club.', 'error'),
      });
    },
    [userId, joinClubMutate, show],
  );

  // One app-wide leave flow (LeaveClubHost in the root layout) — this screen
  // only raises the request; the host verifies eligibility and shows exactly
  // one modal.
  const handleRequestLeaveClub = useCallback((clubId: string, clubName: string) => {
    requestLeaveClub({ clubId, clubName });
  }, []);

  const renderItem: ListRenderItem<FeedItem> = useCallback(
    ({ item }) => {
      if (item.type === 'section_header') {
        const isRecommended = item.label === 'Recommended for You';
        return (
          <View style={{ paddingHorizontal: 20, paddingTop: isRecommended ? 20 : 16, paddingBottom: 8 }}>
            {isRecommended ? (
              <View style={{ marginBottom: 4 }}>
                <View
                  style={{
                    height: 1,
                    backgroundColor: '#E5E7EB',
                    marginBottom: 16,
                  }}
                />
                <Text
                  style={{
                    fontSize: 17,
                    fontWeight: '700',
                    color: '#111827',
                    fontFamily: 'Zain_700Bold',
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: '#9CA3AF',
                    fontFamily: 'Inter_400Regular',
                    marginTop: 2,
                  }}
                >
                  Events from clubs you might like
                </Text>
              </View>
            ) : (
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: '700',
                  color: '#111827',
                  fontFamily: 'Zain_700Bold',
                }}
              >
                {item.label}
              </Text>
            )}
          </View>
        );
      }

      const { event } = item;
      const CardComponent = event.is_today ? EventCardToday : EventCard;

      return (
        <CardComponent
          event={event}
          onRsvp={handleRsvp}
          onToggleSave={handleToggleSave}
          onJoinClub={handleJoinClub}
          onRequestLeaveClub={handleRequestLeaveClub}
        />
      );
    },
    [handleRsvp, handleToggleSave, handleJoinClub, handleRequestLeaveClub],
  );

  // The temporary club-match section. It is the FIRST thing inside the Events
  // tab — directly below the Posts/Events selector and above the existing
  // "Your Clubs" / "Recommended for you" event sections, whose order and
  // behaviour are untouched. It must also render when the user has no events
  // at all, so it cannot live behind the feed's empty/loading/error returns.
  const matchesHeader = batch ? (
    <ClubMatchesSection
      batch={batch}
      userId={userId}
      onJoined={() => show('Joined club! 🎉')}
      onJoinError={() => show('Failed to join club.', 'error')}
    />
  ) : null;

  if (isLoading) {
    return (
      <View style={{ flex: 1 }}>
        {matchesHeader}
        <View style={{ paddingTop: 8 }}>
          {[1, 2, 3].map((k) => (
            <EventCardSkeleton key={k} />
          ))}
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ flex: 1 }}>
        {matchesHeader}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ color: '#6B7280', textAlign: 'center', fontSize: 15 }}>
            Something went wrong loading events.
          </Text>
        </View>
      </View>
    );
  }

  const isEmpty = flatItems.length === 0;

  return (
    <View style={{ flex: 1 }}>
      {ToastComponent}
      <FlatList
        ref={listRef}
        data={flatItems}
        keyExtractor={(item) => item.id}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        renderItem={renderItem}
        ListHeaderComponent={matchesHeader}
        ListEmptyComponent={<EmptyEvents centered={!matchesHeader} />}
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: 24,
          // Only stretch to centre the empty state when it is the ONLY thing on
          // screen; with the match section present it sits below it instead.
          ...(isEmpty && !matchesHeader ? { flexGrow: 1 } : null),
        }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        windowSize={7}
        maxToRenderPerBatch={6}
        initialNumToRender={6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#0FA6A6"
            colors={['#0FA6A6']}
          />
        }
      />
    </View>
  );
}

function EmptyEvents({ centered }: { centered: boolean }) {
  return (
    <View
      style={
        centered
          ? { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }
          : { alignItems: 'center', paddingHorizontal: 40, paddingVertical: 48 }
      }
    >
      <Text style={{ fontSize: 40, marginBottom: 16 }}>🌟</Text>
      <Text
        style={{
          fontSize: 16,
          fontWeight: '600',
          color: '#374151',
          textAlign: 'center',
          fontFamily: 'Zain_700Bold',
          marginBottom: 8,
        }}
      >
        No events yet.
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: '#9CA3AF',
          textAlign: 'center',
          fontFamily: 'Inter_400Regular',
        }}
      >
        Explore clubs to get started!
      </Text>
    </View>
  );
}
