import { useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, FlatList, ListRenderItem } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useJoinClubMutation } from '../../hooks/useClubMembership';
import {
  useDismissClubRecommendations,
  type ClubRecommendationBatch,
  type RecommendedClub,
} from '../../hooks/useClubRecommendations';

// The temporary club-match section. It lives ONLY inside the Events tab,
// directly below the Posts/Events selector — never in Posts, never above the
// selector, and never as an event card. It disappears for good once the batch
// is dismissed or completed by joining one of its clubs.

interface ClubMatchesSectionProps {
  batch: ClubRecommendationBatch;
  userId?: string;
  onJoined: () => void;
  onJoinError: () => void;
}

export function ClubMatchesSection({
  batch,
  userId,
  onJoined,
  onJoinError,
}: ClubMatchesSectionProps) {
  const router = useRouter();
  const { mutate: joinClub } = useJoinClubMutation(userId);
  const { mutate: dismiss } = useDismissClubRecommendations(userId);

  const handleJoin = useCallback(
    (clubId: string) => {
      if (!userId) return;
      // Joining any matched club completes the entire batch — the section is
      // hidden optimistically by the join mutation, and the DB trigger makes it
      // stick across restarts and devices.
      joinClub(clubId, { onSuccess: onJoined, onError: onJoinError });
    },
    [userId, joinClub, onJoined, onJoinError],
  );

  // Opening a club must NOT dismiss the batch, and Back must land on Home with
  // Events still selected and every scroll position intact — so this is a plain
  // push onto the stack over Home, which stays mounted underneath.
  const handleOpenClub = useCallback(
    (clubId: string) => router.push(`/club/${clubId}` as never),
    [router],
  );

  const renderCard: ListRenderItem<RecommendedClub> = useCallback(
    ({ item }) => (
      <TouchableOpacity
        style={{
          width: 148,
          marginRight: 12,
          backgroundColor: '#fff',
          borderRadius: 12,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          elevation: 4,
        }}
        onPress={() => handleOpenClub(item.id)}
        activeOpacity={0.85}
      >
        <ClubCardImage club={item} />

        <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: '#111827',
              fontFamily: 'Inter_600SemiBold',
              textAlign: 'center',
            }}
            numberOfLines={1}
          >
            {item.name}
          </Text>

          <TouchableOpacity
            style={{
              marginTop: 8,
              height: 30,
              borderRadius: 20,
              backgroundColor: '#0FA6A6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => handleJoin(item.id)}
            activeOpacity={0.85}
          >
            <Text
              style={{
                color: '#fff',
                fontSize: 13,
                fontWeight: '600',
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              Join
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    ),
    [handleJoin, handleOpenClub],
  );

  return (
    <View style={{ paddingTop: 16, paddingBottom: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 17,
            fontWeight: '700',
            color: '#111827',
            fontFamily: 'Zain_700Bold',
          }}
        >
          We found {batch.count} clubs you&apos;ll love
        </Text>

        <TouchableOpacity
          onPress={() => dismiss(batch.batch_id)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Dismiss club matches"
        >
          <Ionicons name="close" size={20} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <FlatList
        horizontal
        data={batch.clubs}
        keyExtractor={(c) => c.id}
        renderItem={renderCard}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      />

      <TouchableOpacity
        style={{
          marginTop: 14,
          marginHorizontal: 20,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: '#0FA6A6',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        // Opens the existing Club Discovery tab. Deliberately does NOT dismiss
        // the batch — coming back to Home → Events still shows the section.
        onPress={() => router.push('/(tabs)/search' as never)}
        activeOpacity={0.8}
      >
        <Text
          style={{
            color: '#0FA6A6',
            fontSize: 14,
            fontWeight: '600',
            fontFamily: 'Inter_600SemiBold',
          }}
        >
          See all clubs
        </Text>
      </TouchableOpacity>

      <View
        style={{
          height: 1,
          backgroundColor: '#E5E7EB',
          marginTop: 16,
          marginHorizontal: 20,
        }}
      />
    </View>
  );
}

// Clubs may have no image at all — fall back to the initial on the same teal
// tint the rest of the app uses, rather than rendering a broken/empty box.
function ClubCardImage({ club }: { club: RecommendedClub }) {
  const uri = club.avatar_url ?? club.cover_image_url;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: '100%', height: 92, backgroundColor: '#E0F7F7' }}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={{
        width: '100%',
        height: 92,
        backgroundColor: '#E0F7F7',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 32, fontWeight: '700', color: '#0FA6A6' }}>
        {club.name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}
