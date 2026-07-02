import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  onBrowseClubs: () => void;
  onNewGroupChat?: () => void;
}

/**
 * Empty state when Group filter is active but user has zero group chats.
 * No Figma illustration frame found — using Ionicons people-circle as placeholder.
 */
export function GroupEmptyState({ onBrowseClubs, onNewGroupChat }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name="people-circle-outline" size={72} color={chatColors.teal} />
      </View>
      <Text style={styles.title}>No group chats yet</Text>
      <Text style={styles.body}>
        Join a club to unlock group conversations, or start your own group chat with friends.
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onBrowseClubs} activeOpacity={0.85}>
        <Text style={styles.primaryLabel}>Browse Clubs</Text>
      </TouchableOpacity>
      {onNewGroupChat && (
        <TouchableOpacity onPress={onNewGroupChat} activeOpacity={0.7} style={styles.linkWrap}>
          <Text style={styles.linkLabel}>or start a new group chat</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  iconCircle: {
    marginBottom: 20,
    opacity: 0.9,
  },
  title: {
    fontFamily: chatFonts.semiBold,
    fontSize: 18,
    color: chatColors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  primaryBtn: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    paddingVertical: 16,
    alignItems: 'center',
    ...chatShadow,
  },
  primaryLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 16,
    color: chatColors.cream,
    letterSpacing: 0.38,
  },
  linkWrap: {
    marginTop: 16,
    paddingVertical: 8,
  },
  linkLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.teal,
    textAlign: 'center',
  },
});
