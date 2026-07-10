import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getPostById } from '../../services/postService';
import { Avatar } from '../shared/Avatar';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  /** null = the post was deleted (messages.shared_post_id is SET NULL);
   * the message survives and renders the unavailable card. */
  postId: string | null;
  viewerUserId: string;
}

export function PostShareCard({ postId, viewerUserId }: Props) {
  const router = useRouter();
  const { data: post, isLoading } = useQuery({
    queryKey: ['postDetail', postId, viewerUserId],
    queryFn: () => getPostById(postId!, viewerUserId),
    enabled: !!postId,
    staleTime: 60 * 1000,
  });

  if (isLoading && postId) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <Ionicons name="image-outline" size={18} color={chatColors.teal} />
          <Text style={styles.loadingText}>Loading post…</Text>
        </View>
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.card}>
        <View style={styles.unavailableRow}>
          <Ionicons name="image-outline" size={18} color={chatColors.textMuted} />
          <Text style={styles.unavailableText}>This post is no longer available.</Text>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: post.id } })}
    >
      <View style={styles.accentBar} />
      <View style={styles.content}>
        <View style={styles.badgeRow}>
          <Ionicons name="image" size={12} color={chatColors.teal} />
          <Text style={styles.badgeText}>POST</Text>
        </View>
        <View style={styles.authorRow}>
          <Avatar uri={post.author.avatar_url} size={24} username={post.author.username} />
          <Text style={styles.authorName} numberOfLines={1}>
            @{post.author.username}
          </Text>
        </View>
        {post.image_url ? (
          <Image source={{ uri: post.image_url }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <View style={[styles.heroImage, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={28} color={chatColors.textMuted} />
          </View>
        )}
        {post.caption ? (
          <Text style={styles.caption} numberOfLines={2}>
            {post.caption}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    backgroundColor: chatColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatColors.border,
    overflow: 'hidden',
    flexDirection: 'row',
    ...chatShadow,
  },
  accentBar: {
    width: 4,
    backgroundColor: chatColors.teal,
  },
  content: {
    flex: 1,
    padding: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  badgeText: {
    fontFamily: chatFonts.bold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: chatColors.teal,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  authorName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.text,
    flex: 1,
  },
  heroImage: {
    width: '100%',
    height: 88,
    borderRadius: 10,
    marginBottom: 8,
  },
  imagePlaceholder: {
    backgroundColor: chatColors.tagBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    lineHeight: 17,
  },
  loadingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  loadingText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
  },
  unavailableRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  unavailableText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    flexShrink: 1,
  },
});
