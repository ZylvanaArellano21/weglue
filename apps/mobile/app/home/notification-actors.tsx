import { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../components/shared/Avatar';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { openProfile } from '../../lib/profileNavigation';
import { getNotificationActors, type NotificationActor } from '../../services/notificationService';

/**
 * The list behind a grouped "Eric and 7 others joined We Glue" notification.
 * Every student in the group; tapping a row opens that student's profile and
 * Back returns here; Back again returns to Notifications at its prior scroll.
 */
export default function NotificationActorsScreen() {
  const { notificationId } = useLocalSearchParams<{ notificationId: string }>();
  const router = useRouter();
  const viewerId = useAuthStore((s) => s.session?.user.id);

  const { data, isLoading } = useQuery({
    queryKey: ['notificationActors', notificationId],
    queryFn: () => getNotificationActors(notificationId),
    enabled: !!notificationId,
  });

  const renderItem = useCallback(
    ({ item }: { item: NotificationActor }) => (
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}
        activeOpacity={0.7}
        onPress={() => openProfile(router, item.id, viewerId)}
      >
        <Avatar uri={item.avatarUrl} size={44} username={item.username} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }} numberOfLines={1}>
            {item.username}
          </Text>
          {item.displayName && item.displayName !== item.username ? (
            <Text style={{ fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' }} numberOfLines={1}>
              {item.displayName}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </TouchableOpacity>
    ),
    [router, viewerId],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}>
          Everyone
        </Text>
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: 16, gap: 14, paddingTop: 8 }}>
          {[0, 1, 2, 3, 4].map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Skeleton width={44} height={44} borderRadius={22} />
              <Skeleton width={160} height={14} borderRadius={7} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(a) => a.id}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              {notificationId ? (
                <Text style={{ color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>No one to show.</Text>
              ) : (
                <ActivityIndicator color="#0FA6A6" />
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
