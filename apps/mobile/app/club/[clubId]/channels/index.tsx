import { useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubChannels } from '../../../../hooks/useClubChannels';
import { useClubProfile } from '../../../../hooks/useClubProfile';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';
import type { Channel } from '../../../../services/channelService';

export type ChannelsParams = {
  clubId: string;
};

export default function ClubChannelsScreen() {
  const { clubId } = useLocalSearchParams<ChannelsParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: club } = useClubProfile(clubId, userId);
  const { data: channels, isLoading } = useClubChannels(clubId);

  // Guard: must be a member
  useEffect(() => {
    if (club && !club.is_member) {
      Alert.alert('Members Only', 'Join this club to access channels.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [club?.is_member]);

  function handleChannelPress(channel: Channel) {
    router.push({
      pathname: '/club/[clubId]/channels/[channelId]',
      params: { clubId: clubId!, channelId: channel.id },
    });
  }

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
          Channels
        </Text>
      </View>

      {isLoading && (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={56} borderRadius={12} />
          ))}
        </View>
      )}

      {!isLoading && (
        <FlatList
          data={channels ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item: channel }) => (
            <TouchableOpacity
              onPress={() => handleChannelPress(channel)}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#fff',
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                gap: 12,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 4,
                elevation: 2,
              }}
            >
              <Ionicons
                name={channel.is_restricted ? 'megaphone-outline' : 'chatbubbles-outline'}
                size={20}
                color={channel.is_restricted ? '#F59E0B' : '#0FA6A6'}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '600',
                    color: '#111827',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  # {channel.name}
                </Text>
                {channel.is_restricted && (
                  <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                    Officers only
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
              <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                No channels yet
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
