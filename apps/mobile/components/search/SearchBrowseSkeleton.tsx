import { View, ScrollView, StyleSheet } from 'react-native';
import { Skeleton } from '../shared/SkeletonLoader';
import {
  CLUB_CARD_WIDTH,
  CLUB_IMAGE_HEIGHT,
} from './ClubDiscoveryCard';
import { searchColors, searchSizes } from './searchTheme';

function ClubCardSkeleton() {
  return (
    <View style={styles.clubCard}>
      <Skeleton width={CLUB_CARD_WIDTH} height={CLUB_IMAGE_HEIGHT} borderRadius={0} />
      <View style={styles.clubBody}>
        <Skeleton width={CLUB_CARD_WIDTH * 0.6} height={14} borderRadius={4} />
        <Skeleton width={CLUB_CARD_WIDTH * 0.75} height={10} borderRadius={4} style={{ marginTop: 6 }} />
        <Skeleton width={CLUB_CARD_WIDTH * 0.7} height={10} borderRadius={4} style={{ marginTop: 4 }} />
        <Skeleton width={55} height={18} borderRadius={20} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

function PersonCardSkeleton() {
  return (
    <View style={styles.personCard}>
      <Skeleton width={searchSizes.personAvatarSize} height={searchSizes.personAvatarSize} borderRadius={26} />
      <Skeleton width={80} height={14} borderRadius={4} style={{ marginTop: 10 }} />
      <Skeleton width={66} height={18} borderRadius={20} style={{ marginTop: 6 }} />
    </View>
  );
}

export function PeopleDiscoverySkeleton() {
  return (
    <View style={styles.peopleOnly}>
      <Skeleton
        width={158}
        height={18}
        borderRadius={4}
        style={{ marginLeft: searchSizes.screenPaddingH, marginBottom: 12 }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
        <PersonCardSkeleton />
        <PersonCardSkeleton />
        <PersonCardSkeleton />
      </ScrollView>
    </View>
  );
}

interface Props {
  showPeople?: boolean;
}

export function SearchBrowseSkeleton({ showPeople = true }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.pillsRow}>
        <Skeleton width={102} height={24} borderRadius={20} />
        <Skeleton width={61} height={24} borderRadius={20} />
        <Skeleton width={78} height={24} borderRadius={20} />
      </View>

      <View style={styles.grid}>
        <ClubCardSkeleton />
        <ClubCardSkeleton />
        <ClubCardSkeleton />
        <ClubCardSkeleton />
      </View>

      {showPeople && (
        <>
          <Skeleton
            width={158}
            height={18}
            borderRadius={4}
            style={{ marginLeft: searchSizes.screenPaddingH, marginTop: 20, marginBottom: 12 }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
            <PersonCardSkeleton />
            <PersonCardSkeleton />
            <PersonCardSkeleton />
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: searchSizes.screenPaddingH,
    paddingTop: 12,
    paddingBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: searchSizes.gridGap,
    paddingHorizontal: searchSizes.screenPaddingH,
    paddingTop: 12,
  },
  clubCard: {
    width: CLUB_CARD_WIDTH,
    backgroundColor: searchColors.cream,
    borderRadius: searchSizes.clubCardRadius,
    overflow: 'hidden',
  },
  clubBody: {
    padding: 8,
    alignItems: 'center',
  },
  peopleRow: {
    paddingHorizontal: searchSizes.screenPaddingH,
    gap: 14,
    paddingBottom: 24,
  },
  peopleOnly: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  personCard: {
    width: searchSizes.personCardWidth,
    height: searchSizes.personCardHeight,
    backgroundColor: searchColors.cream,
    borderRadius: searchSizes.clubCardRadius,
    alignItems: 'center',
    paddingTop: 14,
  },
});
