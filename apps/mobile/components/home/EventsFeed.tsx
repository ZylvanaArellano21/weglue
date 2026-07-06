import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, ListRenderItem } from 'react-native';
import { useAuthStore } from '@weglue/shared';
import {
  useHomeEventsFeed,
  useRsvpToEvent,
  useToggleSaveEvent,
  mergeEventFeedPages,
} from '../../hooks/useHomeEventsFeed';
import { useJoinClubMutation, useLeaveClubMutation } from '../../hooks/useClubMembership';
import { useOfficerStore } from '../../store/officerStore';
import { EventCard } from './EventCard';
import { EventCardToday } from './EventCardToday';
import { EventCardSkeleton } from '../shared/SkeletonLoader';
import { useToast } from '../Toast';
import { ConfirmModal } from '../ConfirmModal';
import { HomePostEventPrompt } from '../HomePostEventPrompt';
import type { HomeFeedEvent } from '../../services/eventService';

type FeedItem =
  | { type: 'section_header'; id: string; label: string }
  | { type: 'event'; id: string; event: HomeFeedEvent };

export function EventsFeed() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { isOfficer } = useOfficerStore();
  const [leaveTarget, setLeaveTarget] = useState<{ clubId: string; clubName: string } | null>(null);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useHomeEventsFeed(userId);

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
  const { mutate: rsvp } = useRsvpToEvent();
  const { mutate: toggleSave } = useToggleSaveEvent();
  const { mutate: joinClubMutate } = useJoinClubMutation(userId);
  const { mutate: leaveClubMutate, isPending: leavingClub } = useLeaveClubMutation(userId);
  const { show, ToastComponent } = useToast();

  const handleRsvp = useCallback(
    (eventId: string) => {
      if (!userId) return;
      rsvp(
        { userId, eventId, status: 'going' },
        {
          onSuccess: () => show('RSVP confirmed! 🎉'),
          onError: () => show('Failed to RSVP. Try again.', 'error'),
        },
      );
    },
    [userId, rsvp, show],
  );

  const handleToggleSave = useCallback(
    (eventId: string) => {
      if (!userId) return;
      toggleSave(
        { userId, eventId },
        {
          onSuccess: (saved) => show(saved ? 'Event saved!' : 'Event removed from saved'),
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

  const handleRequestLeaveClub = useCallback((clubId: string, clubName: string) => {
    setLeaveTarget({ clubId, clubName });
  }, []);

  const handleConfirmLeaveClub = useCallback(() => {
    if (!leaveTarget) return;
    const { clubId, clubName } = leaveTarget;
    setLeaveTarget(null);
    leaveClubMutate(clubId, {
      onSuccess: () => show(`You left ${clubName}.`),
      onError: () => show('Failed to leave club.', 'error'),
    });
  }, [leaveTarget, leaveClubMutate, show]);

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

  if (isLoading) {
    return (
      <View style={{ paddingTop: 8 }}>
        {[1, 2, 3].map((k) => (
          <EventCardSkeleton key={k} />
        ))}
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#6B7280', textAlign: 'center', fontSize: 15 }}>
          Something went wrong loading events.
        </Text>
      </View>
    );
  }

  if (!sections || sections.every((s) => s.data.length === 0)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
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

  // Flatten sections + headers into a single list
  const items: FeedItem[] = [];
  for (const section of sections ?? []) {
    items.push({ type: 'section_header', id: `header-${section.label}`, label: section.label });
    for (const event of section.data) {
      items.push({ type: 'event', id: event.id, event });
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {ToastComponent}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={isOfficer ? <HomePostEventPrompt /> : null}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        windowSize={7}
        maxToRenderPerBatch={6}
        initialNumToRender={6}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#0FA6A6"
            colors={['#0FA6A6']}
          />
        }
      />

      <ConfirmModal
        visible={!!leaveTarget}
        title={`Are you sure you want to leave ${leaveTarget?.clubName ?? 'this club'}?`}
        message="You'll lose access to club chats and updates."
        confirmLabel="Yes, Leave"
        cancelLabel="No"
        destructive
        loading={leavingClub}
        onConfirm={handleConfirmLeaveClub}
        onCancel={() => setLeaveTarget(null)}
      />
    </View>
  );
}
