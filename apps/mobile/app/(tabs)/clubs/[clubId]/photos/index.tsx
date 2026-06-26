import { View, Text, TouchableOpacity, FlatList, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useClubProfile } from '../../../../../hooks/useClubProfile';
import { useAuthStore } from '@weglue/shared';
import { Skeleton } from '../../../../../components/shared/SkeletonLoader';

export type PhotoGridParams = {
  clubId: string;
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_SIZE = (SCREEN_WIDTH - 4) / 3;

export default function ClubPhotosScreen() {
  const { clubId } = useLocalSearchParams<PhotoGridParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: club, isLoading } = useClubProfile(clubId, userId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: '#000',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff', fontFamily: 'Zain_700Bold' }}>
          Photos that Glue
        </Text>
      </View>

      {isLoading && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} width={PHOTO_SIZE} height={PHOTO_SIZE} borderRadius={0} />
          ))}
        </View>
      )}

      {!isLoading && (
        <FlatList
          data={club?.photos ?? []}
          keyExtractor={(item) => item.id}
          numColumns={3}
          renderItem={({ item: photo }) => (
            <TouchableOpacity activeOpacity={0.85} style={{ margin: 0.5 }}>
              <Image
                source={{ uri: photo.url }}
                style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, backgroundColor: '#1F2937' }}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
              <Text style={{ fontSize: 14, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                No photos yet
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}
