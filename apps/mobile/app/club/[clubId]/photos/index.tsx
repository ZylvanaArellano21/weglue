import { View, Text, TouchableOpacity, FlatList, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubPhotoFeed } from '../../../../hooks/useClubPhotos';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';
import { CarouselBadge } from '../../../../components/shared/PhotoCarousel';

export type PhotoGridParams = {
  clubId: string;
  clubName?: string;
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const PHOTO_SIZE = (SCREEN_WIDTH - GRID_GAP * 2) / 3;

const CREAM = '#FEFCF0';
const INK = '#000000';
const MUTED = '#5F5D5D';

// Photos that Glue "See all": a clean 3-column gallery of EVERY visible club
// photo (same source of truth as the club profile preview and the viewer).
// Tapping a photo opens the shared vertical post viewer anchored on it.
export default function ClubPhotosScreen() {
  const { clubId, clubName } = useLocalSearchParams<PhotoGridParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: items, isLoading } = useClubPhotoFeed(clubId, userId);
  const photos = items ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: CREAM }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{ marginRight: 12 }}
          hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={INK} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '700', color: INK, fontFamily: 'Zain_700Bold' }}>
          Photos that Glue
        </Text>
      </View>

      {isLoading ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} width={PHOTO_SIZE} height={PHOTO_SIZE} borderRadius={0} />
          ))}
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.photo.id}
          numColumns={3}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() =>
                router.push({
                  pathname: '/club/[clubId]/photos/viewer',
                  params: { clubId: clubId!, photoId: item.photo.id, clubName: clubName ?? '' },
                } as any)
              }
            >
              <Image
                source={{ uri: item.post?.image_url ?? item.photo.url }}
                style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, backgroundColor: '#E5E7EB' }}
                resizeMode="cover"
              />
              {(item.post?.images?.length ?? item.photo.image_count) > 1 ? <CarouselBadge /> : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
              <Text style={{ fontSize: 14, color: MUTED, fontFamily: 'Inter_400Regular' }}>
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
