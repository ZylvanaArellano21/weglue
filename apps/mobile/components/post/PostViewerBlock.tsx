import { View, Text, TouchableOpacity, Dimensions, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { Pill } from '../shared/Pill';
import { PhotoCarousel } from '../shared/PhotoCarousel';
import { timeAgo } from '../home/PostCard';
import { openReportFlow } from '../shared/ReportButton';
import { LinkifiedText } from '../shared/LinkifiedText';
import { openProfile } from '../../lib/profileNavigation';
import { profileColors, profileFonts } from '../profile/profileTheme';
import type { FeedPost } from '../../services/postService';

const SCREEN_WIDTH = Dimensions.get('window').width;

// One full post block (identity → media → actions → caption). This is THE
// post-viewing unit for every vertical viewer in the app — the profile post
// viewer and the club Photos that Glue viewer render exactly this component,
// so there is never more than one post-viewing system.
export function PostViewerBlock({
  post,
  viewerUserId,
  onLike,
  onFollow,
  onRequestUnfollow,
  onOpenOptions,
  onShowToast,
}: {
  post: FeedPost;
  viewerUserId: string;
  onLike: (postId: string, hasLiked: boolean) => void;
  onFollow: (author: FeedPost['author']) => void;
  onRequestUnfollow: (author: FeedPost['author']) => void;
  /** Own posts: opens the edit/delete sheet. Omit to hide the ⋯ on own posts. */
  onOpenOptions?: () => void;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const router = useRouter();

  const isOwnPost = post.author.id === viewerUserId;
  const images: Array<{ path: string; width?: number | null; height?: number | null }> =
    post.images && post.images.length > 0
      ? post.images
      : post.image_url
        ? [{ path: post.image_url }]
        : [];

  const pressAuthor = () => {
    if (post.author_kind === 'club') {
      router.push({ pathname: '/club/[clubId]', params: { clubId: post.author.id } });
      return;
    }
    openProfile(router, post.author.id, viewerUserId);
  };

  return (
    <View style={styles.postBlock}>
      {/* Identity row — username and avatar always on top, matching the Home
          posts design, so no post ever appears "cut off" above its image. */}
      <View style={styles.identityRow}>
        <TouchableOpacity
          onPress={pressAuthor}
          activeOpacity={0.7}
          style={styles.identityLeft}
        >
          <Avatar uri={post.author.avatar_url} size={40} username={post.author.username} />
          <View>
            <Text style={styles.identityUsername}>@{post.author.username}</Text>
            {post.tagged_clubs.length > 0 && (
              <View style={styles.tagRow}>
                <Text style={styles.tagLabel}>tag </Text>
                {post.tagged_clubs.map((club, idx) => (
                  <TouchableOpacity
                    key={club.id}
                    onPress={() =>
                      router.push({
                        pathname: '/club/[clubId]',
                        params: { clubId: club.id },
                      } as any)
                    }
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tagClub}>
                      {club.name}
                      {idx < post.tagged_clubs.length - 1 ? ', ' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </TouchableOpacity>
        {isOwnPost ? (
          onOpenOptions ? (
            <TouchableOpacity
              onPress={onOpenOptions}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Post options"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={profileColors.textDark} />
            </TouchableOpacity>
          ) : null
        ) : (
          <View style={styles.identityRight}>
            {/* Stopping a follow (Following / Gluemate) confirms first; starting
                one (Follow / Follow back) never does — same rules as Home posts. */}
            <Pill
              variant={
                post.author.is_following
                  ? post.author.follows_me
                    ? 'gluemate'
                    : 'following'
                  : post.author.is_requested
                    ? 'following'
                    : post.author.follows_me
                      ? 'followBack'
                      : 'follow'
              }
              label={post.author.is_requested && !post.author.is_following ? 'Requested' : undefined}
              onPress={() => {
                if (post.author.is_following || post.author.is_requested) {
                  onRequestUnfollow(post.author);
                } else {
                  onFollow(post.author);
                }
              }}
            />
            {/* Report menu for other users' posts — the same app-wide flow */}
            <TouchableOpacity
              onPress={() =>
                openReportFlow({
                  entityType: 'post',
                  entityId: post.id,
                  entityName: post.caption,
                  clubId: post.tagged_clubs[0]?.id ?? null,
                })
              }
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Report this post"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={profileColors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Media. A single image keeps its natural aspect; a carousel of up to 5
          uses the first image's ratio, shared, so its height never jumps while
          swiping. */}
      {images.length > 0 ? (
        <PhotoCarousel
          images={images.map((img) => ({
            uri: img.path,
            width: img.width ?? null,
            height: img.height ?? null,
          }))}
          width={SCREEN_WIDTH}
          aspectRatio={4 / 5}
          naturalRatio
        />
      ) : null}

      {/* Action row */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={() => onLike(post.id, post.user_has_liked)}
          activeOpacity={0.7}
          style={styles.actionItem}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons
            name={post.user_has_liked ? 'heart' : 'heart-outline'}
            size={24}
            color={post.user_has_liked ? '#F02719' : profileColors.textDark}
          />
          <Text style={styles.actionCount}>{post.likes_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })}
          activeOpacity={0.7}
          style={styles.actionItem}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons name="chatbubble-outline" size={22} color={profileColors.textDark} />
          <Text style={styles.actionCount}>{post.comments_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/share', params: { contentType: 'post', contentId: post.id } })}
          activeOpacity={0.7}
          style={styles.actionItem}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons name="paper-plane-outline" size={22} color={profileColors.textDark} />
        </TouchableOpacity>
      </View>

      {/* Caption */}
      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.captionUsername}>@{post.author.username} </Text>
          <LinkifiedText text={post.caption} />
        </Text>
      ) : null}

      {/* Timestamp */}
      <Text style={styles.timestamp}>{timeAgo(post.created_at)}</Text>

    </View>
  );
}

const styles = StyleSheet.create({
  postBlock: { marginBottom: 18 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 20,
  },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionCount: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textDark,
  },
  caption: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textDark,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  captionUsername: { fontFamily: profileFonts.bold },
  timestamp: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textLight,
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  identityLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  identityRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identityUsername: {
    fontFamily: profileFonts.bold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 2 },
  tagLabel: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
  },
  tagClub: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.teal,
  },
});
