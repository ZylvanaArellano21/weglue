import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from '../shared/Avatar';
import type { DiscoveryPerson } from '../../services/searchService';
import { searchCardShadow, searchColors, searchSizes, searchTypography } from './searchTheme';

interface Props {
  person: DiscoveryPerson;
}

export function PersonDiscoveryCard({ person }: Props) {
  const router = useRouter();
  const displayName = person.full_name ?? person.username;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({ pathname: '/profile/[userId]', params: { userId: person.user_id } })
      }
      activeOpacity={0.85}
    >
      <Avatar
        uri={person.avatar_url}
        size={searchSizes.personAvatarSize}
        username={person.username}
      />
      <Text style={styles.name} numberOfLines={1}>
        {displayName}
      </Text>
      {person.club_name ? (
        <View style={styles.tag}>
          <Text style={styles.tagText} numberOfLines={1}>
            {person.club_name}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: searchSizes.personCardWidth,
    height: searchSizes.personCardHeight,
    backgroundColor: searchColors.cream,
    borderRadius: searchSizes.clubCardRadius,
    alignItems: 'center',
    paddingTop: 14,
    paddingHorizontal: 8,
    ...searchCardShadow,
  },
  name: {
    ...searchTypography.personName,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  tag: {
    height: searchSizes.clubTagHeight,
    minWidth: 66,
    maxWidth: searchSizes.personCardWidth - 16,
    paddingHorizontal: 8,
    borderRadius: searchSizes.clubTagRadius,
    backgroundColor: searchColors.tagBg,
    alignItems: 'center',
    justifyContent: 'center',
    ...searchCardShadow,
  },
  tagText: {
    ...searchTypography.clubTag,
    textAlign: 'center',
  },
});
