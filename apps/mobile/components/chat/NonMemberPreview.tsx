import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { MessageBubble } from './MessageBubble';
import type { DirectMessageThread } from '../../services/chatService';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  messages: DirectMessageThread[];
  chatName: string;
  onJoin: () => void;
  joining?: boolean;
}

/**
 * Read-only preview for non-members. No input bar; sticky Join CTA at bottom.
 */
export function NonMemberPreview({ messages, onJoin, joining = false }: Props) {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        scrollEnabled={sorted.length > 0}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => {
          const prev = sorted[index - 1];
          const showSenderInfo = !prev || prev.sender_id !== item.sender_id;
          return (
            <MessageBubble
              id={item.id}
              senderId={item.sender_id}
              senderUsername={item.sender.username}
              senderAvatarUrl={item.sender.avatar_url}
              content={item.content}
              attachmentUrl={item.attachment_url}
              messageType={item.message_type}
              createdAt={item.created_at}
              isOwn={false}
              showSenderInfo={showSenderInfo}
            />
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No messages yet</Text>
          </View>
        }
      />

      <View style={styles.ctaBar}>
        <Text style={styles.ctaQuestion}>Do you want to chat?</Text>
        <TouchableOpacity
          style={[styles.joinBtn, joining && styles.joinBtnDisabled]}
          onPress={onJoin}
          disabled={joining}
          activeOpacity={0.85}
        >
          <Text style={styles.joinLabel}>{joining ? 'Joining…' : 'Join the club'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: chatColors.bg,
  },
  list: {
    paddingVertical: 12,
    flexGrow: 1,
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  ctaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: chatColors.bg,
    borderTopWidth: 1,
    borderTopColor: chatColors.border,
  },
  ctaQuestion: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
    flex: 1,
    marginRight: 12,
  },
  joinBtn: {
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    paddingHorizontal: 20,
    paddingVertical: 10,
    ...chatShadow,
  },
  joinBtnDisabled: {
    opacity: 0.6,
  },
  joinLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.cream,
    letterSpacing: 0.38,
  },
});
