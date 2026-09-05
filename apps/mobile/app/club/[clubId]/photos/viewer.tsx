import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { useClubPhotoFeed, type ClubPhotoFeedItem } from '../../../../hooks/useClubPhotos';
import { useLikePost } from '../../../../hooks/useHomePostsFeed';
import { followUser, unfollowUser } from '../../../../services/followService';
import { PostViewerBlock } from '../../../../components/post/PostViewerBlock';
import { ProfileConfirmationModal } from '../../../../components/profile/ProfileConfirmationModal';
import { Avatar } from '../../../../components/shared/Avatar';
import { LinkifiedText } from '../../../../components/shared/LinkifiedText';
import { useToast } from '../../../../components/Toast';
import { timeAgo } from '../../../../components/home/PostCard';
import { profileColors, profileFonts } from '../../../../components/profile/profileTheme';
import type { FeedPost } from '../../../../services/postService';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Photos that Glue full viewer — Instagram-style: opens anchored on the
// tapped photo, scrolls vertically through ALL of the club's photos. Tagged
// posts render the exact same PostViewerBlock as the profile post viewer
// (one post-viewing system app-wide); officer uploads render a simplified
// photo block. Solid cream background — never a transparent overlay.
export default function ClubPhotoViewerScreen() {
  const { clubId, photoId, clubName } = useLocalSearchParams<{
    clubId: string;
    photoId: string;
    clubName?: string;
  }>();
  const { session } = useAuthStore();
  const viewerUserId = session?.user.id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const { data: items, isLoading } = useClubPhotoFeed(clubId, viewerUserId);
  const { mutate: likePost } = useLikePost();

  const feed = items ?? [];
  const initialIndex = useMemo(
    () => feed.findIndex((item) => item.photo.id === photoId),
    [feed, photoId],
  );

  // Same anchoring approach as the profile post viewer: mount the list FROM
  // the tapped photo (flush with the top), then prepend the earlier photos a
  // beat later while maintainVisibleContentPosition holds the anchor.
  const [showEarlier, setShowEarlier] = useState(false);
  const anchorIndex = initialIndex >= 0 ? initialIndex : 0;
  const displayItems = useMemo(
    () => (showEarlier ? feed : feed.slice(anchorIndex)),
    [feed, showEarlier, anchorIndex],
  );

  useEffect(() => {
    if (showEarlier || isLoading || feed.length === 0) return;
    if (anchorIndex === 0) {
      setShowEarlier(true);
      return;
    }
    const timer = setTimeout(() => setShowEarlier(true), 350);
    return () => clearTimeout(timer);
  }, [showEarlier, isLoading, anchorIndex, feed.length]);

  const handleLike = (id: string, hasLiked: boolean) => {
    if (!viewerUserId) return;
    likePost(
      { userId: viewerUserId, postId: id, hasLiked },
      { onError: () => show('Failed to like post.', 'error') },
    );
  };

  const invalidateRelationshipQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['clubPhotoFeed'] });
    queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
  };

  const handleFollow = async (author: FeedPost['author']) => {
    if (!viewerUserId) return;
    try {
      await followUser(viewerUserId, author.id);
      invalidateRelationshipQueries();
      show(
        author.profile_is_private
          ? 'Follow request sent!'
          : author.follows_me
            ? "You're now Gluemates! 🎉"
            : 'Following! 🎉',
      );
    } catch {
      show('Failed to follow user.', 'error');
    }
  };

  const [unfollowTarget, setUnfollowTarget] = useState<FeedPost['author'] | null>(null);

  const performUnfollow = async (author: FeedPost['author'], successMessage: string) => {
    if (!viewerUserId) return;
    try {
      await unfollowUser(viewerUserId, author.id);
      invalidateRelationshipQueries();
      show(successMessage);
    } catch {
      show('Failed to unfollow.', 'error');
    }
  };

  const handleRequestUnfollow = (author: FeedPost['author']) => {
    if (!author.is_following && author.is_requested) {
      void performUnfollow(author, 'Request canceled.');
      return;
    }
    setUnfollowTarget(author);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {ToastComponent}

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={profileColors.teal} />
        </View>
      ) : feed.length === 0 || initialIndex < 0 ? (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>This photo is no longer available.</Text>
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={(item) => item.photo.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 54, paddingBottom: insets.bottom + 32 }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={({ item }) =>
            item.post ? (
              <PostViewerBlock
                post={item.post}
                viewerUserId={viewerUserId ?? ''}
                onLike={handleLike}
                onFollow={handleFollow}
                onRequestUnfollow={handleRequestUnfollow}
                onShowToast={show}
              />
            ) : (
              <OfficerUploadBlock item={item} clubName={clubName || 'Club photo'} />
            )
          }
        />
      )}

      {/* Floating back button — returns to the exact previous screen/position */}
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.8}
        style={[styles.backBtn, { top: insets.top + 8 }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      {/* Unfollow confirmation — same rules as every other post surface */}
      <ProfileConfirmationModal
        visible={!!unfollowTarget}
        title={`Unfollow @${unfollowTarget?.username ?? ''}?`}
        message={
          unfollowTarget?.follows_me
            ? `You'll no longer be Gluemates. @${unfollowTarget?.username ?? ''} will still follow you.`
            : `You'll stop following @${unfollowTarget?.username ?? ''}.`
        }
        confirmLabel="Unfollow"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          const author = unfollowTarget;
          setUnfollowTarget(null);
          if (author) void performUnfollow(author, 'Unfollowed.');
        }}
        onCancel={() => setUnfollowTarget(null)}
      />
    </SafeAreaView>
  );
}

// Officer-uploaded club photo (no backing post): image with the club as the
// author line and the photo caption — same layout rhythm as a post block.
function OfficerUploadBlock({ item, clubName }: { item: ClubPhotoFeedItem; clubName: string }) {
  return (
    <View style={styles.uploadBlock}>
      <View style={styles.uploadHeader}>
        <Avatar uri={null} size={40} username={clubName} />
        <Text style={styles.uploadName}>{clubName}</Text>
      </View>
      <Image
        source={{ uri: item.photo.url }}
        style={styles.uploadMedia}
        resizeMode="cover"
        fadeDuration={0}
      />
      {item.photo.caption ? <LinkifiedText text={item.photo.caption} style={styles.uploadCaption} /> : null}
      <Text style={styles.uploadTimestamp}>{timeAgo(item.photo.created_at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textLight,
  },
  backBtn: {
    position: 'absolute',
    left: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBlock: { marginBottom: 18 },
  uploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  uploadName: {
    fontFamily: profileFonts.bold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  uploadMedia: {
    width: SCREEN_WIDTH,
    aspectRatio: 4 / 5,
    backgroundColor: profileColors.border,
  },
  uploadCaption: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textDark,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  uploadTimestamp: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textLight,
    paddingHorizontal: 14,
    paddingTop: 6,
  },
});
