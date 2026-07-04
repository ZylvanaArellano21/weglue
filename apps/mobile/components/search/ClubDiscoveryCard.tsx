import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { DiscoveryClub } from '../../services/searchService';
import { searchCardShadow, searchColors, searchSizes, searchTypography } from './searchTheme';

const SCREEN_WIDTH = Dimensions.get('window').width;
export const CLUB_CARD_WIDTH =
  (SCREEN_WIDTH - searchSizes.screenPaddingH * 2 - searchSizes.gridGap) / 2;
export const CLUB_IMAGE_HEIGHT = Math.round(CLUB_CARD_WIDTH * searchSizes.clubImageAspect);

/** Optional meeting fields — not yet returned by get_discovery_clubs RPC */
export type ClubDiscoveryCardData = DiscoveryClub & {
  meeting_day?: string | null;
  meeting_time_start?: string | null;
  meeting_time_end?: string | null;
  meeting_building?: string | null;
  meeting_room?: string | null;
  cover_image_url?: string | null;
};

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

interface Props {
  club: ClubDiscoveryCardData;
  onJoin: (id: string) => void;
  joining: boolean;
}

export function ClubDiscoveryCard({ club, onJoin, joining }: Props) {
  const router = useRouter();
  const [imageError, setImageError] = useState(false);

  const imageUri = club.cover_image_url ?? club.avatar_url;
  const timeStr =
    club.meeting_time_start && club.meeting_time_end
      ? `${formatTime(club.meeting_time_start)} - ${formatTime(club.meeting_time_end)}`
      : null;
  const location =
    club.meeting_building && club.meeting_room
      ? `Building ${club.meeting_building}, Room ${club.meeting_room}`
      : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: club.id } })
      }
      activeOpacity={0.85}
    >
      <View style={styles.imageWrap}>
        {imageUri && !imageError ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image-outline" size={28} color={searchColors.meta} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {club.name}
        </Text>

        {(club.meeting_day || timeStr || location) && (
          <View style={styles.metaBlock}>
            {club.meeting_day ? <Text style={styles.meta}>{club.meeting_day}</Text> : null}
            {timeStr ? <Text style={styles.meta}>{timeStr}</Text> : null}
            {location ? <Text style={styles.meta}>{location}</Text> : null}
          </View>
        )}

        {club.is_member ? (
          <View style={styles.joinedBadge}>
            <Text style={styles.joinedText}>Joined</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => onJoin(club.id)}
            disabled={joining}
            activeOpacity={0.85}
            style={styles.joinBtn}
          >
            {joining ? (
              <ActivityIndicator size="small" color={searchColors.cream} />
            ) : (
              <Text style={styles.joinText}>Join</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CLUB_CARD_WIDTH,
    backgroundColor: searchColors.cream,
    borderRadius: searchSizes.clubCardRadius,
    overflow: 'hidden',
    ...searchCardShadow,
  },
  imageWrap: {
    width: '100%',
    height: CLUB_IMAGE_HEIGHT,
    backgroundColor: searchColors.imagePlaceholder,
    borderTopLeftRadius: searchSizes.clubCardRadius,
    borderTopRightRadius: searchSizes.clubCardRadius,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: searchColors.imagePlaceholder,
  },
  body: {
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 10,
    alignItems: 'center',
  },
  name: {
    ...searchTypography.clubName,
    textAlign: 'center',
    marginBottom: 2,
  },
  metaBlock: {
    alignItems: 'center',
    marginBottom: 6,
  },
  meta: {
    ...searchTypography.clubMeta,
    textAlign: 'center',
  },
  joinBtn: {
    minWidth: 55,
    height: searchSizes.joinBtnHeight,
    paddingHorizontal: 12,
    borderRadius: searchSizes.joinBtnRadius,
    backgroundColor: searchColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    ...searchCardShadow,
  },
  joinText: {
    ...searchTypography.joinBtn,
  },
  joinedBadge: {
    minWidth: 55,
    height: searchSizes.joinBtnHeight,
    paddingHorizontal: 10,
    borderRadius: searchSizes.joinBtnRadius,
    borderWidth: 1,
    borderColor: searchColors.teal,
    backgroundColor: searchColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinedText: {
    ...searchTypography.joinedBtn,
  },
});
