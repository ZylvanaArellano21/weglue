import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getPostById } from '../../services/postService';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  postId: string;
  viewerUserId: string;
}

// Renders inside MessageBubble's cardSlot. Fetches through getPostById(),
// so it respects the same RLS/visibility rules as opening the post directly.
export function PostShareCard({ postId, viewerUserId }: Props) {
  const router = useRouter();
  const { data: post, isLoading } = useQuery({
    queryKey: ['postById', postId, viewerUserId],
    queryFn: () => getPostById(postId, viewerUserId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={chatColors.teal} />
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
      <View style={styles.badgeRow}>
        <Ionicons name="image" size={12} color={chatColors.teal} />
        <Text style={styles.badgeText}>POST</Text>
      </View>
      <View style={styles.body}>
        {post.image_url ? (
          <Image source={{ uri: post.image_url }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={22} color={chatColors.textMuted} />
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            @{post.author.username}
          </Text>
          {post.caption ? (
            <Text style={styles.meta} numberOfLines={2}>
              {post.caption}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 240,
    backgroundColor: chatColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatColors.border,
    padding: 10,
    ...chatShadow,
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
  body: {
    flexDirection: 'row',
    gap: 10,
  },
  image: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  imagePlaceholder: {
    backgroundColor: chatColors.tagBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.text,
    marginBottom: 3,
  },
  meta: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
  },
  unavailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unavailableText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    flexShrink: 1,
  },
});
