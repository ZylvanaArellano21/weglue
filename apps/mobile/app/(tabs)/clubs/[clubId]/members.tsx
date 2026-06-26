import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubMembers } from '../../../../hooks/useClubMembers';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';

export type MembersParams = {
  clubId: string;
};

export default function ClubMembersScreen() {
  const { clubId } = useLocalSearchParams<MembersParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data, isLoading } = useClubMembers(clubId, userId);

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
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}>
          Members {data?.total ? `(${data.total})` : ''}
        </Text>
      </View>

      {/* Skeleton placeholder — Cursor will build the search + member list UI */}
      {isLoading && (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Skeleton width={48} height={48} borderRadius={24} />
              <View style={{ gap: 6 }}>
                <Skeleton width={140} height={14} borderRadius={7} />
                <Skeleton width={80} height={12} borderRadius={6} />
              </View>
            </View>
          ))}
        </View>
      )}

      {!isLoading && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
            {data?.total ?? 0} members · Cursor will style this screen
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
