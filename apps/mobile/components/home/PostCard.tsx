import { memo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { Pill } from '../shared/Pill';
import { cardSurface, cardClip, cardDepth } from '../shared/cardStyles';
import { PhotoCarousel } from '../shared/PhotoCarousel';
import { openProfile } from '../../lib/profileNavigation';
import type { FeedPost } from '../../services/postService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TEAL = '#0FA6A6';

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
}

export interface PostCardProps {
  post: FeedPost;
  viewerUserId: string;
  onLike: (postId: string, hasLiked: boolean) => void;
  onFollow: (author: FeedPost['author']) => void;
  onRequestUnfollow: (author: FeedPost['author']) => void;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const PostCard = memo(function PostCard({
  post,
  viewerUserId,
  onLike,
  onFollow,
  onRequestUnfollow,
  onShowToast,
}: PostCardProps) {
  const router = useRouter();
  const [sharePressed, setSharePressed] = useState(false);

  const handlePressAuthor = () => {
    if (post.author_kind === 'club') {
      router.push({ pathname: '/club/[clubId]', params: { clubId: post.author.id } });
      return;
    }
    openProfile(router, post.author.id, viewerUserId);
  };

  const handlePressClub = (clubId: string) => {
    router.push({ pathname: '/club/[clubId]', params: { clubId } });
  };

  const images: Array<{ path: string; width?: number | null; height?: number | null }> =
    post.images && post.images.length > 0
      ? post.images
      : post.image_url
        ? [{ path: post.image_url }]
        : [];

  const isOwnPost = post.author.id === viewerUserId;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 16, ...cardDepth }}>
    <View style={{ ...cardSurface, ...cardClip }}>
      {/* Author Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 10,
        }}
      >
        <TouchableOpacity onPress={handlePressAuthor} activeOpacity={0.7}>
          <Avatar uri={post.author.avatar_url} size={40} username={post.author.username} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <TouchableOpacity onPress={handlePressAuthor} activeOpacity={0.7}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Inter_700Bold',
              }}
            >
              @{post.author.username}
            </Text>
          </TouchableOpacity>
          {post.tagged_clubs.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              <Text style={{ fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                tag{' '}
              </Text>
              {post.tagged_clubs.map((club, idx) => (
                <TouchableOpacity key={club.id} onPress={() => handlePressClub(club.id)} activeOpacity={0.7}>
                  <Text style={{ fontSize: 13, color: TEAL, fontFamily: 'Inter_400Regular' }}>
                    {club.name}
                    {idx < post.tagged_clubs.length - 1 ? ', ' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {!isOwnPost && (
          // Relationship pill. Stopping a follow (Following / Gluemate) always
          // confirms first; starting one (Follow / Follow back) never does.
          <Pill
            variant={
              post.author.is_following
                ? post.author.follows_me
                  ? 'gluemate'
                  : 'following'
                : post.author.is_requested
                  ? 'following' // gray outline, relabeled "Requested" below
                  : post.author.follows_me
                    ? 'followBack'
                    : 'follow'
            }
            label={post.author.is_requested && !post.author.is_following ? 'Requested' : undefined}
            onPress={() => {
              if (post.author.is_following) {
                onRequestUnfollow(post.author);
              } else if (post.author.is_requested) {
                // Cancel the pending request — same immediate behavior as the
                // profile screen's Requested button.
                onRequestUnfollow(post.author);
              } else {
                onFollow(post.author);
              }
            }}
          />
        )}
      </View>

      {/* Post image(s). A single image keeps its natural aspect (portrait stays
          portrait, landscape stays landscape); a carousel of up to 5 uses one
          shared ratio so its height never jumps while swiping. */}
      {images.length > 0 ? (
        <PhotoCarousel
          images={images.map((img) => ({
            uri: img.path,
            width: img.width ?? null,
            height: img.height ?? null,
          }))}
          width={SCREEN_WIDTH - 32}
          aspectRatio={4 / 5}
          naturalSingle
        />
      ) : null}

      {/* Interaction Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingTop: 12,
          gap: 20,
        }}
      >
        <TouchableOpacity
          onPress={() => onLike(post.id, post.user_has_liked)}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons
            name={post.user_has_liked ? 'heart' : 'heart-outline'}
            size={22}
            color={post.user_has_liked ? '#F02719' : '#374151'}
          />
          <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular' }}>
            {post.likes_count}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons name="chatbubble-outline" size={20} color="#374151" />
          <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular' }}>
            {post.comments_count}
          </Text>
        </TouchableOpacity>
        <Pressable
          onPress={() => router.push({ pathname: '/share', params: { contentType: 'post', contentId: post.id } })}
          onPressIn={() => setSharePressed(true)}
          onPressOut={() => setSharePressed(false)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 8,
            paddingVertical: 6,
            borderRadius: 16,
            backgroundColor: sharePressed ? 'rgba(15,166,166,0.12)' : 'transparent',
          }}
        >
          <Ionicons
            name="paper-plane-outline"
            size={20}
            color={sharePressed ? TEAL : '#374151'}
          />
        </Pressable>
      </View>


      {/* Caption */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 }}>
        {post.caption ? (
          <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
            <Text style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}>
              @{post.author.username}{' '}
            </Text>
            {post.caption}
          </Text>
        ) : null}
        <Text
          style={{
            fontSize: 12,
            color: '#9CA3AF',
            fontFamily: 'Inter_400Regular',
            marginTop: 6,
          }}
        >
          {timeAgo(post.created_at)}
        </Text>
      </View>
    </View>
    </View>
  );
});
