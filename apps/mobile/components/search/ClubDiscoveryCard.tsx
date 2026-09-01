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
    <View style={styles.cardOuter}>
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({ pathname: '/club/[clubId]', params: { clubId: club.id } })
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
        <Text style={styles.name} numberOfLines={2}>
          {club.name}
        </Text>

        <View style={styles.metaBlock}>
          {club.meeting_day ? (
            <Text style={styles.meta} numberOfLines={1}>{club.meeting_day}</Text>
          ) : null}
          {timeStr ? (
            <Text style={styles.meta} numberOfLines={1}>{timeStr}</Text>
          ) : null}
          {location ? (
            <Text style={styles.meta} numberOfLines={2}>{location}</Text>
          ) : null}
          {!club.meeting_day && !timeStr && !location ? (
            <Text style={styles.metaEmpty} numberOfLines={1}>Schedule coming soon</Text>
          ) : null}
        </View>

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
              <ActivityIndicator size="small" color={searchColors.white} />
            ) : (
              <Text style={styles.joinText}>Join</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Depth lives on the outer view (no clipping); the inner card clips the
  // image to the rounded corners. One view can't do both on Android.
  cardOuter: {
    width: CLUB_CARD_WIDTH,
    borderRadius: searchSizes.clubCardRadius,
    ...searchCardShadow,
  },
  card: {
    width: '100%',
    // White body so the raised card pops off the cream page (was `cream`,
    // which blended into the background and killed the 3D look).
    backgroundColor: searchColors.cardBg,
    borderRadius: searchSizes.clubCardRadius,
    overflow: 'hidden',
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
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    // Left-align the text block to match the design (was centered).
    alignItems: 'stretch',
  },
  name: {
    ...searchTypography.clubName,
    textAlign: 'left',
    marginBottom: 4,
  },
  metaBlock: {
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  meta: {
    ...searchTypography.clubMeta,
    textAlign: 'left',
  },
  metaEmpty: {
    ...searchTypography.clubMeta,
    fontStyle: 'italic',
    textAlign: 'left',
  },
  joinBtn: {
    alignSelf: 'center',
    minWidth: 88,
    height: searchSizes.joinBtnHeight,
    paddingHorizontal: 18,
    borderRadius: searchSizes.joinBtnRadius,
    backgroundColor: searchColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinText: {
    ...searchTypography.joinBtn,
    color: searchColors.white,
  },
  joinedBadge: {
    alignSelf: 'center',
    minWidth: 88,
    height: searchSizes.joinBtnHeight,
    paddingHorizontal: 18,
    borderRadius: searchSizes.joinBtnRadius,
    borderWidth: 1.5,
    borderColor: searchColors.teal,
    backgroundColor: searchColors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinedText: {
    ...searchTypography.joinedBtn,
  },
});
