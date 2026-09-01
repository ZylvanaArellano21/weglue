/**
 * Comments — root-level transparent-modal route (was a RN <Modal> sheet).
 *
 * As a real route the sheet is a layer in the navigation history: tapping a
 * commenter pushes their profile ABOVE this route, so Back restores the SAME
 * Comments instance — its loaded comments, scroll position and draft all
 * survive because the route stays mounted underneath. The old sheet had to
 * dismiss itself before navigating, losing all of that.
 *
 * Journey: Post → Comments → Commenter Profile → Message
 *   Back: Message → Profile → (same) Comments → close → (same) Post.
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../components/shared/Avatar';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import { useComposerBottomInset } from '../../lib/useComposerBottomInset';
import { usePostComments, useAddComment, usePostDetail } from '../../hooks/useHomePostsFeed';
import { timeAgo } from '../../components/home/PostCard';
import type { PostComment } from '../../services/postService';
import { openReportFlow } from '../../components/shared/ReportButton';
import { openProfile } from '../../lib/profileNavigation';
import { clientUuid } from '../../lib/chatAttachments';

export default function CommentsScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { session } = useAuthStore();
  const viewerUserId = session?.user.id ?? '';

  // Android: lift the sheet + composer above the keyboard (iOS keeps KAV).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  // Bottom breathing room, painted INSIDE the opaque sheet in both states.
  const composerBottomInset = useComposerBottomInset();
  const [draft, setDraft] = useState('');
  // One idempotency tag per comment; reused if a send has to be retried,
  // regenerated after a comment is posted (migration 100).
  const commentTagRef = useRef(clientUuid());
  const { data: post, isLoading: isPostLoading } = usePostDetail(postId, viewerUserId);
  const { data: comments = [], isLoading } = usePostComments(postId);
  const { mutate: submitComment, isPending } = useAddComment();

  // Push the commenter's profile ABOVE this route — no dismiss. Back restores
  // this exact Comments instance (draft + scroll intact).
  const handlePressCommenter = (userId: string) => {
    openProfile(router, userId, viewerUserId);
  };

  const close = () => {
    Keyboard.dismiss();
    router.back();
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content || isPending) return;
    submitComment(
      { postId, userId: viewerUserId, content, clientTag: commentTagRef.current },
      {
        onSuccess: () => {
          setDraft('');
          commentTagRef.current = clientUuid();
        },
      },
    );
  };

  // A Comments sheet with NO post id is never a legitimate state — this screen
  // is only ever reached by tapping comments on a specific post. It could only
  // be mounted param-less by the navigator itself choosing it as a launch
  // destination, which is the cold-launch bug fixed in app/_layout.tsx (the
  // anchor route must be declared first). This guard is the structural
  // backstop for that: rather than rendering "This post is no longer
  // available" over an empty screen and trapping the user, send them to Home —
  // the correct destination for opening the app. Declared AFTER every hook
  // above so hook order is never conditional.
  if (!postId) return <Redirect href="/(tabs)" />;

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={close} />

      {/* flex:1 gives the sheet's `maxHeight: '85%'` a DEFINITE height to
          resolve against. Without it the KAV was content-sized, the percentage
          could not resolve, and the composer rendered outside the cream box —
          which is what exposed the feed behind the sheet. box-none keeps
          backdrop taps reaching the Pressable underneath. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={[
          { flex: 1, justifyContent: 'flex-end' },
          Platform.OS === 'android' ? { marginBottom: androidKeyboardHeight } : null,
        ]}
      >
        <View
          style={{
            backgroundColor: '#FEFCF0',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '85%',
            // No composer (deleted post) → the sheet itself carries the inset
            // so it still reaches the bottom edge opaquely.
            paddingBottom: post ? 0 : composerBottomInset,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.12,
            shadowRadius: 16,
            elevation: 24,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 8, marginBottom: 2 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' }} />
          </View>

          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Inter_700Bold',
              textAlign: 'center',
              marginTop: 10,
              marginBottom: 8,
            }}
          >
            Comments
          </Text>

          {!isPostLoading && !post ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#6B7280', textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
                This post is no longer available.
              </Text>
            </View>
          ) : isLoading || isPostLoading ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <ActivityIndicator color="#0FA6A6" />
            </View>
          ) : (
            <FlatList<PostComment>
              data={comments}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
              // flexShrink lets the list yield height to the composer instead
              // of pushing it off the sheet on long comment lists.
              style={{ minHeight: 120, flexGrow: 0, flexShrink: 1 }}
              ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
              ListEmptyComponent={
                <Text
                  style={{
                    color: '#9CA3AF',
                    textAlign: 'center',
                    fontFamily: 'Inter_400Regular',
                    paddingVertical: 24,
                  }}
                >
                  No comments yet. Be the first!
                </Text>
              }
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => handlePressCommenter(item.author.id)} activeOpacity={0.7}>
                    <Avatar uri={item.author.avatar_url} size={32} username={item.author.username} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, color: '#111827', fontFamily: 'Inter_400Regular' }}>
                      <Text
                        onPress={() => handlePressCommenter(item.author.id)}
                        style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}
                      >
                        @{item.author.username}{' '}
                      </Text>
                      {item.content}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                      {timeAgo(item.created_at)}
                    </Text>
                  </View>
                  {item.author.id !== viewerUserId && (
                    <TouchableOpacity
                      onPress={() =>
                        openReportFlow({ entityType: 'comment', entityId: item.id, entityName: item.content })
                      }
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Report this comment"
                      style={{ paddingTop: 2 }}
                    >
                      <Ionicons name="ellipsis-horizontal" size={16} color="#9CA3AF" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
          )}

          {post ? <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: composerBottomInset,
              borderTopWidth: 1,
              borderTopColor: '#E5E7EB',
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment..."
              placeholderTextColor="#9CA3AF"
              style={{
                flex: 1,
                backgroundColor: '#fff',
                borderRadius: 20,
                borderWidth: 1,
                borderColor: '#E5E7EB',
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 14,
                color: '#111827',
                fontFamily: 'Inter_400Regular',
                maxHeight: 80,
              }}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!draft.trim() || isPending}
              activeOpacity={0.8}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: draft.trim() && !isPending ? '#0FA6A6' : '#9CA3AF',
              }}
            >
              {isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View> : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
