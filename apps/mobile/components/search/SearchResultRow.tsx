import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from '../shared/Avatar';
import { chatColors, chatFonts, chatSizes } from '../chat/chatTheme';
import type { SearchResult } from '../../services/searchService';

interface Props {
  item: SearchResult;
  onJoin: (id: string) => void;
  joiningId: string | null;
}

/** Matches Message tab sectioned search row styling exactly */
export function SearchResultRow({ item, onJoin, joiningId }: Props) {
  const router = useRouter();

  const handlePress = () => {
    if (item.result_type === 'person') {
      router.push({ pathname: '/profile/[userId]', params: { userId: item.id } });
    } else {
      router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: item.id } });
    }
  };

  return (
    <TouchableOpacity style={styles.row} onPress={handlePress} activeOpacity={0.7}>
      <Avatar uri={item.avatar_url} size={chatSizes.avatarSuggested} username={item.name} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {item.sub ? (
          <Text style={styles.sub} numberOfLines={1}>
            {item.result_type === 'person' ? `@${item.sub}` : `${item.sub} members`}
          </Text>
        ) : null}
      </View>
      {item.result_type === 'club' && !item.is_member && (
        <TouchableOpacity
          onPress={() => onJoin(item.id)}
          disabled={joiningId === item.id}
          activeOpacity={0.85}
          style={styles.joinBtn}
        >
          {joiningId === item.id ? (
            <ActivityIndicator size="small" color={chatColors.cream} />
          ) : (
            <Text style={styles.joinText}>Join</Text>
          )}
        </TouchableOpacity>
      )}
      {item.result_type === 'club' && item.is_member && (
        <View style={styles.joinedBadge}>
          <Text style={styles.joinedText}>Joined</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function SearchSectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.textMuted,
    letterSpacing: 0.8,
    paddingHorizontal: 23,
    paddingVertical: 10,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 23,
    paddingVertical: 12,
    gap: 12,
  },
  text: {
    flex: 1,
  },
  name: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  sub: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 2,
  },
  joinBtn: {
    backgroundColor: chatColors.teal,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 52,
    alignItems: 'center',
  },
  joinText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.cream,
  },
  joinedBadge: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: chatColors.teal,
  },
  joinedText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.teal,
  },
});
