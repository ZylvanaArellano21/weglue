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
import { EventCard } from './EventCard';
import { EventCardToday } from './EventCardToday';
import { EventCardSkeleton } from '../shared/SkeletonLoader';
import { useToast } from '../Toast';
import { ProfileConfirmationModal } from '../profile/ProfileConfirmationModal';
import type { HomeFeedEvent } from '../../services/eventService';

type FeedItem =
  | { type: 'section_header'; id: string; label: string }
  | { type: 'event'; id: string; event: HomeFeedEvent };

export function EventsFeed() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const [leaveTarget, setLeaveTarget] = useState<{ clubId: string; clubName: string } | null>(null);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useHomeEventsFeed(userId);

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
        return (
          <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: '#000000',
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {item.label}
            </Text>
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
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#0FA6A6"
            colors={['#0FA6A6']}
          />
        }
      />

      <ProfileConfirmationModal
        visible={!!leaveTarget}
        title={`Leave ${leaveTarget?.clubName ?? 'this club'}?`}
        message="You will be removed from all club chats and will no longer receive updates from this club."
        confirmLabel="Leave"
        cancelLabel="Cancel"
        destructive
        loading={leavingClub}
        onConfirm={handleConfirmLeaveClub}
        onCancel={() => setLeaveTarget(null)}
      />
    </View>
  );
}
