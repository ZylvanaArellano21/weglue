import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Modal,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import {
  useUserPostsFeed,
  useLikePost,
  useUpdatePostCaption,
} from '../../hooks/useHomePostsFeed';
import { useDeleteOwnPost } from '../../hooks/useOwnProfile';
import { followUser, unfollowUser } from '../../services/followService';
import { PostViewerBlock } from '../../components/post/PostViewerBlock';
import { ShowMoreSheet } from '../../components/profile/ShowMoreSheet';
import { ProfileConfirmationModal } from '../../components/profile/ProfileConfirmationModal';
import { useToast } from '../../components/Toast';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';
import type { FeedPost } from '../../services/postService';
import { CONTENT_UNAVAILABLE } from '../../lib/contentAvailability';

// Vertical full-post viewer opened from a profile's Posts grid.
// Instagram-style: the tapped post is the first visible one, and the
// profile's other posts are reachable by scrolling up/down.
export default function ProfilePostViewerScreen() {
  const { userId: profileUserId, postId } = useLocalSearchParams<{
    userId: string;
    postId: string;
  }>();
  const { session } = useAuthStore();
  const viewerUserId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { show, ToastComponent } = useToast();

  const listRef = useRef<FlatList<FeedPost>>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useUserPostsFeed(profileUserId, viewerUserId);
  const { mutate: likePost } = useLikePost();
  const deletePost = useDeleteOwnPost(viewerUserId);
  const updateCaption = useUpdatePostCaption();

  const posts = useMemo(() => data?.pages.flatMap((p) => p) ?? [], [data]);
  const initialIndex = useMemo(
    () => posts.findIndex((p) => p.id === postId),
    [posts, postId],
  );

  // The tapped post can sit on a page the viewer hasn't fetched yet —
  // keep paging until it's loaded so the list can start on it.
  useEffect(() => {
    if (isLoading) return;
    if (initialIndex < 0 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [initialIndex, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Instagram-style anchoring without scroll estimation (post blocks have
  // variable heights, so scrollToIndex-by-estimate clipped the first visible
  // post and could strand the last one half off-screen). Instead the list
  // initially renders FROM the tapped post — guaranteed flush with the top —
  // and one frame later the earlier posts are prepended while
  // maintainVisibleContentPosition keeps the anchor exactly in place, so
  // scrolling up still reaches the profile's earlier posts.
  const [showEarlierPosts, setShowEarlierPosts] = useState(false);
  const anchorIndex = initialIndex >= 0 ? initialIndex : 0;
  const displayPosts = useMemo(
    () => (showEarlierPosts ? posts : posts.slice(anchorIndex)),
    [posts, showEarlierPosts, anchorIndex],
  );

  useEffect(() => {
    if (showEarlierPosts || isLoading || initialIndex < 0) return;
    if (initialIndex === 0) {
      setShowEarlierPosts(true);
      return;
    }
    const timer = setTimeout(() => setShowEarlierPosts(true), 350);
    return () => clearTimeout(timer);
  }, [showEarlierPosts, isLoading, initialIndex]);

  const handleLike = (id: string, hasLiked: boolean) => {
    if (!viewerUserId) return;
    likePost(
      { userId: viewerUserId, postId: id, hasLiked },
      { onError: () => show('Failed to like post.', 'error') },
    );
  };

  const invalidateRelationshipQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['userPostsFeed', profileUserId] });
    queryClient.invalidateQueries({ queryKey: ['userProfile', profileUserId] });
    queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
  };

  // Starting a follow is immediate; stopping one confirms first (same rules
  // as the Home posts feed).
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

  // ─── Own-post edit/delete ─────────────────────────────────────────────────
  const [optionsPostId, setOptionsPostId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // Android: float the edit-caption dialog above the keyboard (iOS keeps KAV).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  const [editTarget, setEditTarget] = useState<FeedPost | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');

  const openEdit = (post: FeedPost) => {
    setOptionsPostId(null);
    setEditTarget(post);
    setCaptionDraft(post.caption ?? '');
  };

  const handleSaveCaption = () => {
    if (!editTarget || !viewerUserId) return;
    updateCaption.mutate(
      { userId: viewerUserId, postId: editTarget.id, caption: captionDraft },
      {
        onSuccess: () => show('Post updated!'),
        onError: () => show('Failed to update post.', 'error'),
      },
    );
    setEditTarget(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deletePost.mutateAsync(deleteTargetId);
      setDeleteTargetId(null);
      show('Post deleted.');
      // If that was the profile's only post there's nothing left to view.
      if (posts.length <= 1) router.back();
    } catch {
      setDeleteTargetId(null);
      show('Failed to delete post.', 'error');
    }
  };

  const optionsPost = posts.find((p) => p.id === optionsPostId) ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {ToastComponent}

      {isLoading || (initialIndex < 0 && hasNextPage) ? (
        // Also wait while earlier pages are still being fetched to locate the
        // tapped post, so the list always mounts anchored on it.
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={profileColors.teal} />
        </View>
      ) : initialIndex < 0 ? (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>{CONTENT_UNAVAILABLE}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayPosts}
          keyExtractor={(p) => p.id}
          showsVerticalScrollIndicator={false}
          // Top padding clears the floating back button so the first post's
          // identity row is never hidden; bottom padding keeps the last post
          // fully visible above the home indicator.
          contentContainerStyle={{ paddingTop: 54, paddingBottom: insets.bottom + 32 }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <PostViewerBlock
              post={item}
              viewerUserId={viewerUserId ?? ''}
              onLike={handleLike}
              onFollow={handleFollow}
              onRequestUnfollow={handleRequestUnfollow}
              onOpenOptions={() => setOptionsPostId(item.id)}
              onShowToast={show}
            />
          )}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <ActivityIndicator color={profileColors.teal} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.loading}>
              <Text style={styles.emptyText}>{CONTENT_UNAVAILABLE}</Text>
            </View>
          }
        />
      )}

      {/* Floating back button over the media (matches the mock) */}
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

      {/* Own-post options */}
      <ShowMoreSheet
        visible={optionsPostId !== null}
        title="Post options"
        onClose={() => setOptionsPostId(null)}
      >
        <TouchableOpacity
          style={styles.optionRow}
          activeOpacity={0.7}
          onPress={() => optionsPost && openEdit(optionsPost)}
        >
          <Ionicons name="create-outline" size={20} color={profileColors.textDark} />
          <Text style={styles.optionLabel}>Edit caption</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.optionRow}
          activeOpacity={0.7}
          onPress={() => {
            setDeleteTargetId(optionsPostId);
            setOptionsPostId(null);
          }}
        >
          <Ionicons name="trash-outline" size={20} color={profileColors.alertRed} />
          <Text style={[styles.optionLabel, { color: profileColors.alertRed }]}>
            Delete post
          </Text>
        </TouchableOpacity>
      </ShowMoreSheet>

      {/* Delete confirmation */}
      <ProfileConfirmationModal
        visible={deleteTargetId !== null}
        title="Delete post?"
        message="This will permanently remove the post from your profile."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
        loading={deletePost.isPending}
      />

      {/* Unfollow confirmation */}
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

      {/* Edit caption */}
      <Modal
        visible={editTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditTarget(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.editOverlay,
            Platform.OS === 'android' ? { paddingBottom: androidKeyboardHeight } : null,
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditTarget(null)} />
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Edit caption</Text>
            <TextInput
              value={captionDraft}
              onChangeText={(t) => setCaptionDraft(t.slice(0, 500))}
              placeholder="Write a caption..."
              placeholderTextColor={profileColors.textLight}
              style={styles.editInput}
              multiline
              maxLength={500}
              autoFocus
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                onPress={() => setEditTarget(null)}
                style={styles.editCancelBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveCaption}
                style={styles.editSaveBtn}
                activeOpacity={0.85}
              >
                <Text style={styles.editSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
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
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  optionLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  editOverlay: {
    flex: 1,
    backgroundColor: profileColors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  editCard: {
    width: '100%',
    backgroundColor: profileColors.bg,
    borderRadius: 16,
    padding: 20,
  },
  editTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
    marginBottom: 12,
  },
  editInput: {
    backgroundColor: profileColors.white,
    borderWidth: 1,
    borderColor: profileColors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textDark,
    minHeight: 80,
    maxHeight: 160,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  editCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  editCancelText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 14,
    color: profileColors.textMuted,
  },
  editSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: profileColors.teal,
    borderRadius: 20,
  },
  editSaveText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 14,
    color: profileColors.bg,
  },
});
