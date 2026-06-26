import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useEventDetail } from '../../../../../hooks/useEventDetail';
import { useRealtimeEventRsvps } from '../../../../../hooks/useRealtimeChannel';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '../../../../../components/shared/SkeletonLoader';

export type ClubEventDetailParams = {
  clubId: string;
  eventId: string;
};

export default function ClubEventDetailScreen() {
  const { clubId, eventId } = useLocalSearchParams<ClubEventDetailParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: event, isLoading } = useEventDetail(eventId, userId);

  useRealtimeEventRsvps({
    eventId: eventId!,
    onRsvpChange: () => {
      queryClient.invalidateQueries({ queryKey: ['eventDetail', eventId] });
    },
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text
          style={{ fontSize: 17, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}
          numberOfLines={1}
        >
          {event?.title ?? 'Event'}
        </Text>
      </View>

      {/* Skeleton placeholder — Cursor will style the event detail UI */}
      {isLoading && (
        <View style={{ padding: 16, gap: 16 }}>
          <Skeleton width="100%" height={200} borderRadius={12} />
          <Skeleton width={240} height={24} borderRadius={12} />
          <Skeleton width={180} height={16} borderRadius={8} />
          <Skeleton width="100%" height={44} borderRadius={22} />
          <Skeleton width="100%" height={80} borderRadius={12} />
        </View>
      )}

      {!isLoading && !event && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#6B7280', fontSize: 15, fontFamily: 'Inter_400Regular' }}>
            Event not found.
          </Text>
        </View>
      )}

      {!isLoading && event && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold', marginBottom: 8 }}>
            {event.emoji ? `${event.emoji} ` : ''}{event.title}
          </Text>
          <Text style={{ fontSize: 14, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
            {event.attendee_count} going · Cursor will style this screen
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
